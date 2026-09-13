from django.conf import settings
from django.db import models
from django.db.models import Q


class Notification(models.Model):
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    kind = models.CharField(max_length=64)
    title = models.CharField(max_length=255)
    body = models.TextField(blank=True)
    # Localization-ready fields (Story 5.2 contract): stable `kind` plus
    # title/body copy generated in the platform language; clients may localize
    # via kind + related_object reference without re-parsing free text.
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)
    # Related object reference (architecture §4.4): opaque type/id pair, no
    # FK — the notification survives deletion of the related record and its
    # link resolves per-request to a safe "unavailable" marker when the
    # record is deleted or hidden from this recipient.
    related_object_type = models.CharField(max_length=32, blank=True, default="")
    related_object_id = models.CharField(max_length=64, blank=True, default="")
    # Dedupe key for idempotent post-commit creation (Story 4.2): scoped to a
    # single source event (e.g. "request:<id>:approved:v3"), so a retried
    # post-commit job or a concurrent writer cannot duplicate a notification,
    # while a later decision carries a new key and notifies again. Non-empty
    # keys are unique per recipient; empty-key rows (retry-until-success
    # transport) are never suppressed by design.
    dedupe_key = models.CharField(max_length=128, blank=True, default="", db_index=True)

    class Meta:
        ordering = ("-created_at", "-pk")
        constraints = [
            models.UniqueConstraint(
                fields=("recipient", "dedupe_key"),
                condition=~Q(dedupe_key=""),
                name="uniq_notification_recipient_dedupe_key",
            ),
        ]

    def __str__(self) -> str:
        return self.title
