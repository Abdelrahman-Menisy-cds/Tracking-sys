"""Decision notifications (Story 2.4): post-commit, failure-isolated.

The decision transaction must never roll back because a notification failed
(AC-04 / contract): creation runs inside transaction.on_commit with its own
try/except and logging.

QA duplicate-notification claim reviewed (Story 2.4 QA fix round): there is
no duplicate/retry path. The on_commit hook is scheduled exactly once — only
on the transition path, after the idempotency record insert succeeded inside
the locked transaction; the replay path (stored snapshot or concurrent
IdempotencyReplay) returns before any scheduling, so a retried request can
never schedule a second notification. A crash between commit and callback
fires the hook exactly once on callback execution (Django runs each
registered callback once per commit; it does not re-fire). Deliberately NO
(request, kind) unique constraint: after RETURNED -> resubmit -> re-decide,
the requester must receive a NEW notification for the later decision — such
a constraint would suppress legitimate outcomes (documented decision; no
schema change).
"""
import logging

from django.db import transaction

logger = logging.getLogger(__name__)


def _notify_requester(request_id, kind: str, title: str, body: str) -> None:
    """Create the notification row outside the decision transaction.

    Opens its own query context because it runs after the decision commit;
    any failure is logged and swallowed so the decision outcome survives.
    """
    from notifications.models import Notification
    from reqs.models import EmployeeRequest

    try:
        request_obj = EmployeeRequest.objects.get(pk=request_id)
        Notification.objects.create(
            recipient=request_obj.requester,
            kind=kind,
            title=title,
            body=body,
        )
    except Exception:  # noqa: BLE001 - notification must never break the decision
        logger.exception("decision notification failed request_id=%s kind=%s", request_id, kind)


def notify_requester_of_decision(request_id, action: str, comment: str) -> None:
    """Schedule a post-commit notification to the requester for the outcome.

    kind uses the notification vocabulary already used by the app
    (request_updated); the title carries the decision outcome.
    """
    titles = {
        "approve": "Your request was approved",
        "reject": "Your request was rejected",
        "return": "Your request was returned for changes",
    }
    title = titles.get(action, "Your request was updated")
    body = (comment or "")[:2000]

    transaction.on_commit(lambda: _notify_requester(request_id, "request_updated", title, body))
