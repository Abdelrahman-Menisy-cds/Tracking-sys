"""Announcement services: audience resolution, drafting, and the one send path.

Kept out of the view so the audience rule — the load-bearing decision of this
module — has ONE implementation the view, the send log and the tests all share.

Nothing here sends anything. There is no notification transport in this
product, so "publishing" means exactly two things: flip the row to PUBLISHED,
and append the delivery row that says the announcement is now in the in-app
feed. When a transport exists it adds a channel; it does not get simulated
here.
"""
from hashlib import sha256

from django.db import transaction
from django.utils import timezone

from accounts.models import Announcement, AnnouncementDelivery, User


class AnnouncementError(Exception):
    """A validation/policy violation the view maps to 422 on one field."""

    def __init__(self, code: str, field: str, message: str):
        self.code = code
        self.field = field
        self.message = message
        super().__init__(f"{code}: {field}: {message}")


class AnnouncementStateError(Exception):
    """Publishing something that is not a draft (mapped to 409)."""


class AnnouncementVersionConflict(Exception):
    """The client's version is stale against the locked row (mapped to 409)."""


def idempotency_fingerprint(*, key: str, payload: str) -> tuple[str, str]:
    """Return (key_hash, payload_hash) for the announcement idempotency table."""
    key_hash = sha256(key.encode()).hexdigest()
    payload_hash = sha256(payload.encode()).hexdigest()
    return key_hash, payload_hash


def resolve_audience_users(*, company, audience, recipient_ids=None):
    """The people an audience rule resolves to RIGHT NOW.

    ``ALL`` -> every active user of the company. ``SELECTED`` -> the active
    named users of the company. This is the single definition of "the audience",
    shared by publish (to snapshot the count) and by a draft's live preview, so
    the number the author sees and the number the log records come from one
    place.
    """
    base = User.objects.filter(company=company, is_active=True)
    if audience == Announcement.Audience.ALL:
        return list(base.order_by("pk"))
    if not recipient_ids:
        return []
    return list(base.filter(pk__in=list(recipient_ids)).order_by("pk"))


def validate_recipients(*, company, recipient_ids) -> list[int]:
    """Every named recipient must be an ACTIVE user of THIS company.

    Returns the valid ids, or raises naming ``recipients`` — a cross-tenant or
    unknown id is refused rather than silently dropped, which would send to
    fewer people than the author chose while still claiming success.
    """
    wanted = [int(rid) for rid in recipient_ids]
    if not wanted:
        raise AnnouncementError("validation_error", "recipients", "Choose at least one recipient.")
    found = set(
        User.objects.filter(company=company, is_active=True, pk__in=wanted).values_list("pk", flat=True)
    )
    unknown = [rid for rid in wanted if rid not in found]
    if unknown:
        raise AnnouncementError(
            "validation_error",
            "recipients",
            "Every recipient must be an active member of your company.",
        )
    return wanted


def create_draft(*, author, title, body, audience, recipient_ids=None) -> Announcement:
    """Author a DRAFT. The audience rule is stored, not resolved, until publish."""
    valid = []
    if audience == Announcement.Audience.SELECTED:
        valid = validate_recipients(company=author.company, recipient_ids=recipient_ids or [])
    with transaction.atomic():
        announcement = Announcement.objects.create(
            company=author.company,
            author=author,
            title=title,
            body=body,
            audience=audience,
            state=Announcement.State.DRAFT,
        )
        if valid:
            announcement.recipients.set(valid)
    return announcement


def publish_announcement(*, announcement, actor, expected_version, request_id=""):
    """Transition DRAFT -> PUBLISHED exactly once, and log what actually happened.

    Caller handles idempotency replay. Raises AnnouncementVersionConflict
    (409) or AnnouncementStateError (409). Returns (announcement, delivery):
    the delivery row is the send-log entry recording the audience snapshot and
    the count the rule resolved to — the in-app feed is the only channel.
    """
    with transaction.atomic():
        locked = Announcement.objects.select_for_update().get(pk=announcement.pk)
        if locked.version != expected_version:
            raise AnnouncementVersionConflict()
        if locked.state != Announcement.State.DRAFT:
            raise AnnouncementStateError()

        recipient_ids = list(locked.recipients.values_list("pk", flat=True))
        recipients = resolve_audience_users(
            company=locked.company,
            audience=locked.audience,
            recipient_ids=recipient_ids,
        )

        now = timezone.now()
        locked.state = Announcement.State.PUBLISHED
        locked.published_at = now
        locked.version += 1
        locked.save(update_fields=["state", "published_at", "version", "updated_at"])

        delivery = AnnouncementDelivery.objects.create(
            company=locked.company,
            announcement=locked,
            audience=locked.audience,
            recipient_count=len(recipients),
            channel=AnnouncementDelivery.Channel.IN_APP_FEED,
            sent_by=actor,
            sent_at=now,
            request_id=request_id or "",
        )
    return locked, delivery
