"""Timesheet API serializers (Story 3.1): server-authoritative field allowlist.

Totals are derived server-side from canonical integer minutes and exposed as
hours AND minutes; no rounding of entered values ever occurs (the exposure is
pure integer division of minutes into hours/minutes plus a display string).
Protected fields (employee, status, version, events, totals read-onlys) are
rejected as 422 field errors without mutation.
"""
from datetime import date, timedelta

from rest_framework import serializers

from .models import TimeEntry, Timesheet, TimesheetEvent
from .services import normalize_week_start


class TimeEntryInputSerializer(serializers.Serializer):
    """One daily entry: integer minutes only; the service applies week/limits."""

    work_date = serializers.DateField()
    duration_minutes = serializers.IntegerField(min_value=0)
    unpaid_break_minutes = serializers.IntegerField(min_value=0, required=False, allow_null=False)
    description = serializers.CharField(max_length=500, required=False, allow_blank=True, trim_whitespace=False)

    def to_internal_value(self, data):
        ret = super().to_internal_value(data)
        ret.setdefault("unpaid_break_minutes", 0)
        return ret


class TimesheetCreateSerializer(serializers.Serializer):
    """POST /api/v1/timesheets body: week_start + optional duration entries."""

    week_start = serializers.DateField()
    entries = TimeEntryInputSerializer(many=True, required=False)

    def validate_week_start(self, value):
        from .services import TimesheetError

        try:
            return normalize_week_start(value.isoformat() if isinstance(value, date) else value)
        except TimesheetError as exc:
            raise serializers.ValidationError(str(exc.message))

    def validate(self, attrs):
        protected = set(self.initial_data) - {"week_start", "entries"}
        if protected:
            raise serializers.ValidationError(
                {field: ["This field is managed by the server."] for field in sorted(protected)}
            )
        attrs.setdefault("entries", [])
        if len(attrs["entries"]) > 7:
            raise serializers.ValidationError({"entries": ["A week contains at most seven daily entries."]})
        return attrs


def _totals(entries):
    worked = sum(e.duration_minutes for e in entries)
    breaks = sum(e.unpaid_break_minutes for e in entries)
    return worked, breaks


class TimeEntrySerializer(serializers.ModelSerializer):
    work_date = serializers.DateField()
    duration_minutes = serializers.IntegerField(read_only=True)
    unpaid_break_minutes = serializers.IntegerField(read_only=True)

    class Meta:
        model = TimeEntry
        fields = ["id", "work_date", "duration_minutes", "unpaid_break_minutes", "description", "created_at", "updated_at"]


class TimesheetEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = TimesheetEvent
        fields = ["id", "action", "from_status", "to_status", "comment", "created_at"]


class TimesheetSerializer(serializers.ModelSerializer):
    """Detail/read shape: canonical minutes plus derived hour/minute totals."""

    employee_id = serializers.UUIDField(source="employee.pk", read_only=True)
    status = serializers.CharField(read_only=True)
    version = serializers.IntegerField(read_only=True)
    week_start = serializers.DateField(read_only=True)
    week_end = serializers.SerializerMethodField()
    entries = TimeEntrySerializer(many=True, read_only=True)
    total_worked_minutes = serializers.SerializerMethodField()
    total_worked_hours = serializers.SerializerMethodField()
    total_worked_hours_minutes_display = serializers.SerializerMethodField()
    total_unpaid_break_minutes = serializers.SerializerMethodField()
    events = TimesheetEventSerializer(many=True, read_only=True)

    class Meta:
        model = Timesheet
        fields = [
            "id",
            "employee_id",
            "week_start",
            "week_end",
            "status",
            "version",
            "entries",
            "total_worked_minutes",
            "total_worked_hours",
            "total_worked_hours_minutes_display",
            "total_unpaid_break_minutes",
            "events",
            "created_at",
            "updated_at",
        ]

    def get_week_end(self, obj):
        return (obj.week_start + timedelta(days=6)).isoformat()

    def get_total_worked_minutes(self, obj):
        return sum(e.duration_minutes for e in obj.entries.all())

    def get_total_unpaid_break_minutes(self, obj):
        return sum(e.unpaid_break_minutes for e in obj.entries.all())

    def get_total_worked_hours(self, obj):
        return sum(e.duration_minutes for e in obj.entries.all()) // 60

    def get_total_worked_hours_minutes_display(self, obj):
        from .services import format_total_hours

        return format_total_hours(sum(e.duration_minutes for e in obj.entries.all()))
