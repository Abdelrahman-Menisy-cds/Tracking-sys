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
