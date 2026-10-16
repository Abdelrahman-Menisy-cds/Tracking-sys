"""Story 4.1 serializers: read-only review shapes with permissions block."""
from rest_framework import serializers

from reqs.models import EmployeeRequest
from reqs.serializers import RequestTypeSerializer
from timesheets.models import TimeEntry, Timesheet, TimesheetEvent
from timesheets.serializers import TimesheetEventSerializer


class RequestAttachmentSummarySerializer(serializers.Serializer):
    """Display-only attachment metadata for reviewers (opaque key, never a URL)."""

    id = serializers.UUIDField(read_only=True)
    original_filename = serializers.CharField(read_only=True)
    declared_content_type = serializers.CharField(read_only=True)
    size_bytes = serializers.IntegerField(read_only=True)
    scan_status = serializers.CharField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)


class RequestEventSerializer(serializers.ModelSerializer):
    class Meta:
        from reqs.models import RequestEvent

        model = RequestEvent
        fields = ["id", "action", "from_status", "to_status", "comment", "created_at"]


class ReviewRequestSummarySerializer(serializers.ModelSerializer):
    """Queue row: no details/attachments/events — detail returns those."""

    request_type = RequestTypeSerializer(read_only=True)
    requester_id = serializers.UUIDField(source="requester.pk", read_only=True)
    requester_name = serializers.CharField(source="requester.full_name", read_only=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeRequest
        fields = [
            "id",
            "requester_id",
            "requester_name",
            "request_type",
            "title",
            "status",
            "version",
            "submitted_at",
            "permissions",
            "created_at",
        ]

    def get_permissions(self, obj):
        from review.scope import can_decide_request

        return {"can_decide": can_decide_request(self.context["viewer"], obj)}


class ReviewRequestSerializer(serializers.ModelSerializer):
    request_type = RequestTypeSerializer(read_only=True)
    requester_id = serializers.UUIDField(source="requester.pk", read_only=True)
    attachments = RequestAttachmentSummarySerializer(many=True, read_only=True)
    events = RequestEventSerializer(many=True, read_only=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeRequest
        fields = [
            "id",
            "requester_id",
            "request_type",
            "title",
            "details",
            "status",
            "version",
            "submitted_at",
            "attachments",
            "events",
            "permissions",
            "created_at",
            "updated_at",
        ]

    def get_permissions(self, obj):
        from review.scope import can_decide_request

        return {"can_decide": can_decide_request(self.context["viewer"], obj)}


class ReviewTimeEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = TimeEntry
        fields = ["id", "work_date", "duration_minutes", "unpaid_break_minutes", "description"]


class ReviewTimesheetSerializer(serializers.ModelSerializer):
    employee_id = serializers.UUIDField(source="employee.pk", read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    entries = ReviewTimeEntrySerializer(many=True, read_only=True)
    total_worked_minutes = serializers.SerializerMethodField()
    total_unpaid_break_minutes = serializers.SerializerMethodField()
    events = TimesheetEventSerializer(many=True, read_only=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Timesheet
        fields = [
            "id",
            "employee_id",
            "employee_name",
            "week_start",
            "status",
            "version",
            "entries",
            "total_worked_minutes",
            "total_unpaid_break_minutes",
            "events",
            "permissions",
            "created_at",
            "updated_at",
        ]

    def get_total_worked_minutes(self, obj):
        return sum(e.duration_minutes for e in obj.entries.all())

    def get_total_unpaid_break_minutes(self, obj):
        return sum(e.unpaid_break_minutes for e in obj.entries.all())

    def get_permissions(self, obj):
        from review.scope import can_decide_timesheet

        return {"can_decide": can_decide_timesheet(self.context["viewer"], obj)}


def report_rows_for(category, queryset):
    """Story 4.3 + H35 report row dicts over an already-scoped+ordered queryset."""
    if category == "requests":
        rows = []
        for obj in queryset.iterator():
            rows.append(
                {
                    "id": str(obj.pk),
                    "requester_id": str(obj.requester_id),
                    "requester_name": obj.requester.full_name,
                    "request_type": obj.request_type.name,
                    "title": obj.title,
                    "status": obj.status,
                    "version": obj.version,
                    "submitted_at": obj.submitted_at.isoformat() if obj.submitted_at else None,
                    "created_at": obj.created_at.isoformat(),
                }
            )
        return rows
    if category == "timesheets":
        rows = []
        for obj in queryset.iterator():
            rows.append(
                {
                    "id": str(obj.pk),
                    "employee_id": str(obj.employee_id),
                    "employee_name": obj.employee.full_name,
                    "week_start": obj.week_start.isoformat(),
                    "status": obj.status,
                    "version": obj.version,
                    "created_at": obj.created_at.isoformat(),
                    "updated_at": obj.updated_at.isoformat(),
                }
            )
        return rows
    if category == "attendance":
        # Derived from the timesheet entry history (no attendance app yet):
        # one row per employee-day, status from the SAME rule totals/CSV use.
        from review.reports import attendance_day_status

        rows = []
        for obj in queryset.iterator():
            rows.append(
                {
                    "id": str(obj.pk),
                    "employee_id": str(obj.timesheet.employee_id),
                    "employee_name": obj.timesheet.employee.full_name,
                    "work_date": obj.work_date.isoformat(),
                    "status": attendance_day_status(obj.duration_minutes),
                    "duration_minutes": obj.duration_minutes,
                    "unpaid_break_minutes": obj.unpaid_break_minutes,
                    "timesheet_id": str(obj.timesheet_id),
                    "timesheet_status": obj.timesheet.status,
                }
            )
        return rows
    if category == "people":
        # One row per department inside the bounded profile set, plus an
        # "unassigned" bucket whenever profile rows without a department
        # exist. Deterministic order: department code ASC, bucket last.
        buckets: dict = {}
        for profile in queryset.iterator():
            dept = profile.department
            key = dept.pk if dept is not None else None
            bucket = buckets.get(key)
            if bucket is None:
                bucket = {
                    "id": str(dept.pk) if dept is not None else "unassigned",
                    "department_id": str(dept.pk) if dept is not None else None,
                    "department_code": dept.code if dept is not None else "",
                    "department_name": (dept.name_ar or dept.name_en or dept.code) if dept is not None else "",
                    "manager_id": str(dept.manager_id) if dept is not None and dept.manager_id else None,
                    "manager_name": dept.manager.full_name if dept is not None and dept.manager_id else "",
                    "headcount": 0,
                }
                buckets[key] = bucket
            bucket["headcount"] += 1
        ordered = sorted(
            buckets.items(),
            key=lambda item: (item[0] is None, item[1]["department_code"], str(item[0] or "")),
        )
        return [bucket for _key, bucket in ordered]
    from review.reports import ReportFilterError

    raise ReportFilterError([f"report: unknown category {category!r}."])


class ReviewTimesheetSummarySerializer(serializers.ModelSerializer):
    """Queue row: no entries/events — detail returns those."""

    employee_id = serializers.UUIDField(source="employee.pk", read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Timesheet
        fields = [
            "id",
            "employee_id",
            "employee_name",
            "week_start",
            "status",
            "version",
            "permissions",
            "created_at",
        ]

    def get_permissions(self, obj):
        from review.scope import can_decide_timesheet

        return {"can_decide": can_decide_timesheet(self.context["viewer"], obj)}
