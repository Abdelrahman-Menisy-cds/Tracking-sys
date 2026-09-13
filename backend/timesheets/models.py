"""_TIMESHEETS_STATE_MACHINE (see specs/timesheet-state-machine.md)

States: DRAFT, SUBMITTED, RETURNED, APPROVED, REJECTED.

Transitions:
- DRAFT -> SUBMITTED by employee after server validation.
- SUBMITTED -> APPROVED by authorized manager/HR reviewer.
- SUBMITTED -> RETURNED by authorized reviewer with mandatory reason.
- SUBMITTED -> REJECTED by authorized manager/HR reviewer with mandatory reason; terminal and read-only.
- RETURNED -> SUBMITTED by employee after correction and validation.
- APPROVED -> RETURNED only through HR reopen with explicit confirmation, mandatory reason, and audit; terminal history is retained.
- REJECTED -> (replacement timesheet workflow) by employee after correction, under a new story.

No employee cancellation. No employee reopen. Submitted and approved records are
read-only except the authorized HR reopen (Stories 3.2+, enforced there). Weekly
container is unique per employee/week (DB UniqueConstraint + service race check).
Week is Monday-Sunday in organization timezone. Entries are daily integer duration
minutes plus unpaid break minutes: no rounding, no automatic deduction, max
24 worked hours/day and 168 hours/week; invalid, negative, overlapping, or
out-of-week data is rejected with no mutation.
"""
from uuid import uuid4

from django.conf import settings
from django.db import models


class TimezoneConfig(models.Model):
    """Organization timezone, server-authoritative for week boundaries."""

    name = models.CharField(max_length=63, unique=True, default="UTC")

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(id=1), name="chk_timezone_config_singleton"),
        ]
        verbose_name = "organization timezone config"
        verbose_name_plural = "organization timezone configs"

    def __str__(self) -> str:
        return self.name


class Timesheet(models.Model):
    """One weekly container per employee; duration-only MVP."""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        SUBMITTED = "SUBMITTED", "Submitted"
        RETURNED = "RETURNED", "Returned"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="timesheets",
    )
    week_start = models.DateField(db_index=True)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )
    version = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-week_start", "-id")
        constraints = [
            models.UniqueConstraint(fields=("employee", "week_start"), name="uniq_timesheet_employee_week_start"),
            models.CheckConstraint(
                condition=models.Q(week_start__week_day=2),
                name="chk_timesheet_week_start_monday",
            ),
        ]
        indexes = [models.Index(fields=["employee"], name="idx_timesheet_employee")]
        verbose_name = "timesheet"
        verbose_name_plural = "timesheets"

    def __str__(self) -> str:
        return f"{self.employee_id}:{self.week_start} ({self.status})"


class TimeEntry(models.Model):
    """One daily duration record; canonical integer minutes, no rounding."""

    timesheet = models.ForeignKey(
        Timesheet,
        on_delete=models.CASCADE,
        related_name="entries",
    )
    work_date = models.DateField(db_index=True)
    duration_minutes = models.IntegerField()
    unpaid_break_minutes = models.IntegerField(default=0)
    description = models.CharField(max_length=500, blank=True, default="")
    version = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("work_date", "id")
        constraints = [
            models.UniqueConstraint(fields=("timesheet", "work_date"), name="uniq_timeentry_sheet_work_date"),
            models.CheckConstraint(condition=models.Q(duration_minutes__gte=0), name="chk_timeentry_duration_non_negative"),
            models.CheckConstraint(condition=models.Q(unpaid_break_minutes__gte=0), name="chk_timeentry_break_non_negative"),
            models.CheckConstraint(condition=models.Q(duration_minutes__lte=1440), name="chk_timeentry_duration_within_day"),
            models.CheckConstraint(condition=models.Q(unpaid_break_minutes__lte=1440), name="chk_timeentry_break_within_day"),
        ]
        verbose_name = "time entry"
        verbose_name_plural = "time entries"

    def __str__(self) -> str:
        return f"{self.timesheet_id}:{self.work_date}"


class TimesheetEvent(models.Model):
    """Append-only per-action history for a Timesheet, shape-mirrors RequestEvent."""

    class Action(models.TextChoices):
        CREATED = "CREATED", "Created"
        EDITED = "EDITED", "Edited"
        SUBMITTED = "SUBMITTED", "Submitted"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        RETURNED = "RETURNED", "Returned"

    timesheet = models.ForeignKey(
        Timesheet,
        on_delete=models.CASCADE,
        related_name="events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="timesheet_events",
    )
    action = models.CharField(max_length=16, choices=Action.choices)
    from_status = models.CharField(max_length=16, choices=Timesheet.Status.choices, null=True, blank=True)
    to_status = models.CharField(max_length=16, choices=Timesheet.Status.choices, null=True, blank=True)
    comment = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("created_at", "id")
        verbose_name = "timesheet event"
        verbose_name_plural = "timesheet events"


class TimesheetSubmitIdempotencyRecord(models.Model):
    """Stored submit-timesheet idempotency: one key+user, payload hash, snapshot.

    Same design as TimesheetCreateIdempotencyRecord and the reqs decision/
    cancel records: lookup AND insert run inside the locked transition
    transaction; UniqueConstraint(key_hash, user) is the serialization point.
    Scoped per user so a guessed key never leaks another employee's stored
    response.
    """

    key_hash = models.CharField(max_length=64, db_index=True)
    payload_hash = models.CharField(max_length=64)
    response_snapshot = models.JSONField()
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="timesheet_submit_idempotency_records",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("key_hash", "user"), name="uniq_timesheet_submit_idem_key_user"),
        ]
        verbose_name = "timesheet submit idempotency record"
        verbose_name_plural = "timesheet submit idempotency records"


class TimesheetCreateIdempotencyRecord(models.Model):
    """Stored create-timesheet idempotency: one key+user, payload hash, 201 snapshot.

    Same key + user + same payload replays the original 201 without a duplicate
    creation attempt; differing payload -> 409 by contract, scoped per user so a
    guessed key never leaks another employee's stored response.
    """

    key_hash = models.CharField(max_length=64, db_index=True)
    payload_hash = models.CharField(max_length=64)
    response_snapshot = models.JSONField()
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="timesheet_create_idempotency_records",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("key_hash", "user"), name="uniq_timesheet_create_idem_key_user"),
        ]
        verbose_name = "timesheet create idempotency record"
        verbose_name_plural = "timesheet create idempotency records"
