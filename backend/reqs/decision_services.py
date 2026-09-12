"""Decision services (Story 2.4): locked, versioned, append-only transitions.

Authorization is re-checked INSIDE the locked transaction (defense in
depth; the view's only fetch does not scope): requester is never a reviewer
(self-decision denied), manager scope is manager_at_submission == reviewer
AND reviewer active AND role MANAGER AND request in PENDING_MANAGER, HR
scope is reviewer active AND role == HR AND request in PENDING_HR (defense
in depth: an authenticated-but-inactive reviewer is denied with zero
transition/event). A reviewer outside scope
gets the same 404 as a nonexistent request (404 policy, no existence
disclosure); a scope-eligible reviewer on a non-pending state gets 409.

Every legal transition: transaction.atomic + select_for_update, re-check
status + version (stale -> VersionConflict 409), exactly one transition,
version += 1, append-only RequestEvent + AuditEvent, post-commit
notification to the requester (failure-isolated). Invalid action/state
combos raise DecisionStateError (409) with no mutation and no event.
"""
import logging

from django.db import IntegrityError, transaction

from accounts.models import AuditEvent, User
from reqs.decision_notifications import notify_requester_of_decision
from reqs.models import DecisionIdempotencyRecord, EmployeeRequest, RequestEvent
from reqs.serializers import EmployeeRequestSerializer

logger = logging.getLogger(__name__)

DECISION_ACTIONS = ("approve", "reject", "return")


class DecisionStateError(Exception):
    """Invalid action/state combination; mapped to 409 state_conflict."""


class VersionConflict(Exception):
    """Raised when the client version is stale against the locked row."""


def _authorize_reviewer(locked: EmployeeRequest, reviewer) -> str:
    """Return the reviewer's role for this request, independent of state.

    Idempotent retries may arrive after the winner changed the request state,
    so authorization must be checked before replaying a stored response while
    remaining independent of the pending-state transition rules.
    """
    if locked.requester_id == reviewer.pk:
        raise PermissionError("self_decision")
    if not reviewer.is_active:
        raise LookupError("out_of_scope")
    if reviewer.role == "MANAGER" and locked.manager_at_submission_id == reviewer.pk:
        return "manager"
    if reviewer.role == "HR":
        return "hr"
    raise LookupError("out_of_scope")


def _resolve_scope(locked: EmployeeRequest, reviewer) -> str:
    """Return 'manager' / 'hr' when the reviewer may act on this request.

    Raises PermissionError for self-decision. Out-of-scope reviewers get
    LookupError (view maps to 404, permission-matrix 404 policy) — no
    existence disclosure regardless of state. A scope-eligible reviewer
    whose request is in a non-pending state gets DecisionStateError (409
    state_conflict) instead of a scope denial.
    """
    if locked.requester_id == reviewer.pk:
        raise PermissionError("self_decision")
    if locked.status == EmployeeRequest.Status.PENDING_MANAGER:
        if (
            locked.manager_at_submission_id == reviewer.pk
            and reviewer.is_active
            and reviewer.role == "MANAGER"
        ):
            return "manager"
        raise LookupError("out_of_scope")
    if locked.status == EmployeeRequest.Status.PENDING_HR:
        # Active check here (not just at authentication) mirrors the manager
        # branch: an authenticated-but-deactivated HR reviewer must receive a
        # safe denial, never a transition or event (QA finding A).
        if reviewer.is_active and reviewer.role == "HR":
            return "hr"
        raise LookupError("out_of_scope")
    # Non-pending state: 409 only for a reviewer who could have acted on
    # this request (snapshot manager or HR); everyone else stays 404.
    is_snapshot_manager = (
        locked.manager_at_submission_id == reviewer.pk
        and reviewer.is_active
        and reviewer.role == "MANAGER"
    )
    if is_snapshot_manager or (reviewer.is_active and reviewer.role == "HR"):
        raise DecisionStateError(f"state_{locked.status}")
    raise LookupError("out_of_scope")


_TRANSITIONS = {
    # (scope, action) -> target status; manager approve routes to PENDING_HR
    # when the type requires HR approval, else final APPROVED.
    ("manager", "approve"): {"hr_required": EmployeeRequest.Status.PENDING_HR, "final": EmployeeRequest.Status.APPROVED},
    ("manager", "reject"): {"final": EmployeeRequest.Status.REJECTED},
    ("manager", "return"): {"final": EmployeeRequest.Status.RETURNED},
    ("hr", "approve"): {"final": EmployeeRequest.Status.APPROVED},
    ("hr", "reject"): {"final": EmployeeRequest.Status.REJECTED},
    ("hr", "return"): {"final": EmployeeRequest.Status.RETURNED},
}


_EVENT_ACTION = {"approve": RequestEvent.Action.APPROVED, "reject": RequestEvent.Action.REJECTED, "return": RequestEvent.Action.RETURNED}
_AUDIT_ACTION = {"approve": "request_approved", "reject": "request_rejected", "return": "request_returned"}


class IdempotencyReplay(Exception):
    """Concurrent/sequential identical request lost the key race; carries the winner's snapshot."""

    def __init__(self, snapshot):
        self.snapshot = snapshot
        super().__init__("idempotency_replay")


class IdempotencyConflict(Exception):
    """Same idempotency key reused with a different payload (409)."""


def decide_request(
    *,
    reviewer,
    request_obj: EmployeeRequest,
    action: str,
    comment: str,
    version: int,
    key_hash: str,
    payload_hash: str,
):
    """Apply exactly one legal decision transition under one lock.

    The DecisionIdempotencyRecord lookup and insert happen INSIDE the same
    locked transaction as the transition (QA finding B): the row's
    UniqueConstraint(key_hash, user) is the serialization point, so two
    concurrent identical requests deterministically yield exactly one
    transition/event and one 200 — the loser gets IdempotencyReplay (200,
    winner's response) with no second event and no IntegrityError. A
    conflicting payload with the same key raises IdempotencyConflict (409).

    Raises VersionConflict (409), DecisionStateError (409),
    IdempotencyConflict (409), PermissionError (self-decision, 403-mapped
    by the caller contract), or LookupError (out-of-scope, 404-mapped).
    """
    if action not in DECISION_ACTIONS:
        raise DecisionStateError(f"unknown action {action}")

    with transaction.atomic():
        # One lock serializes both the idempotency insert and the transition
        # for the same request row.
        locked = EmployeeRequest.objects.select_for_update().get(pk=request_obj.pk)

        # Defense in depth (QA finding A): the reviewer's active flag is
        # re-read from the database inside the locked transaction. A reviewer
        # object that reached this call stale (deactivated between
        # authentication and this transaction) must be denied with zero
        # transition/event/idempotency record.
        reviewer = User.objects.select_for_update().get(pk=reviewer.pk)

        # Authorization is intentionally before idempotency replay. A guessed
        # key must not disclose another reviewer's stored response, and a
        # reviewer who is no longer active must not replay it. Unlike
        # _resolve_scope, this check does not require the request to remain
        # pending: the winner may already have transitioned it.
        _authorize_reviewer(locked, reviewer)

        # In-transaction idempotency check (same lock): a record from a
        # PREVIOUSLY committed request replays/conflicts BEFORE any
        # transition is attempted; a CONCURRENT winner is caught below by the
        # insert's IntegrityError on the same unique constraint.
        existing = DecisionIdempotencyRecord.objects.filter(
            key_hash=key_hash, user=reviewer
        ).first()
        if existing is not None:
            if existing.payload_hash == payload_hash:
                raise IdempotencyReplay(existing.response_snapshot)
            raise IdempotencyConflict()

        try:
            scope = _resolve_scope(locked, reviewer)
        except DecisionStateError:
            # A same-key winner may have committed the transition before this
            # request acquired the request lock. Re-read the record before
            # exposing state_conflict; authorization was already checked above.
            winner_row = DecisionIdempotencyRecord.objects.filter(
                key_hash=key_hash, user=reviewer
            ).first()
            if winner_row is not None:
                if winner_row.payload_hash == payload_hash:
                    raise IdempotencyReplay(winner_row.response_snapshot)
                raise IdempotencyConflict()
            raise
        # _resolve_scope grants manager scope only in PENDING_MANAGER and HR
        # scope only in PENDING_HR; every other state raises before this line.
        transition = _TRANSITIONS[(scope, action)]
        if locked.version != version:
            raise VersionConflict(locked.version)

        from_status = locked.status
        if "hr_required" in transition:
            to_status = (
                EmployeeRequest.Status.PENDING_HR
                if locked.request_type.requires_hr_approval
                else transition["final"]
            )
        else:
            to_status = transition["final"]

        locked.status = to_status
        # PENDING_HR leaves the request unassigned: the HR queue resolves the
        # reviewer at review time (Story 2.3 submit pattern).
        locked.current_assignee = None
        locked.version += 1
        locked.save(update_fields=["status", "current_assignee", "version", "updated_at"])

        RequestEvent.objects.create(
            request=locked,
            actor=reviewer,
            action=_EVENT_ACTION[action],
            from_status=from_status,
            to_status=to_status,
            comment=comment,
        )
        request_id = str(locked.pk)
        AuditEvent.objects.create(
            actor=reviewer,
            subject=locked.requester,
            action=_AUDIT_ACTION[action],
            request_id=request_id,
            before={"status": from_status, "version": version},
            after={"status": to_status, "version": locked.version, "comment": comment[:500]},
        )

        # Idempotency record committed atomically with the transition: the
        # DB-level unique constraint arbitrates concurrent same-key requests.
        # Nested atomic = savepoint, so an IntegrityError from a concurrent
        # winner's committed row rolls back only the insert; the still-live
        # outer transaction can then re-read the winner's row. Anyone can
        # beat us to the key, but the DB just rejected our insert, so the
        # row must exist; if it somehow doesn't (never happens under a real
        # constraint race), treat it as a clean conflict rather than a 500.
        winner = None
        try:
            with transaction.atomic():
                DecisionIdempotencyRecord.objects.create(
                    key_hash=key_hash,
                    payload_hash=payload_hash,
                    response_snapshot={"data": EmployeeRequestSerializer(locked).data},
                    user=reviewer,
                )
        except IntegrityError:
            winner_row = DecisionIdempotencyRecord.objects.filter(
                key_hash=key_hash, user=reviewer
            ).first()
            if winner_row is None:
                # No committed winner row is visible (shouldn't happen under
                # a genuine constraint race); refuse cleanly instead of 500.
                raise IdempotencyConflict() from None
            winner = (winner_row.payload_hash, winner_row.response_snapshot)
        if winner is not None:
            if winner[0] != payload_hash:
                # Concurrent conflicting retry: same key, different payload.
                raise IdempotencyConflict()
            # Concurrent identical retry: replay the winner's snapshot; our
            # transition + events roll back (zero second event).
            raise IdempotencyReplay(winner[1])

    _schedule_decision_notification(request_id, action, comment)
    return locked


def _schedule_decision_notification(request_id: str, action: str, comment: str) -> None:
    """Schedule a committed decision notification without risking its outcome."""
    try:
        notify_requester_of_decision(request_id, action, comment)
    except Exception:  # noqa: BLE001 - scheduling must not undo a decision
        logger.exception("decision notification scheduling failed request_id=%s", request_id)
