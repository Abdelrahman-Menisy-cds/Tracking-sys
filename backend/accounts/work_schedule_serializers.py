"""Work-schedule serializers — Story H39 (HR only).

The schedule travels with its days: the settings card edits one work week as
a single form, so create and edit both take the whole day set and the view
applies it atomically. Writes are allowlisted exactly like every other
accounts serializer — anything not named here never reaches a row.
"""
from rest_framework import serializers

from accounts.models import WorkSchedule, WorkScheduleDay


class WorkScheduleDaySerializer(serializers.Serializer):
    """One weekday row. ``weekday`` is 0=Sunday … 6=Saturday (brief H39 —
    the JS ``getDay()`` order the SPA sends, NOT Python's Monday-first)."""

    weekday = serializers.IntegerField(min_value=0, max_value=6)
    is_working_day = serializers.BooleanField(required=False, default=True)
    start_time = serializers.TimeField(required=False, allow_null=True)
    end_time = serializers.TimeField(required=False, allow_null=True)
    break_minutes = serializers.IntegerField(required=False, min_value=0, default=0)

    def to_internal_value(self, data):
        validated = super().to_internal_value(data)
        if not validated["is_working_day"]:
            # A rest day carries no times; leftovers from a previous working
            # state are normalized away instead of storing a contradiction.
            validated["start_time"] = None
            validated["end_time"] = None
        return validated

    def validate(self, attrs):
        if attrs.get("is_working_day", True):
            missing = [f for f in ("start_time", "end_time") if not attrs.get(f)]
            if missing:
                raise serializers.ValidationError(
                    {field: ["This field is required for a working day."] for field in missing}
                )
            if attrs["end_time"] <= attrs["start_time"]:
                raise serializers.ValidationError(
                    {"end_time": ["end_time must be after start_time."]}
                )
        return attrs


class WorkScheduleWriteSerializer(serializers.Serializer):
    """Create/PATCH body. Every field optional here; the POST handler requires
    the trio it cannot guess (name, effective_from, days) — the department
    create does the same with its required pair."""

    name = serializers.CharField(max_length=120, required=False)
    effective_from = serializers.DateField(required=False)
    effective_to = serializers.DateField(required=False, allow_null=True)
    is_active = serializers.BooleanField(required=False)
    days = WorkScheduleDaySerializer(many=True, required=False)

    def validate(self, attrs):
        days = attrs.get("days")
        if days is not None:
            # Enforced here, not left to the (schedule, weekday) unique index:
            # a rejected request must answer 422, not die as an IntegrityError
            # while the day rows are being written.
            weekdays = [day["weekday"] for day in days]
            duplicates = sorted({weekday for weekday in weekdays if weekdays.count(weekday) > 1})
            if duplicates:
                raise serializers.ValidationError(
                    {"days": [f"Each weekday may appear only once (duplicated: {duplicates})."]}
                )
        # The range is checked against the MERGED values (payload + the row
        # being edited), so a PATCH that moves only one end of the range is
        # refused as 422 instead of surfacing as a DB constraint error.
        schedule = self.context.get("schedule")
        effective_from = attrs.get("effective_from")
        if effective_from is None and schedule is not None:
            effective_from = schedule.effective_from
        effective_to = (
            attrs["effective_to"] if "effective_to" in attrs else schedule.effective_to if schedule is not None else None
        )
        if (
            effective_from is not None
            and effective_to is not None
            and effective_to < effective_from
        ):
            raise serializers.ValidationError(
                {"effective_to": ["effective_to must not be before effective_from."]}
            )
        return attrs


class WorkScheduleReadSerializer(serializers.Serializer):
    """Read shape for the settings card: the schedule plus its full day set,
    with ``is_active`` marking which row the card should present as the
    organization's current schedule."""

    id = serializers.IntegerField(read_only=True, source="pk")
    name = serializers.CharField(read_only=True)
    effective_from = serializers.DateField(read_only=True)
    effective_to = serializers.DateField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    days = WorkScheduleDaySerializer(many=True, read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)
