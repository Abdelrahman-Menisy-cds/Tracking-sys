"""Announcement serializers: the read shape the SPA renders and the write shapes
the API validates.

Validation is deliberately thin where the service is the authority (recipient
membership lives in announcement_services.validate_recipients) and explicit
where the wire shape is (audience is a closed list; title/body may not be
blank), so the two can never disagree about what a valid write is.

The read side is a plain function rather than a ModelSerializer because the
count and the recipient list depend on who is asking (HR vs a recipient) and on
whether the row was published — a per-request computation the function states
once.
"""
from rest_framework import serializers

from accounts.announcement_services import resolve_audience_users
from accounts.models import Announcement


def _iso(value):
    """A datetime as an ISO string, or None — the shape DRF renders anyway.

    Returning strings (not datetime objects) keeps the payload JSON-safe, which
    matters because the SAME dict is stored as the idempotency response
    snapshot: a stored replay and a fresh response must be byte-identical.
    """
    return value.isoformat() if value is not None else None


def serialize_announcement(announcement, *, is_hr: bool) -> dict:
    """One announcement as the SPA needs it.

    ``recipient_count`` is the SNAPSHOT the delivery recorded once the row is
    PUBLISHED, and the live resolved count while it is still a DRAFT (nothing
    has been sent yet, so the honest number is what it WOULD reach). The
    ``recipients`` list is returned only to HR on a SELECTED announcement — a
    recipient reading their own feed learns nothing about who else was named.
    """
    delivery = None
    if announcement.state == Announcement.State.PUBLISHED:
        delivery = max(announcement.deliveries.all(), key=lambda row: (row.sent_at, row.pk), default=None)

    if delivery is not None:
        recipient_count = delivery.recipient_count
    else:
        recipient_count = len(
            resolve_audience_users(
                company=announcement.company,
                audience=announcement.audience,
                recipient_ids=[user.pk for user in announcement.recipients.all()],
            )
        )

    payload = {
        "id": announcement.pk,
        "title": announcement.title,
        "body": announcement.body,
        "audience": announcement.audience,
        "state": announcement.state,
        "published_at": _iso(announcement.published_at),
        "version": announcement.version,
        "created_at": _iso(announcement.created_at),
        "updated_at": _iso(announcement.updated_at),
        "author_id": announcement.author_id,
        "author_name": announcement.author.full_name or announcement.author.email,
        "recipient_count": recipient_count,
        "recipients": [],
    }
    if is_hr and announcement.audience == Announcement.Audience.SELECTED:
        payload["recipients"] = [
            {"id": user.pk, "name": user.full_name or user.email} for user in announcement.recipients.all()
        ]
    return payload


def serialize_delivery(delivery) -> dict:
    """One send-log row: what was sent, to which audience, when, by whom."""
    return {
        "id": delivery.pk,
        "announcement_id": delivery.announcement_id,
        "announcement_title": delivery.announcement.title,
        "audience": delivery.audience,
        "recipient_count": delivery.recipient_count,
        "channel": delivery.channel,
        "sent_by_id": delivery.sent_by_id,
        "sent_by_name": delivery.sent_by.full_name or delivery.sent_by.email,
        "sent_at": _iso(delivery.sent_at),
        "request_id": delivery.request_id,
    }


class AnnouncementWriteSerializer(serializers.Serializer):
    """The create-a-draft body. ``recipients`` is ignored unless audience=SELECTED."""

    title = serializers.CharField(max_length=200)
    body = serializers.CharField()
    audience = serializers.ChoiceField(choices=Announcement.Audience.choices)
    recipients = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        default=list,
    )

    def validate_title(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field may not be blank.")
        return value

    def validate_body(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field may not be blank.")
        return value


class AnnouncementPublishSerializer(serializers.Serializer):
    """The publish body: the version the author last saw (optimistic concurrency)."""

    version = serializers.IntegerField(min_value=1)
