"""Cancellation service (Story 2.5): requester cancel before decision.

Legal transitions: DRAFT, RETURNED, PENDING_MANAGER, PENDING_HR -> CANCELLED.
APPROVED / REJECTED / CANCELLED stay at 409 state_conflict with all history
preserved (state machine + product-policy item 3: cancellation is unavailable
after approval/rejection and requires confirmation plus audit).

Authorization mirrors decision_services: the requester check is re-executed
INSIDE the locked transaction (defense in depth) and a cross-user caller
receives the same 404 as a nonexistent request (404 policy, no existence
disclosure).

Idempotency mirrors Story 2.4 (Decisions): the CancelIdempotencyRecord
lookup AND insert run INSIDE the same locked transaction; the
UniqueConstraint(key_hash, user) is the serialization point, so concurrent
same-key requests deterministically yield exactly one transition/event —
the loser replays the winner's committed snapshot through IdempotencyReplay
or conflicts with IdempotencyConflict (409), never IntegrityError/500.
Records are scoped per user so a guessed key never leaks another user's
stored response.

Every legal transition: transaction.atomic + select_for_update, status +
version recheck (stale -> VersionConflict 409), version += 1, one
RequestEvent CANCELLED with from/to, AuditEvent request_cancelled
(actor=requester, subject=requester, request_id, before/after UTC), and a
post-commit, failure-isolated requester notification consistent with
Story 2.4.
"""
import logging

from django.db import IntegrityError, transaction

from accounts.models import AuditEvent
from reqs.models import CancelIdempotencyRecord, EmployeeRequest, RequestEvent
from reqs.serializers import EmployeeRequestSerializer

logger = logging.getLogger(__name__)

CANCELABLE_STATUSES = (
    EmployeeRequest.Status.DRAFT,
    EmployeeRequest.Status.RETURNED,
    EmployeeRequest.Status.PENDING_MANAGER,
    EmployeeRequest.Status.PENDING_HR,
)


class CancelStateError(Exception):
    """Cancellation not possible in the request's current state (409)."""


class VersionConflict(Exception):
    """Raised when the client version is stale against the locked row."""


class IdempotencyReplay(Exception):
    """Concurrent/sequential identical request lost the key race; carries the winner's snapshot."""

    def __init__(self, snapshot):
        self.snapshot = snapshot
        super().__init__("idempotency_replay")


class IdempotencyConflict(Exception):
    """Same idempotency key reused with a different payload (409)."""


def cancel_request(
    *,
    requester,
    request_obj: EmployeeRequest,
    version: int,
    key_hash: str,
    payload_hash: str,
):
    """Apply exactly one legal CANCELLED transition under one lock.

    Raises CancelStateError (409), VersionConflict (409),
    IdempotencyConflict (409), or PermissionError (not the requester,
    404-mapped by the view per the 404 policy). On success every committed
    change — status, version bump, event, audit, idempotency record — is
    atomic; the notification is scheduled only after commit.
    """
    with transaction.atomic():
        locked = EmployeeRequest.objects.select_for_update().get(pk=request_obj.pk)

        # Re-read the requester row inside the lock: an account deactivated
        # between authentication and this transaction must not cancel.
        from accounts.models import User

        requester = User.objects.select_for_update().get(pk=requester.pk)
        if locked.requester_id != requester.pk:
            raise LookupError("not_requester")
        if not requester.is_active:
            raise LookupError("not_requester")

        existing = CancelIdempotencyRecord.objects.filter(
            key_hash=key_hash, user=requester
        ).first()
        if existing is not None:
            if existing.payload_hash == payload_hash:
                raise IdempotencyReplay(existing.response_snapshot)
            raise IdempotencyConflict()

        if locked.status not in CANCELABLE_STATUSES:
            # A same-key winner may have committed before this request got
            # the lock: re-read the record before exposing state_conflict.
            winner_row = CancelIdempotencyRecord.objects.filter(
                key_hash=key_hash, user=requester
            ).first()
            if winner_row is not None:
                if winner_row.payload_hash == payload_hash:
                    raise IdempotencyReplay(winner_row.response_snapshot)
                raise IdempotencyConflict()
            raise CancelStateError(f"state_{locked.status}")

        if locked.version != version:
            raise VersionConflict(locked.version)

        from_status = locked.status
        to_status = EmployeeRequest.Status.CANCELLED
        request_id = str(locked.pk)
        locked.status = to_status
        # Terminal state: nothing is pending anymore; keep manager snapshot
        # for history but the request has no active assignee.
        locked.current_assignee = None
        locked.version += 1
        locked.save(update_fields=["status", "current_assignee", "version", "updated_at"])

        RequestEvent.objects.create(
            request=locked,
            actor=requester,
            action=RequestEvent.Action.CANCELLED,
            from_status=from_status,
            to_status=to_status,
        )
        AuditEvent.objects.create(
            actor=requester,
            subject=requester,
            action="request_cancelled",
            request_id=request_id,
            before={"status": from_status, "version": version},
            after={"status": to_status, "version": locked.version},
        )

        # Idempotency record committed atomically with the transition — the
        # nested atomic is a savepoint, so an IntegrityError from a
        # concurrent winner rolls back only the insert; the still-live outer
        # transaction re-reads the winner's row (decision_services pattern).
        winner = None
        try:
            with transaction.atomic():
                CancelIdempotencyRecord.objects.create(
                    key_hash=key_hash,
                    payload_hash=payload_hash,
                    response_snapshot={
                        "data": EmployeeRequestSerializer(locked).data
                    },
                    user=requester,
                )
        except IntegrityError:
            winner_row = CancelIdempotencyRecord.objects.filter(
                key_hash=key_hash, user=requester
            ).first()
            if winner_row is None:
                raise IdempotencyConflict() from None
            winner = (winner_row.payload_hash, winner_row.response_snapshot)
        if winner is not None:
            if winner[0] != payload_hash:
                raise IdempotencyConflict()
            raise IdempotencyReplay(winner[1])

    _schedule_cancel_notification(request_id)
    return locked


def _schedule_cancel_notification(request_id: str) -> None:
    """Schedule the committed cancellation notification without risking it."""
    try:
        from reqs.cancel_notifications import notify_requester_of_cancel

        notify_requester_of_cancel(request_id)
    except Exception:  # noqa: BLE001 - scheduling must not undo a cancellation
        logger.exception(
            "cancel notification scheduling failed request_id=%s", request_id
        )
