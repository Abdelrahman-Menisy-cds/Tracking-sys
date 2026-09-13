"""Timesheet reviewer decision and HR reopen services (Story 3.3).

State machine (specs/timesheet-state-machine.md), decision/reopen only:
- SUBMITTED -> APPROVED by an authorized manager/HR reviewer.
- SUBMITTED -> RETURNED by an authorized reviewer with mandatory reason.
- SUBMITTED -> REJECTED by an authorized reviewer with mandatory reason;
  terminal and read-only.
- APPROVED/REJECTED -> RETURNED ONLY through HR reopen with explicit
  confirmation, mandatory reason, and audit; terminal history retained.

Authorization (defense in depth, re-checked INSIDE the locked transaction):
the requester can never decide their own sheet (self_decision), manager
scope is the employee's current direct-report manager NOT having a snapshot
constraint (the sheet has(manager_at_submission) but scope follows the
EMBEDDED profile.manager at decision time), HR scope is active HR role.
Out-of-scope -> LookupError (view maps to 404 per the permission-matrix 404
policy); eligible reviewer on a non-SUBMITTED non-terminal state other than
their reopen states -> DecisionStateError (409).

Every legal transition: transaction.atomic + select_for_update on the sheet
row, re-check status + version (stale -> VersionConflict 409), version += 1,
exactly one TimesheetEvent + one AuditEvent committed atomically; the
TimesheetDecisionIdempotencyRecord insert runs in the same locked
transaction (UniqueConstraint(key_hash, user) as the serialization point —
same design as reqs.decision_services / timesheets correction_services).
Post-commit requester notification is failure-isolated (decide only).
"""
import logging

from django.db import IntegrityError, transaction
from django.utils.translation import gettext_lazy as _

from accounts.models import AuditEvent, User

from .models import (
    Timesheet,
    TimesheetDecisionIdempotencyRecord,
    TimesheetEvent,
)
from .services import TimesheetError  # noqa: F401  (kept for error mapping symmetry)

logger = logging.getLogger(__name__)

DECISION_ACTIONS = ("approve", "reject", "return")

REOPEN_STATE_ACTIONS = (Timesheet.Status.APPROVED, Timesheet.Status.REJECTED)


class DecisionStateError(Exception):
    """Invalid action/state combination; mapped to 409 state_conflict."""


class VersionConflict(Exception):
    """Raised when the client version is stale against the locked row."""


class IdempotencyReplay(Exception):
    """Concurrent/sequential identical request lost the key race; carries the winner's snapshot."""

    def __init__(self, snapshot):
        self.snapshot = snapshot
        super().__init__("idempotency_replay")


class IdempotencyConflict(Exception):
    """Same idempotency key reused with a different payload (409)."""


def _authorize_reviewer(locked: Timesheet, reviewer) -> str:
    """Return the reviewer's scope role, independent of the sheet state.

    Idempotent retries may arrive after the winner moved the sheet to a
    terminal state, so authorization is checked BEFORE replaying a stored
    response and must not depend on the SUBMITTED state.
    """
    if locked.employee_id == reviewer.pk:
        raise PermissionError("self_decision")
    if not reviewer.is_active:
        raise LookupError("out_of_scope")
    if reviewer.role == User.Role.HR:
        return "hr"
    if reviewer.role == User.Role.MANAGER:
        # Direct-report scope (policy item 2): only the employee's CURRENT
        # direct-report manager may decide this sheet; the whole hierarchy
        # and unrelated managers are out of scope.
        from accounts.models import EmployeeProfile

        if EmployeeProfile.objects.filter(user_id=locked.employee_id, manager_id=reviewer.pk).exists():
            return "manager"
    raise LookupError("out_of_scope")


def _resolve_scope(locked: Timesheet, reviewer) -> str:
    """Return 'manager' / 'hr' when the reviewer may act on this sheet in its current state.

    Raises PermissionError for self-decision. Out-of-scope -> LookupError
    (404-mapped, no existence disclosure). An eligible reviewer on a state
    that does not accept the action raises DecisionStateError (409).
    """
    scope = _authorize_reviewer(locked, reviewer)
    if locked.status == Timesheet.Status.SUBMITTED and scope in ("manager", "hr"):
        return scope
    raise DecisionStateError(f"state_{locked.status}")


_TRANSITIONS = {
    ("manager", "approve"): Timesheet.Status.APPROVED,
    ("manager", "reject"): Timesheet.Status.REJECTED,
    ("manager", "return"): Timesheet.Status.RETURNED,
    ("hr", "approve"): Timesheet.Status.APPROVED,
    ("hr", "reject"): Timesheet.Status.REJECTED,
    ("hr", "return"): Timesheet.Status.RETURNED,
}

_EVENT_ACTION = {
    "approve": TimesheetEvent.Action.APPROVED,
    "reject": TimesheetEvent.Action.REJECTED,
    "return": TimesheetEvent.Action.RETURNED,
}
_AUDIT_ACTION = {
    "approve": "timesheet_approved",
    "reject": "timesheet_rejected",
    "return": "timesheet_returned",
}


def decide_timesheet(
    *,
    reviewer,
    sheet: Timesheet,
    action: str,
    comment: str,
    version: int,
    key_hash: str,
    payload_hash: str,
):
    """Apply exactly one legal decision transition under one lock.

    Same locked-transaction idempotency design as reqs decision_services:
    lookup AND insert inside the locked transaction; IntegrityError from a
    concurrent winner re-reads and replays or conflicts deterministically.
    """
    if action not in DECISION_ACTIONS:
        raise DecisionStateError(f"unknown action {action}")

    with transaction.atomic():
        locked = Timesheet.objects.select_for_update().get(pk=sheet.pk)

        # Defense in depth: re-read the reviewer's active flag inside the
        # locked transaction — a reviewer deactivated between authentication
        # and this transaction must be denied with zero side effects.
        reviewer = User.objects.select_for_update().get(pk=reviewer.pk)

        # Authorization before idempotency replay: a guessed key must not
        # disclose another reviewer's stored response; an inactive reviewer
        # must not replay it.
        _authorize_reviewer(locked, reviewer)

        existing = TimesheetDecisionIdempotencyRecord.objects.filter(
            key_hash=key_hash, user=reviewer
        ).first()
        if existing is not None:
            if existing.payload_hash == payload_hash:
                raise IdempotencyReplay(existing.response_snapshot)
            raise IdempotencyConflict()

        try:
            scope = _resolve_scope(locked, reviewer)
        except DecisionStateError:
            winner_row = TimesheetDecisionIdempotencyRecord.objects.filter(
                key_hash=key_hash, user=reviewer
            ).first()
            if winner_row is not None:
                if winner_row.payload_hash == payload_hash:
                    raise IdempotencyReplay(winner_row.response_snapshot)
                raise IdempotencyConflict()
            raise

        if locked.version != version:
            raise VersionConflict(locked.version)

        from_status = locked.status
        to_status = _TRANSITIONS[(scope, action)]

        locked.status = to_status
        locked.version += 1
        locked.save(update_fields=["status", "version", "updated_at"])

        TimesheetEvent.objects.create(
            timesheet=locked,
            actor=reviewer,
            action=_EVENT_ACTION[action],
            from_status=from_status,
            to_status=to_status,
            comment=comment,
        )
        timesheet_id = str(locked.pk)
        AuditEvent.objects.create(
            actor=reviewer,
            subject=locked.employee,
            action=_AUDIT_ACTION[action],
            request_id=timesheet_id,
            before={"status": from_status, "version": version},
            after={"status": to_status, "version": locked.version, "comment": comment[:500]},
        )

        winner = None
        try:
            with transaction.atomic():
                TimesheetDecisionIdempotencyRecord.objects.create(
                    key_hash=key_hash,
                    payload_hash=payload_hash,
                    response_snapshot={"timesheet_id": timesheet_id, "status": to_status},
                    user=reviewer,
                )
        except IntegrityError:
            winner_row = TimesheetDecisionIdempotencyRecord.objects.filter(
                key_hash=key_hash, user=reviewer
            ).first()
            if winner_row is None:
                raise IdempotencyConflict() from None
            winner = (winner_row.payload_hash, winner_row.response_snapshot)
        if winner is not None:
            if winner[0] != payload_hash:
                raise IdempotencyConflict()
            raise IdempotencyReplay(winner[1])

    _schedule_decision_notification(timesheet_id, action, comment)
    return locked


def _schedule_decision_notification(timesheet_id: str, action: str, comment: str) -> None:
    """Schedule a committed decision notification without risking its outcome."""
    try:
        _notify_employee_of_decision(timesheet_id, action, comment)
    except Exception:  # noqa: BLE001 - scheduling must not undo a decision
        logger.exception("timesheet decision notification scheduling failed timesheet_id=%s", timesheet_id)


def _create_decision_notification(timesheet_id: str, action: str, comment: str) -> None:
    """Direct post-commit creator; runs outside the decision transaction.

    Any failure is logged and swallowed so the committed decision survives.
    """
    from notifications.models import Notification

    titles = {
        "approve": "Your timesheet was approved",
        "reject": "Your timesheet was rejected",
        "return": "Your timesheet was returned for changes",
    }
    title = titles.get(action, "Your timesheet was updated")
    body = (comment or "")[:2000]
    try:
        sheet = Timesheet.objects.get(pk=timesheet_id)
        Notification.objects.create(recipient=sheet.employee, kind="timesheet_updated", title=title, body=body)
    except Exception:  # noqa: BLE001
        logger.exception("timesheet decision notification failed timesheet_id=%s", timesheet_id)


def _notify_employee_of_decision(timesheet_id: str, action: str, comment: str) -> None:
    """Schedule the post-commit notification for a committed decision."""
    from django.db import transaction as db_transaction

    db_transaction.on_commit(
        lambda: _create_decision_notification(timesheet_id, action, comment)
    )


def reopen_idempotency_fingerprint(*, key: str, timesheet_id, version: int, comment: str) -> tuple[str, str]:
    """Return (key_hash, payload_hash) for the reopen idempotency table."""
    from hashlib import sha256

    key_hash = sha256(key.encode()).hexdigest()
    payload_hash = sha256(f"{timesheet_id}:{version}:reopen:{comment}".encode()).hexdigest()
    return key_hash, payload_hash


def reopen_timesheet(
    *,
    hr_user,
    sheet: Timesheet,
    comment: str,
    version: int,
    key_hash: str,
    payload_hash: str,
):
    """HR-only reopen: APPROVED/REJECTED -> RETURNED under one lock.

    Opened records retain all prior history (append-only) and become
    employee-editable RETURNED sheets. Employees and managers can never
    reopen (LookupError -> 404). Requires mandatory reason, confirmation
    (validated by the view/serializer), Idempotency-Key, and a live version.
    """
    with transaction.atomic():
        locked = Timesheet.objects.select_for_update().get(pk=sheet.pk)

        if locked.employee_id == hr_user.pk:
            raise PermissionError("self_decision")
        if not hr_user.is_active or hr_user.role != User.Role.HR:
            raise LookupError("out_of_scope")

        existing = TimesheetDecisionIdempotencyRecord.objects.filter(
            key_hash=key_hash, user=hr_user
        ).first()
        if existing is not None:
            if existing.payload_hash == payload_hash:
                raise IdempotencyReplay(existing.response_snapshot)
            raise IdempotencyConflict()

        if locked.status not in REOPEN_STATE_ACTIONS:
            winner_row = TimesheetDecisionIdempotencyRecord.objects.filter(
                key_hash=key_hash, user=hr_user
            ).first()
            if winner_row is not None:
                if winner_row.payload_hash == payload_hash:
                    raise IdempotencyReplay(winner_row.response_snapshot)
                raise IdempotencyConflict()
            raise DecisionStateError(f"state_{locked.status}")

        if locked.version != version:
            raise VersionConflict(locked.version)

        from_status = locked.status
        to_status = Timesheet.Status.RETURNED

        locked.status = to_status
        locked.version += 1
        locked.save(update_fields=["status", "version", "updated_at"])

        TimesheetEvent.objects.create(
            timesheet=locked,
            actor=hr_user,
            action=TimesheetEvent.Action.REOPENED,
            from_status=from_status,
            to_status=to_status,
            comment=comment,
        )
        timesheet_id = str(locked.pk)
        AuditEvent.objects.create(
            actor=hr_user,
            subject=locked.employee,
            action="timesheet_reopened",
            request_id=timesheet_id,
            before={"status": from_status, "version": version},
            after={"status": to_status, "version": locked.version, "comment": comment[:500]},
        )

        winner = None
        try:
            with transaction.atomic():
                TimesheetDecisionIdempotencyRecord.objects.create(
                    key_hash=key_hash,
                    payload_hash=payload_hash,
                    response_snapshot={"timesheet_id": timesheet_id, "status": to_status},
                    user=hr_user,
                )
        except IntegrityError:
            winner_row = TimesheetDecisionIdempotencyRecord.objects.filter(
                key_hash=key_hash, user=hr_user
            ).first()
            if winner_row is None:
                raise IdempotencyConflict() from None
            winner = (winner_row.payload_hash, winner_row.response_snapshot)
        if winner is not None:
            if winner[0] != payload_hash:
                raise IdempotencyConflict()
            raise IdempotencyReplay(winner[1])

    _schedule_reopen_notification(timesheet_id, comment)
    return locked


def _schedule_reopen_notification(timesheet_id: str, comment: str) -> None:
    try:
        from django.db import transaction as db_transaction

        def _create():
            from notifications.models import Notification

            try:
                sheet = Timesheet.objects.get(pk=timesheet_id)
                Notification.objects.create(
                    recipient=sheet.employee,
                    kind="timesheet_updated",
                    title="Your timesheet was reopened",
                    body=(comment or "")[:2000],
                )
            except Exception:  # noqa: BLE001
                logger.exception("timesheet reopen notification failed timesheet_id=%s", timesheet_id)

        db_transaction.on_commit(_create)
    except Exception:  # noqa: BLE001
        logger.exception("timesheet reopen notification scheduling failed timesheet_id=%s", timesheet_id)
