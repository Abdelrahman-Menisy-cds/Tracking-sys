"""Timesheet submit and correction services (Story 3.2).

State machine (specs/timesheet-state-machine.md):
- DRAFT -> SUBMITTED by employee after server validation.
- RETURNED -> SUBMITTED by employee after correction and validation.
- SUBMITTED/APPROVED/REJECTED are never employee-mutable (no employee cancel,
  no employee reopen); a submit attempt there is a 409 state conflict.

Submit (one legal transition per key):
- Requires explicit confirmation and an Idempotency-Key (view enforces the
  key; policy item 8: POST commands that submit require it).
- Validation BEFORE any mutation: complete-week entry set, one entry per
  work_date, integer minutes, daily 24h worked / 24h break caps, weekly
  worked <= 168h. No rounding, no automatic deductions. An invalid submit
  mutates nothing.
- transaction.atomic + select_for_update on the sheet row, status + version
  recheck under the lock, version += 1, one TimesheetEvent SUBMITTED with
  from/to statuses, one AuditEvent (actor, subject, UTC, before/after) — all
  committed atomically. The idempotency record insert happens in the same
  locked transaction; UniqueConstraint(key_hash, user) arbitrates concurrent
  same-key requests exactly like reqs.decision_services / cancel_services.
- After submit the sheet is read-only to the employee: entry edit/delete
  endpoints reject SUBMITTED/APPROVED/REJECTED with 409 state_conflict.

Corrections while RETURNED:
- PATCH/DELETE a single entry by id, owner-only, only in DRAFT/RETURNED.
  Permitted entry fields: work_date, duration_minutes, unpaid_break_minutes,
  description. Reviewer reason and all history are preserved (nothing
  touches TimesheetEvent rows or prior events); the sheet stays RETURNED and
  each edit/delete bumps the sheet version and appends an EDITED event with
  from/to = RETURNED. Resubmission then runs the same validated transition
  back to SUBMITTED.
"""
from hashlib import sha256

from django.db import IntegrityError, transaction
from django.utils.translation import gettext_lazy as _

from accounts.models import AuditEvent

from .models import (
    TimeEntry,
    Timesheet,
    TimesheetEvent,
    TimesheetSubmitIdempotencyRecord,
)
from .services import TimesheetError, validate_entries

SUBMITTABLE_STATUSES = (
    Timesheet.Status.DRAFT,
    Timesheet.Status.RETURNED,
)

# Fields an employee may correct on an existing entry (contract: define the
# permitted set explicitly; everything else is server-managed).
PERMITTED_ENTRY_FIELDS = ("work_date", "duration_minutes", "unpaid_break_minutes", "description")

EMPLOYEE_EDITABLE_STATUSES = (
    Timesheet.Status.DRAFT,
    Timesheet.Status.RETURNED,
)


class SubmitStateError(Exception):
    """Submit attempted in a non-submittable state (409 state conflict)."""


class VersionConflict(Exception):
    """Raised when the client version is stale against the locked row."""


class IdempotencyReplay(Exception):
    """Same key + user + payload already committed; replays the stored response."""

    def __init__(self, snapshot: dict):
        self.snapshot = snapshot
        super().__init__("idempotency_replay")


class IdempotencyConflict(Exception):
    """Same key + user but a different payload; contract maps to 409."""


def submit_idempotency_fingerprint(*, key: str, timesheet_id, version: int) -> tuple[str, str]:
    """Return (key_hash, payload_hash) for the submit idempotency table."""
    key_hash = sha256(key.encode()).hexdigest()
    payload_hash = sha256(f"{timesheet_id}:{version}".encode()).hexdigest()
    return key_hash, payload_hash


def _validate_submittable_entries(sheet: Timesheet) -> None:
    """Complete-week + limit validation against the persisted entry rows.

    Runs BEFORE any mutation; raises TimesheetError (422-mapped) with the
    affected field on any violation. Duration-only mode: at most one entry
    per work_date and every work_date inside the Monday-Sunday week.
    """
    week_start = sheet.week_start
    entries = [
        {
            "work_date": entry.work_date,
            "duration_minutes": entry.duration_minutes,
            "unpaid_break_minutes": entry.unpaid_break_minutes,
        }
        for entry in sheet.entries.all()
    ]
    if not entries:
        raise TimesheetError(
            "validation_error",
            "entries",
            _("A complete week requires at least one daily entry before submission."),
        )
    validate_entries(entries, week_start)
    seen = set()
    for entry in entries:
        if entry["work_date"] in seen:
            raise TimesheetError(
                "validation_error",
                "entries",
                _("Only one entry per work_date is allowed in duration mode."),
            )
        seen.add(entry["work_date"])


def submit_timesheet(
    *,
    employee,
    sheet: Timesheet,
    version: int,
    key_hash: str,
    payload_hash: str,
):
    """Transition DRAFT/RETURNED -> SUBMITTED exactly once under one lock.

    Raises SubmitStateError (409), VersionConflict (409), TimesheetError
    (422, no mutation), IdempotencyReplay (replay of a committed response),
    or IdempotencyConflict (409). The reviewer reason and prior history are
    never touched (RETURNED -> SUBMITTED preserves them by construction).
    """
    with transaction.atomic():
        locked = Timesheet.objects.select_for_update().get(pk=sheet.pk)

        # Defense in depth: the view already 404s cross-user access.
        if locked.employee_id != employee.pk:
            raise LookupError("not_owner")

        # A committed key replays/conflicts before any state check, mirroring
        # create_timesheet: idempotency arbitrates first per contract.
        record = TimesheetSubmitIdempotencyRecord.objects.filter(
            key_hash=key_hash, user=employee
        ).first()
        if record is not None:
            if record.payload_hash == payload_hash:
                raise IdempotencyReplay(record.response_snapshot)
            raise IdempotencyConflict()

        if locked.status not in SUBMITTABLE_STATUSES:
            # A same-key winner may have committed before this request got
            # the lock: re-read the record before exposing state_conflict.
            winner_row = TimesheetSubmitIdempotencyRecord.objects.filter(
                key_hash=key_hash, user=employee
            ).first()
            if winner_row is not None:
                if winner_row.payload_hash == payload_hash:
                    raise IdempotencyReplay(winner_row.response_snapshot)
                raise IdempotencyConflict()
            raise SubmitStateError(f"state_{locked.status}")

        if locked.version != version:
            raise VersionConflict(locked.version)

        _validate_submittable_entries(locked)

        previous_status = locked.status
        locked.status = Timesheet.Status.SUBMITTED
        locked.version += 1
        locked.save(update_fields=["status", "version", "updated_at"])

        TimesheetEvent.objects.create(
            timesheet=locked,
            actor=employee,
            action=TimesheetEvent.Action.SUBMITTED,
            from_status=previous_status,
            to_status=Timesheet.Status.SUBMITTED,
        )
        AuditEvent.objects.create(
            actor=employee,
            subject=employee,
            action="timesheet_submitted",
            request_id=str(locked.pk),
            before={"status": previous_status, "version": version},
            after={"status": Timesheet.Status.SUBMITTED, "version": locked.version},
        )

        # Idempotency record committed atomically with the transition — the
        # nested atomic is a savepoint, so an IntegrityError from a
        # concurrent winner rolls back only the insert; the still-live outer
        # transaction re-reads the winner's row (decision_services pattern).
        winner = None
        try:
            with transaction.atomic():
                TimesheetSubmitIdempotencyRecord.objects.create(
                    key_hash=key_hash,
                    payload_hash=payload_hash,
                    response_snapshot={"timesheet_id": str(locked.pk)},
                    user=employee,
                )
        except IntegrityError:
            winner_row = TimesheetSubmitIdempotencyRecord.objects.filter(
                key_hash=key_hash, user=employee
            ).first()
            if winner_row is None:
                raise IdempotencyConflict() from None
            winner = (winner_row.payload_hash, winner_row.response_snapshot)
        if winner is not None:
            if winner[0] != payload_hash:
                raise IdempotencyConflict()
            raise IdempotencyReplay(winner[1])

    return locked


def _normalize_entry_payload(cleaned: dict) -> dict:
    """Normalized subset for a partial entry update; values already validated."""
    return {
        "work_date": cleaned.get("work_date"),
        "duration_minutes": cleaned.get("duration_minutes"),
        "unpaid_break_minutes": cleaned.get("unpaid_break_minutes"),
        "description": cleaned.get("description"),
    }


def edit_entry(
    *,
    employee,
    sheet: Timesheet,
    entry: TimeEntry,
    cleaned: dict,
):
    """Apply a validated partial correction to one entry while DRAFT/RETURNED.

    The view has already: 404-scoped the sheet and entry to the owner,
    rejected non-editable states (409), and run serializer validation. This
    function re-locks the sheet, re-checks state/version (defense in depth),
    applies the permitted fields, re-validates the whole week (no mutation
    on any violation), bumps the sheet version, and appends an EDITED event.
    The reviewer reason and prior history are untouched.

    Permitted entry fields are defined by PERMITTED_ENTRY_FIELDS; the view
    serializer rejects anything else before this service runs.
    """
    with transaction.atomic():
        locked_sheet = Timesheet.objects.select_for_update().get(pk=sheet.pk)
        if locked_sheet.employee_id != employee.pk:
            raise LookupError("not_owner")
        if locked_sheet.status not in EMPLOYEE_EDITABLE_STATUSES:
            raise SubmitStateError(f"state_{locked_sheet.status}")
        if locked_sheet.version != cleaned["expected_version"]:
            raise VersionConflict(locked_sheet.version)

        locked_entry = TimeEntry.objects.select_for_update().get(pk=entry.pk, timesheet=locked_sheet)

        updates = _normalize_entry_payload(cleaned)
        changed_fields = []
        for field, value in updates.items():
            if value is not None:
                setattr(locked_entry, field, value)
                changed_fields.append(field)
        locked_entry.save(update_fields=changed_fields + ["updated_at"])

        # Re-validate the ENTIRE week against persisted rows: the corrected
        # entry must not create an out-of-week date, duplicate day, over-cap
        # day, or over-168h week. Any violation aborts everything (no
        # mutation), preserving the reviewer reason and history.
        _validate_submittable_entries(locked_sheet)

        locked_sheet.version += 1
        locked_sheet.save(update_fields=["version", "updated_at"])
        TimesheetEvent.objects.create(
            timesheet=locked_sheet,
            actor=employee,
            action=TimesheetEvent.Action.EDITED,
            from_status=locked_sheet.status,
            to_status=locked_sheet.status,
        )
        AuditEvent.objects.create(
            actor=employee,
            subject=employee,
            action="timesheet_entry_edited",
            request_id=str(locked_sheet.pk),
            before={"entry_id": str(locked_entry.pk), "version": cleaned["expected_version"]},
            after={"entry_id": str(locked_entry.pk), "version": locked_sheet.version},
        )
    return locked_sheet, locked_entry


def delete_entry(
    *,
    employee,
    sheet: Timesheet,
    entry: TimeEntry,
    version: int,
):
    """Delete one entry while DRAFT/RETURNED; same lock/version/audit rules.

    Deleting the last entry is allowed (a DRAFT/RETURNED sheet may be empty;
    submission of an empty week is rejected by validation, not by deletion).
    """
    with transaction.atomic():
        locked_sheet = Timesheet.objects.select_for_update().get(pk=sheet.pk)
        if locked_sheet.employee_id != employee.pk:
            raise LookupError("not_owner")
        if locked_sheet.status not in EMPLOYEE_EDITABLE_STATUSES:
            raise SubmitStateError(f"state_{locked_sheet.status}")
        if locked_sheet.version != version:
            raise VersionConflict(locked_sheet.version)

        locked_entry = TimeEntry.objects.select_for_update().get(pk=entry.pk, timesheet=locked_sheet)
        entry_id = locked_entry.pk
        locked_entry.delete()

        locked_sheet.version += 1
        locked_sheet.save(update_fields=["version", "updated_at"])
        TimesheetEvent.objects.create(
            timesheet=locked_sheet,
            actor=employee,
            action=TimesheetEvent.Action.EDITED,
            from_status=locked_sheet.status,
            to_status=locked_sheet.status,
        )
        AuditEvent.objects.create(
            actor=employee,
            subject=employee,
            action="timesheet_entry_deleted",
            request_id=str(locked_sheet.pk),
            before={"entry_id": str(entry_id), "version": version},
            after={"entry_id": str(entry_id), "deleted": True, "version": locked_sheet.version},
        )
    return locked_sheet
