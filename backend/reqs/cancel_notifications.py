"""Cancellation notifications (Story 2.5): post-commit, failure-isolated.

Mirrors decision_notifications (Story 2.4): the notification row is created
in transaction.on_commit with its own try/except so a notification failure
never rolls back the committed CANCELLED transition. The hook is scheduled
exactly once — only on the transition path, after the idempotency record
insert succeeded inside the locked transaction; the replay path returns
before any scheduling, so a replayed request never schedules a second
notification. The dedupe key carries the cancel idempotency key (Story 4.2):
a retried hook can never duplicate the row; a later cancel (impossible —
CANCELLED is terminal) or new event would use a new key.
"""
import logging

from django.db import transaction

logger = logging.getLogger(__name__)


def _notify_requester_of_cancel(request_id, dedupe_key: str = "") -> None:
    from notifications.services import create_notification

    try:
        request_obj = _load_request(request_id)
        create_notification(
            recipient=request_obj.requester,
            kind="request_updated",
            title="Your request was cancelled",
            body="You cancelled this request.",
            related_object_type="request",
            related_object_id=str(request_obj.pk),
            dedupe_key=dedupe_key,
        )
    except Exception:  # noqa: BLE001 - notification must never break the cancel
        logger.exception("cancel notification failed request_id=%s", request_id)


def _load_request(request_id):
    from reqs.models import EmployeeRequest

    return EmployeeRequest.objects.get(pk=request_id)


def notify_requester_of_cancel(request_id, key_hash: str = "") -> None:
    """Schedule a post-commit notification to the requester (Story 2.4 pattern)."""
    dedupe_key = f"request:{request_id}:cancelled:{key_hash}"
    transaction.on_commit(lambda: _notify_requester_of_cancel(request_id, dedupe_key))
