"""Cancellation notifications (Story 2.5): post-commit, failure-isolated.

Mirrors decision_notifications (Story 2.4): the notification row is created
in transaction.on_commit with its own try/except so a notification failure
never rolls back the committed CANCELLED transition. The hook is scheduled
exactly once — only on the transition path, after the idempotency record
insert succeeded inside the locked transaction; the replay path returns
before any scheduling, so a replayed request never schedules a second
notification.
"""
import logging

from django.db import transaction

logger = logging.getLogger(__name__)


def _notify_requester_of_cancel(request_id) -> None:
    from notifications.models import Notification

    try:
        request_obj = _load_request(request_id)
        Notification.objects.create(
            recipient=request_obj.requester,
            kind="request_updated",
            title="Your request was cancelled",
            body="You cancelled this request.",
        )
    except Exception:  # noqa: BLE001 - notification must never break the cancel
        logger.exception("cancel notification failed request_id=%s", request_id)


def _load_request(request_id):
    from reqs.models import EmployeeRequest

    return EmployeeRequest.objects.get(pk=request_id)


def notify_requester_of_cancel(request_id) -> None:
    """Schedule a post-commit notification to the requester (Story 2.4 pattern)."""
    transaction.on_commit(lambda: _notify_requester_of_cancel(request_id))
