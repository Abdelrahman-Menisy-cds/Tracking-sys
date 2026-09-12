"""Requests: employee request drafts and their append-only event history.

Story 2.1 covers DRAFT creation and requester-only editing. Submission,
decisions, attachments, and cancellation belong to Stories 2.2+; the status
choices already match specs/request-state-machine.md so later stories never
migrate the state field.
"""
from uuid import uuid4

from django.conf import settings
from django.db import models


class RequestType(models.Model):
    """HR-configurable request type. HR config UI arrives in a later story."""

    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True, default="")
    requires_manager_approval = models.BooleanField(default=False)
    requires_hr_approval = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class EmployeeRequest(models.Model):
    """A request owned by exactly one requester; server-managed workflow state."""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING_MANAGER = "PENDING_MANAGER", "Pending manager"
        PENDING_HR = "PENDING_HR", "Pending HR"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        RETURNED = "RETURNED", "Returned"
        CANCELLED = "CANCELLED", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="employee_requests",
    )
    request_type = models.ForeignKey(
        RequestType,
        on_delete=models.PROTECT,
        related_name="requests",
    )
    title = models.CharField(max_length=255)
    details = models.TextField(max_length=10_000, blank=True, default="")
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )
    manager_at_submission = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="requests_to_review",
    )
    current_assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="requests_assigned",
    )
    version = models.IntegerField(default=1)
    submitted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "-id")
        verbose_name = "employee request"
        verbose_name_plural = "employee requests"

    def __str__(self) -> str:
        return f"{self.title} ({self.status})"


class RequestEvent(models.Model):
    """Append-only history: one row per create/edit action (constitution §4)."""

    class Action(models.TextChoices):
        CREATED = "CREATED", "Created"
        EDITED = "EDITED", "Edited"
        SUBMITTED = "SUBMITTED", "Submitted"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        RETURNED = "RETURNED", "Returned"
        CANCELLED = "CANCELLED", "Cancelled"

    request = models.ForeignKey(
        EmployeeRequest,
        on_delete=models.CASCADE,
        related_name="events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="request_events",
    )
    action = models.CharField(max_length=16, choices=Action.choices)
    # Action.CANCELLED arrives with Story 2.5.
    from_status = models.CharField(max_length=32, choices=EmployeeRequest.Status.choices, null=True, blank=True)
    to_status = models.CharField(max_length=32, choices=EmployeeRequest.Status.choices, null=True, blank=True)
    comment = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("created_at", "id")
        verbose_name = "request event"
        verbose_name_plural = "request events"

    def __str__(self) -> str:
        return f"{self.action} on {self.request_id} by {self.actor_id}"


class RequestAttachment(models.Model):
    """Request attachment (Story 2.2): private opaque-key stored file.

    Policy (product-policy-decisions.md item 5, AC-03): PDF/PNG/JPG/DOCX only,
    10MB per file, 5 files per request, 25MB total; async malware scan with
    quarantine until CLEAN; downloads only through Django-authorized paths,
    never public media URLs. Storage keys are uuid-based and never derived
    from client filenames; original_filename is sanitized display-only.
    """

    class ScanStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        CLEAN = "CLEAN", "Clean"
        FAILED = "FAILED", "Failed"
        REJECTED = "REJECTED", "Rejected"

    ALLOWED_CONTENT_TYPES = (
        "application/pdf",
        "image/png",
        "image/jpeg",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    ALLOWED_EXTENSIONS = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    request = models.ForeignKey(
        EmployeeRequest,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="uploaded_attachments",
    )
    # Opaque random key: MEDIA_ROOT/attachments/<uuid>/ ... never filename-derived.
    storage_key = models.CharField(max_length=255, unique=True)
    original_filename = models.CharField(max_length=255)
    declared_content_type = models.CharField(max_length=128)
    detected_content_type = models.CharField(max_length=128)
    size_bytes = models.PositiveBigIntegerField()
    content_sha256 = models.CharField(max_length=64)
    scan_status = models.CharField(
        max_length=16,
        choices=ScanStatus.choices,
        default=ScanStatus.PENDING,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("created_at", "id")
        verbose_name = "request attachment"
        verbose_name_plural = "request attachments"

    def __str__(self) -> str:
        return f"{self.original_filename} ({self.scan_status})"

    @property
    def allows_edit(self) -> bool:
        """True while the parent request still accepts attachment changes."""
        return self.request.status in (
            EmployeeRequest.Status.DRAFT,
            EmployeeRequest.Status.RETURNED,
        )


class AttachmentIdempotencyRecord(models.Model):
    """Stored upload idempotency: key hash + payload hash + response snapshot.

    Same key + same payload (file content + declared type + filename) returns
    the original 201 response; differing payload with same key -> 409.
    """

    key_hash = models.CharField(max_length=64, unique=True, db_index=True)
    payload_hash = models.CharField(max_length=64)
    response_snapshot = models.JSONField()
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="upload_idempotency_records",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "attachment idempotency record"
        verbose_name_plural = "attachment idempotency records"


class SubmissionIdempotencyRecord(models.Model):
    """Stored submission idempotency (Story 2.3): key hash + payload hash + snapshot.

    Same key + same payload (request id + expected version) replays the original
    200 response without a duplicate transition; differing payload -> 409.
    """

    key_hash = models.CharField(max_length=64, unique=True, db_index=True)
    payload_hash = models.CharField(max_length=64)
    response_snapshot = models.JSONField()
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="submission_idempotency_records",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "submission idempotency record"
        verbose_name_plural = "submission idempotency records"


class DecisionIdempotencyRecord(models.Model):
    """Stored decision idempotency (Story 2.4): key hash + payload hash + snapshot.

    Same key + same payload (request id + version + action + comment) replays
    the original 200 response without a duplicate transition; differing
    payload -> 409. The user FK scopes lookup per reviewer (submission_services
    note): the view looks up by (key_hash, user) so a key reused by a different
    reviewer is simply unknown to them, while the same key held by two users
    never leaks one reviewer's snapshot to the other.
    """

    key_hash = models.CharField(max_length=64, db_index=True)
    payload_hash = models.CharField(max_length=64)
    response_snapshot = models.JSONField()
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="decision_idempotency_records",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["key_hash", "user"], name="uniq_decision_idem_key_user")
        ]
        verbose_name = "decision idempotency record"
        verbose_name_plural = "decision idempotency records"


class CancelIdempotencyRecord(models.Model):
    """Stored cancellation idempotency (Story 2.5): same pattern as decisions.

    Same key + same payload (request id + expected version) replays the
    original 200 response without a duplicate transition/event; differing
    payload -> 409. Scoped per user: the view looks up by (key_hash, user),
    so a key guessed by another user is simply unknown to them and never
    leaks one requester's stored snapshot to someone else.
    """

    key_hash = models.CharField(max_length=64, db_index=True)
    payload_hash = models.CharField(max_length=64)
    response_snapshot = models.JSONField()
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="cancel_idempotency_records",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["key_hash", "user"], name="uniq_cancel_idem_key_user")
        ]
        verbose_name = "cancel idempotency record"
        verbose_name_plural = "cancel idempotency records"
