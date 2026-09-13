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


def _notify_requester(request_id, kind: str, title: str, body: str, dedupe_key: str = "") -> None:
    """Create the notification row outside the decision transaction.

    Opens its own query context because it runs after the decision commit;
    any failure is logged and swallowed so the decision outcome survives.
    The dedupe key scopes to this exact decision outcome so a retried
    post-commit job or concurrent winner cannot duplicate it (Story 4.2),
    while a later decision carries a new version/key and notifies again.
    Idempotency-replay scheduling never reaches this creator.
    """
    from notifications.services import create_notification
    from reqs.models import EmployeeRequest

    try:
        request_obj = EmployeeRequest.objects.get(pk=request_id)
        create_notification(
            recipient=request_obj.requester,
            kind=kind,
            title=title,
            body=body,
            related_object_type="request",
            related_object_id=str(request_obj.pk),
            dedupe_key=dedupe_key,
        )
    except Exception:  # noqa: BLE001 - notification must never break the decision
        logger.exception("decision notification failed request_id=%s kind=%s", request_id, kind)


def notify_requester_of_decision(request_id, action: str, comment: str, key_hash: str = "") -> None:
    """Schedule a post-commit notification to the requester for the outcome.

    kind uses the notification vocabulary already used by the app
    (request_updated); the title carries the decision outcome. The dedupe
    key incorporates the command's own idempotency key, so a retried
    post-commit job or a duplicate hook execution cannot create a second
    row for the same committed decision, while a later decision (new key)
    notifies again (Story 4.2, no schema change to idempotency records).
    """
    titles = {
        "approve": "Your request was approved",
        "reject": "Your request was rejected",
        "return": "Your request was returned for changes",
    }
    title = titles.get(action, "Your request was updated")
    body = (comment or "")[:2000]
    dedupe_key = f"request:{request_id}:{action}:{key_hash}"

    transaction.on_commit(lambda: _notify_requester(request_id, "request_updated", title, body, dedupe_key))
