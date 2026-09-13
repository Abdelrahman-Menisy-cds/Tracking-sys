"""Transactional notification services (Story 4.2).

Creation is idempotent and failure-isolated: `create_notification` opens its
own transaction, deduplicates per (recipient, dedupe_key) with an
IntegrityError-safe retry path, and never raises for suppressed duplicates.
`mark_notification_read` is a transactional, idempotent read-state write
whose failure leaves the unread state untouched (AC: failure must not mark).
"""
import logging
import time

from django.core.exceptions import ObjectDoesNotExist
from django.db import IntegrityError, OperationalError, transaction
from django.utils import timezone

from notifications.models import Notification

logger = logging.getLogger(__name__)

RELATED_TYPES = frozenset({"request", "timesheet"})

# SQLite (the local/test fallback; the :memory: test database runs in
# shared-cache mode) raises OperationalError("database table is locked")
# when two connections race a write on the same table. The busy handler
# does NOT cover shared-cache table locks, so the caller must retry with a
# backoff. PostgreSQL (the approved production database) blocks writers
# instead of erroring, so this retry path never triggers there.
SQLITE_LOCKED_MARKERS = ("locked", "database schema is locked")
MAX_LOCK_ATTEMPTS = 8
RETRY_BASE_DELAY_SECONDS = 0.02
RETRY_MAX_DELAY_SECONDS = 0.25


def _is_retryable_lock_error(exc) -> bool:
    return isinstance(exc, OperationalError) and any(
        marker in str(exc).lower() for marker in SQLITE_LOCKED_MARKERS
    )


def _lock_retry_delay_seconds(attempt: int) -> float:
    return min(RETRY_MAX_DELAY_SECONDS, RETRY_BASE_DELAY_SECONDS * (2**attempt))


def _fetch_dedupe_winner(recipient, dedupe_key: str):
    """Fetch the existing deduped row, tolerating SQLite lock races."""
    for attempt in range(MAX_LOCK_ATTEMPTS):
        try:
            return Notification.objects.filter(
                recipient=recipient, dedupe_key=dedupe_key
            ).first()
        except OperationalError as exc:
            if not _is_retryable_lock_error(exc) or attempt == MAX_LOCK_ATTEMPTS - 1:
                return None
            time.sleep(_lock_retry_delay_seconds(attempt))
    return None


def _normalize(object_type, object_id):
    if not object_type:
        return "", ""
    if object_type not in RELATED_TYPES:
        logger.warning("unknown related_object_type=%r ignored", object_type)
        return "", ""
    object_id = str(object_id)
    if not object_id:
        return "", ""
    return object_type, object_id


def create_notification(
    *,
    recipient,
    kind: str,
    title: str,
    body: str = "",
    related_object_type: str = "",
    related_object_id="",
    dedupe_key: str = "",
):
    """Create a notification row idempotently; never change source state.

    Same (recipient, dedupe_key) retry/concurrent writer returns the existing
    row instead of duplicating it. Returns None if the dedupe winner cannot
    be resolved (should not happen), keeping failure-isolated callers safe.
    """
    related_object_type, related_object_id = _normalize(related_object_type, related_object_id)
    dedupe_key = dedupe_key[:128]
    for attempt in range(MAX_LOCK_ATTEMPTS):
        try:
            with transaction.atomic():
                return Notification.objects.create(
                    recipient=recipient,
                    kind=kind,
                    title=title[:255],
                    body=body,
                    related_object_type=related_object_type,
                    related_object_id=related_object_id,
                    dedupe_key=dedupe_key,
                )
        except IntegrityError:
            # Dedupe winner exists: return the stored row (idempotent).
            return _fetch_dedupe_winner(recipient, dedupe_key)
        except OperationalError as exc:
            if not _is_retryable_lock_error(exc) or attempt == MAX_LOCK_ATTEMPTS - 1:
                raise
            time.sleep(_lock_retry_delay_seconds(attempt))
    # Unreachable: the loop either returns or raises on its last attempt.
    raise OperationalError("notification create retry loop exhausted")  # pragma: no cover


def _resolve_viewer_object(user, related_object_type, related_object_id):
    """Resolve id->record only for viewers with read scope (no data leak).

    Returns True only when the viewer may read this exact record per the
    Story 4.1 scopes: owners see their own request/timesheet in any
    non-draft/live state; managers look through the Story 4.1 queue scope;
    HR sees organization records. Draft and out-of-scope/deleted records
    resolve False (same safe-unavailable treatment).
    """
    if not getattr(user, "is_authenticated", False) or not user.is_active:
        return False
    try:
        if related_object_type == "request":
            from reqs.models import EmployeeRequest

            from review.scope import scope_requests

            try:
                request_obj = EmployeeRequest.objects.get(pk=related_object_id)
            except EmployeeRequest.DoesNotExist:
                return False
            if request_obj.requester_id == user.pk:
                return True
            return request_obj in scope_requests(user)
        if related_object_type == "timesheet":
            from timesheets.models import Timesheet

            from review.scope import scope_timesheets

            try:
                sheet = Timesheet.objects.get(pk=related_object_id)
            except Timesheet.DoesNotExist:
                return False
            if sheet.employee_id == user.pk:
                return True
            return sheet in scope_timesheets(user)
    except Exception:  # noqa: BLE001 - availability must never raise to the API
        logger.exception("related object availability check failed")
        return False
    return False


def related_object_is_available(user, related_object_type, related_object_id) -> bool:
    """Public check used by serializers: safe True/False, never raises."""
    try:
        return _resolve_viewer_object(
            user, str(related_object_type or ""), str(related_object_id or "")
        )
    except Exception:  # noqa: BLE001
        return False


def mark_notification_read(notification_id, user):
    """Transactionally mark a user's notification read; idempotent.

    Returns the stored read_at on success. Any failure leaves the unread
    state (nothing is committed); the caller/API returns a retryable error.
    Cross-user ids are simply not found here.
    """
    from notifications.models import Notification

    from django.core.exceptions import ObjectDoesNotExist

    try:
        for attempt in range(MAX_LOCK_ATTEMPTS):
            try:
                with transaction.atomic():
                    notification = Notification.objects.select_for_update().filter(
                        recipient=user, pk=notification_id
                    ).first()
                    if notification is None:
                        raise ObjectDoesNotExist("notification not found")
                    if notification.read_at is None:
                        notification.read_at = timezone.now()
                        notification.save(update_fields=["read_at"])
                    return notification.read_at
            except OperationalError as exc:
                if not _is_retryable_lock_error(exc) or attempt == MAX_LOCK_ATTEMPTS - 1:
                    raise
                time.sleep(_lock_retry_delay_seconds(attempt))
        raise OperationalError("mark read retry loop exhausted")  # pragma: no cover
    except ObjectDoesNotExist:
        raise
    except Exception:
        logger.exception("mark_notification_read failed notification_id=%s", notification_id)
        raise
