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
