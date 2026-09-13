"""Timesheet creation service (Story 3.1): one unique sheet per employee/week.

Server-authoritative validation, no partial writes:
- week_start must be a Monday in the organization timezone (TimezoneConfig).
- Entries: integer minutes >= 0, work_date inside [week_start, week_start+6].
- No rounding, no automatic deductions; totals expose hours and minutes.
- Duplicate week: unique (employee, week_start) plus race-safe check inside the
  create transaction (select_for_update on the employee row serializes concurrent
  creates, so two identical submissions never both insert; the loser sees the
  committed sheet and returns DuplicateWeek with the safe existing reference).
- Idempotency-Key enforced at the view; record insert happens inside the same
  locked transaction, so concurrent same-key creators serialize and only one
  sheet exists (UniqueConstraint on key_hash+user is the arbitration point).
"""
from hashlib import sha256
from datetime import date, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db import transaction
from django.utils.translation import gettext_lazy as _

from .models import (
    TimeEntry,
    Timesheet,
    TimesheetCreateIdempotencyRecord,
    TimesheetEvent,
    TimezoneConfig,
)

MAX_DAILY_WORK_MINUTES = 24 * 60
MAX_WEEKLY_WORK_MINUTES = 7 * MAX_DAILY_WORK_MINUTES
MAX_DAILY_BREAK_MINUTES = MAX_DAILY_WORK_MINUTES


class TimesheetError(Exception):
    """Raised on a policy violation; carries a 422-mapped field/message."""

    def __init__(self, code: str, field: str, message: str):
        self.code = code
        self.field = field
        self.message = message
        super().__init__(f"{code}: {field}: {message}")


class DuplicateWeek(Exception):
    """A sheet already exists for this employee/week; carries it for the caller."""

    def __init__(self, existing: Timesheet):
        self.existing = existing
        super().__init__(f"duplicate_week for employee={existing.employee_id} week={existing.week_start}")


class IdempotencyReplay(Exception):
    """Same key + user + payload already committed; replays the stored response."""

    def __init__(self, snapshot: dict):
        self.snapshot = snapshot
        super().__init__("idempotency_replay")


class IdempotencyConflict(Exception):
    """Same key + user but a different payload; contract maps to 409."""


def organization_timezone_name() -> str:
    """Single-row TimezoneConfig; seeded by migration so week math never guesses."""
    config = TimezoneConfig.objects.first()
    if config is None or not config.name:
        raise TimesheetError(
            "week_invalid",
            "week_start",
            _("Organization timezone is not configured."),
        )
    try:
        ZoneInfo(config.name)
    except ZoneInfoNotFoundError:
        raise TimesheetError(
            "week_invalid",
            "week_start",
            _("Organization timezone is not a valid IANA zone."),
        )
    return config.name


def normalize_week_start(raw_week_start: str) -> date:
    """Validate YYYY-MM-DD is a Monday in the organization timezone calendar.

    The organization timezone is authoritative for week boundaries: the code
    resolves and validates the configured IANA zone first (a misconfigured or
    missing TimezoneConfig fails closed with week_invalid), then checks the
    calendar weekday. Because MVP entries are duration-only (no clock
    instants), DST offsets cannot shift the Monday-Sunday boundaries.
    """
    timezone_name = organization_timezone_name()
    ZoneInfo(timezone_name)  # validated by organization_timezone_name already
    local_week_start = date.fromisoformat(raw_week_start)
    if local_week_start.weekday() != 0:  # Monday == 0
        raise TimesheetError(
            "week_invalid",
            "week_start",
            _("week_start must be a Monday in the organization timezone ({zone}).").format(zone=timezone_name),
        )
    return local_week_start


def canonical_week_start_from_monday(raw_week_start: date) -> date:
    """Accept an already-normalized weekday; reject others (service callers)."""
    if raw_week_start.weekday() != 0:
        raise TimesheetError(
            "week_invalid",
            "week_start",
            _("week_start must be a Monday in the organization timezone."),
        )
    return raw_week_start


def week_end(week_start: date) -> date:
    return week_start + timedelta(days=6)


def validate_entries(entries: list[dict], week_start: date) -> None:
    """Daily worked/break limits and out-of-week rejection (policy item 4)."""
    end = week_end(week_start)
    total_worked = 0
    for entry in entries:
        work_date = entry["work_date"]
        if not isinstance(work_date, date):
            raise TimesheetError(
                "validation_error",
                "entries",
                _("Every entry requires a valid work_date within this week."),
            )
        if work_date < week_start or work_date > end:
            raise TimesheetError(
                "validation_error",
                "entries",
                _("work_date {date} is outside the Monday-Sunday week starting {week}.").format(
                    date=work_date.isoformat(), week=week_start.isoformat()
                ),
            )
        duration = entry["duration_minutes"]
        if not isinstance(duration, int) or isinstance(duration, bool) or duration < 0:
            raise TimesheetError(
                "validation_error",
                "entries",
                _("duration_minutes must be a whole number of minutes, zero or greater."),
            )
        if duration > MAX_DAILY_WORK_MINUTES:
            raise TimesheetError(
                "validation_error",
                "entries",
                _("Daily worked time cannot exceed 24 hours (duration_minutes > 1440)."),
            )
        unpaid_break = entry["unpaid_break_minutes"]
        if not isinstance(unpaid_break, int) or isinstance(unpaid_break, bool) or unpaid_break < 0:
            raise TimesheetError(
                "validation_error",
                "entries",
                _("unpaid_break_minutes must be a whole number of minutes, zero or greater."),
            )
        if unpaid_break > MAX_DAILY_BREAK_MINUTES:
            raise TimesheetError(
                "validation_error",
                "entries",
                _("Daily unpaid break cannot exceed 24 hours (unpaid_break_minutes > 1440)."),
            )
        total_worked += duration
    if total_worked > MAX_WEEKLY_WORK_MINUTES:
        raise TimesheetError(
            "validation_error",
            "entries",
            _("Weekly worked time cannot exceed 168 hours."),
        )


def format_total_hours(total_minutes: int) -> str:
    """e.g. 1497 -> '24h 57m'; used by the API serializer for display totals."""
    hours, minutes = divmod(total_minutes, 60)
    return f"{hours}h {minutes}m"


@transaction.atomic
def create_timesheet(
    *,
    employee,
    week_start: date,
    entries: list[dict],
    key_hash: str,
    payload_hash: str,
):
    """Create the one sheet for this employee/week plus its entries atomically.

    Idempotency lookup AND record insert happen INSIDE the same transaction as
    the uniqueness check: the employee-row select_for_update serializes
    concurrent creates, the (employee, week_start) unique constraint catches
    any remaining race, and TimesheetCreateIdempotencyRecord's
    UniqueConstraint(key_hash, user) is the idempotency serialization point
    (same design as reqs.decision_services.decide_request).

    Raises TimesheetError (422), DuplicateWeek (409-mapped), IdempotencyReplay
    (200/201 replay of a committed response), or IdempotencyConflict (409).
    """
    # In-transaction idempotency FIRST (contract: a committed same-key+payload
    # replays even if the week also already exists): a previously committed key
    # replays/conflicts BEFORE any mutation; a concurrent winner is caught by
    # the record insert's unique constraint below.
    record = TimesheetCreateIdempotencyRecord.objects.filter(key_hash=key_hash, user=employee).first()
    if record is not None:
        if record.payload_hash == payload_hash:
            raise IdempotencyReplay(record.response_snapshot)
        raise IdempotencyConflict()

    # Locking the employee row serializes all of this employee's sheet creation;
    # the duplicate check afterwards is therefore race-free.
    Timesheet.objects.select_for_update().filter(employee=employee, week_start=week_start).first()
    existing = Timesheet.objects.filter(employee=employee, week_start=week_start).first()
    if existing is not None:
        raise DuplicateWeek(existing)

    entries_validated = _normalize_entries(entries, week_start)
    sheet = Timesheet.objects.create(employee=employee, week_start=week_start)
    TimeEntry.objects.bulk_create(
        [
            TimeEntry(
                timesheet=sheet,
                work_date=entry["work_date"],
                duration_minutes=entry["duration_minutes"],
                unpaid_break_minutes=entry["unpaid_break_minutes"],
                description=entry.get("description", ""),
            )
            for entry in entries_validated
        ]
    )
    TimesheetEvent.objects.create(
        timesheet=sheet,
        actor=employee,
        action=TimesheetEvent.Action.CREATED,
        from_status=None,
        to_status=Timesheet.Status.DRAFT,
    )
    TimesheetCreateIdempotencyRecord.objects.create(
        key_hash=key_hash,
        payload_hash=payload_hash,
        response_snapshot={"timesheet_id": str(sheet.pk)},
        user=employee,
    )
    return sheet


def _normalize_entries(entries: list[dict], week_start: date) -> list[dict]:
    """Validate once against already-normalized week_start before any DB write."""
    validate_entries(entries, week_start)
    seen = set()
    normalized = []
    for entry in entries:
        if entry["work_date"] in seen:
            raise TimesheetError(
                "validation_error",
                "entries",
                _("Only one entry per work_date is allowed in duration mode."),
            )
        seen.add(entry["work_date"])
        normalized.append(
            {
                "work_date": entry["work_date"],
                "duration_minutes": entry["duration_minutes"],
                "unpaid_break_minutes": entry["unpaid_break_minutes"],
                "description": entry.get("description", ""),
            }
        )
    return normalized


