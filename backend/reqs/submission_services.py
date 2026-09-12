"""Request submission services (Story 2.3): server-derived routing transitions.

Routing is read from RequestType on the server; the manager reviewer is
snapshotted from the requester's EmployeeProfile at submission time (policy
item 1). No-manager and inactive-reviewer submissions are blocked with an
auditable event — never silently rerouted (HR-queue visibility arrives with
Epic 4). Every legal transition is locked, versioned, append-only, and
idempotent per the shared idempotency pattern.

Blocked-attempt audits must survive the failing request transaction, so
manager resolution runs OUTSIDE the transition transaction (phase 2) while
state/version/attachment validation runs inside the first locked transaction
(phase 1); the transition re-locks and re-checks in phase 3.
"""
from hashlib import sha256

from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from accounts.models import AuditEvent, EmployeeProfile
from reqs.models import (
    EmployeeRequest,
    RequestAttachment,
    RequestEvent,
)

SUBMITTABLE_STATUSES = (
    EmployeeRequest.Status.DRAFT,
    EmployeeRequest.Status.RETURNED,
)


class SubmissionError(Exception):
    """Raised on a policy violation; carries a 422-mapped field/message/code."""

    def __init__(self, code: str, field: str, message: str, detail: str = ""):
        self.code = code
        self.field = field
        self.message = message
        self.detail = detail
        super().__init__(f"{code}: {field}: {message}")


class VersionConflict(Exception):
    """Raised when the client version is stale against the locked row."""


def idempotency_fingerprint(*, key: str, request_id, version: int) -> tuple[str, str]:
    """Return (key_hash, payload_hash) for the submission idempotency table."""
    key_hash = sha256(key.encode()).hexdigest()
    payload_hash = sha256(f"{request_id}:{version}".encode()).hexdigest()
    return key_hash, payload_hash


def submit_request(*, requester, request_obj: EmployeeRequest, version: int):
    """Transition DRAFT/RETURNED -> PENDING_MANAGER/PENDING_HR exactly once.

    Caller handles idempotency replay. Raises SubmissionError (422-mapped),
    VersionConflict (409-mapped), or PermissionError (409 state conflict).
    """
    # Phase 1: locked validation of state, version, type, and attachments.
    with transaction.atomic():
        locked = EmployeeRequest.objects.select_for_update().get(pk=request_obj.pk)
        if locked.requester_id != requester.pk:
            # Defense in depth: the view already 404s cross-user access.
            raise PermissionError("not_requester")
        if locked.status not in SUBMITTABLE_STATUSES:
            raise PermissionError(f"state_{locked.status}")
        if locked.version != version:
            raise VersionConflict(locked.version)

        request_type = locked.request_type
        if not request_type.is_active:
            raise SubmissionError(
                "validation_error",
                "request_type",
                _("This request type is no longer active and cannot be submitted."),
            )
        if not request_type.requires_manager_approval and not request_type.requires_hr_approval:
            raise SubmissionError(
                "validation_error",
                "request_type",
                _(
                    "This request type has no configured reviewer (neither "
                    "manager nor HR approval); contact HR to fix its routing."
                ),
            )
        _assert_attachments_clean(locked)

        previous_status = locked.status
        request_id = str(locked.pk)
        requires_manager = request_type.requires_manager_approval
        hr_only = request_type.requires_hr_approval and not requires_manager
        to_status = (
            EmployeeRequest.Status.PENDING_HR if hr_only else EmployeeRequest.Status.PENDING_MANAGER
        )

    # Phase 2 (outside the transition transaction so blocked-attempt audits
    # survive the failed submission): resolve the manager snapshot server-side.
    manager_snapshot = None
    if requires_manager:
        manager_snapshot = _resolve_manager(requester, request_id=request_id)

    # Phase 3: re-lock and re-check before the one legal transition.
    with transaction.atomic():
        locked = EmployeeRequest.objects.select_for_update().get(pk=request_obj.pk)
        if locked.status not in SUBMITTABLE_STATUSES or locked.version != version:
            raise VersionConflict(locked.version)

        locked.status = to_status
        locked.manager_at_submission = manager_snapshot
        # HR-only types route to the HR queue (assignee resolved at review
        # time); manager-routed types are assigned to the snapshot manager.
        locked.current_assignee = None if hr_only else manager_snapshot
        locked.submitted_at = timezone.now()
        locked.version += 1
        locked.save(
            update_fields=[
                "status",
                "manager_at_submission",
                "current_assignee",
                "submitted_at",
                "version",
                "updated_at",
            ]
        )
        RequestEvent.objects.create(
            request=locked,
            actor=requester,
            action=RequestEvent.Action.SUBMITTED,
            from_status=previous_status,
            to_status=to_status,
        )
        AuditEvent.objects.create(
            actor=requester,
            subject=requester,
            action="request_submitted",
            request_id=request_id,
            before={"status": previous_status, "version": version},
            after={"status": to_status, "version": locked.version},
        )
    return locked


def _assert_attachments_clean(request_obj: EmployeeRequest) -> None:
    """Any existing attachment must be scan-CLEAN; otherwise 422 listing ids."""
    dirty = request_obj.attachments.exclude(
        scan_status=RequestAttachment.ScanStatus.CLEAN
    ).values_list("pk", flat=True)
    dirty_ids = [str(pk) for pk in dirty]
    if dirty_ids:
        raise SubmissionError(
            "attachment_not_clean",
            "attachments",
            _("All attachments must pass the malware scan before submission."),
            detail=",".join(dirty_ids),
        )


def _resolve_manager(requester, request_id: str):
    """Snapshot the requester's active manager, or block with an audited error.

    Missing profile/manager -> manager_required; inactive manager ->
    reviewer_inactive. Both are audited as request_submit_blocked and never
    silently rerouted (HR-queue visibility arrives in Epic 4).
    """
    profile = EmployeeProfile.objects.filter(user=requester).first()
    manager = profile.manager if profile is not None else None
    if manager is None:
        AuditEvent.objects.create(
            actor=requester,
            subject=requester,
            action="request_submit_blocked",
            request_id=request_id,
            before={},
            after={"reason": "manager_required"},
        )
        raise SubmissionError(
            "manager_required",
            "manager",
            _(
                "You have no manager on file, so this request cannot be routed "
                "for manager approval. Contact HR to set your reporting line."
            ),
        )
    if not manager.is_active:
        AuditEvent.objects.create(
            actor=requester,
            subject=requester,
            action="request_submit_blocked",
            request_id=request_id,
            before={},
            after={"reason": "reviewer_inactive", "manager_id": str(manager.pk)},
        )
        raise SubmissionError(
            "reviewer_inactive",
            "manager",
            _(
                "Your manager's account is inactive, so this request cannot be "
                "routed for approval. Contact HR to resolve the reporting line."
            ),
        )
    return manager


def record_idempotency(*, user, key_hash: str, payload_hash: str, snapshot: dict) -> None:
    """Persist the idempotency record after a successful submission."""
    from reqs.models import SubmissionIdempotencyRecord

    SubmissionIdempotencyRecord.objects.create(
        key_hash=key_hash,
        payload_hash=payload_hash,
        response_snapshot=snapshot,
        user=user,
    )
