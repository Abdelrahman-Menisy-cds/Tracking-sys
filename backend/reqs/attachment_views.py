"""Attachment endpoints (Story 2.2): requester-only upload/list/delete/download.

Download serves bytes only for scan_status=CLEAN through a fresh
requester-ownership check; blocked attempts are audited and never leak bytes.
"""
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404
from django.urls import reverse
from django.utils._os import safe_join
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import AuditEvent
from accounts.throttles import AttachmentUploadRateThrottle, MutationRateThrottle
from config.api import error_payload
from reqs import attachment_services as att
from reqs.attachment_services import AttachmentValidationError
from reqs.models import AttachmentIdempotencyRecord, EmployeeRequest, RequestAttachment


def _get_own_request(user, pk):
    try:
        return EmployeeRequest.objects.get(pk=pk, requester=user)
    except (EmployeeRequest.DoesNotExist, ValueError):
        raise Http404


def _get_own_attachment(user, pk):
    try:
        return RequestAttachment.objects.get(pk=pk, request__requester=user)
    except (RequestAttachment.DoesNotExist, ValueError):
        raise Http404


def _attachment_payload(attachment: RequestAttachment, request_obj=None) -> dict:
    return {
        "id": str(attachment.pk),
        "request_id": str(attachment.request_id),
        "original_filename": attachment.original_filename,
        "content_type": attachment.declared_content_type,
        "detected_content_type": attachment.detected_content_type,
        "size_bytes": attachment.size_bytes,
        "scan_status": attachment.scan_status,
        "created_at": attachment.created_at.isoformat(),
        "download_url": reverse(
            "reqs:attachment-download",
            kwargs={"pk": attachment.pk},
        ),
    }


class _AttachmentMutationMixin:
    """Mutations hit the 60/min mutation budget; upload POSTs also count
    toward the separate 20/hour upload scope."""

    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()


class AttachmentListView(_AttachmentMutationMixin, APIView):
    def get_throttles(self):
        if self.request.method == "POST":
            return [MutationRateThrottle(), AttachmentUploadRateThrottle()]
        return super().get_throttles()

    def get(self, request, pk, **kwargs):
        request_obj = _get_own_request(request.user, pk)
        attachments = RequestAttachment.objects.filter(request=request_obj)
        return Response(
            {"data": [_attachment_payload(att) for att in attachments]}
        )

    def post(self, request, pk, **kwargs):
        request_obj = _get_own_request(request.user, pk)
        idempotency_key = (
            request.headers.get("X-Idempotency-Key")
            or request.headers.get("Idempotency-Key")
            or ""
        ).strip()
        if not idempotency_key:
            return Response(
                error_payload(
                    code="idempotency_key_required",
                    message="An Idempotency-Key header is required for uploads.",
                    fields={"idempotency_key": ["Missing Idempotency-Key header."]},
                    request=request,
                ),
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        fileobj = request.FILES.get("file")
        if fileobj is None or not hasattr(fileobj, "read"):
            return Response(
                error_payload(
                    code="validation_error",
                    message="A multipart 'file' part is required.",
                    fields={"file": ["A file is required."]},
                    request=request,
                ),
                status=422,
            )

        key_hash, payload_hash = att.idempotency_payload_fingerprint(
            key=idempotency_key, fileobj=fileobj
        )
        fileobj.seek(0)

        existing = AttachmentIdempotencyRecord.objects.filter(key_hash=key_hash).first()
        if existing is not None:
            if existing.payload_hash == payload_hash:
                return Response(existing.response_snapshot, status=status.HTTP_201_CREATED)
            return Response(
                error_payload(
                    code="idempotency_conflict",
                    message="This idempotency key was already used with a different payload.",
                    fields={"idempotency_key": ["Key reused with different payload."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )

        try:
            attachment = att.upload_attachment(
                user=request.user,
                request_obj=request_obj,
                fileobj=fileobj,
                request_id=request.request_id,
            )
        except AttachmentValidationError as exc:
            return Response(
                error_payload(
                    code="validation_error",
                    message=exc.message,
                    fields={exc.field: [exc.message]},
                    request=request,
                ),
                status=422,
            )

        response_body = {"data": _attachment_payload(attachment)}
        AttachmentIdempotencyRecord.objects.create(
            key_hash=key_hash,
            payload_hash=payload_hash,
            response_snapshot=response_body,
            user=request.user,
        )
        return Response(response_body, status=status.HTTP_201_CREATED)


class AttachmentDetailView(_AttachmentMutationMixin, APIView):
    def get(self, request, pk, **kwargs):
        # Story 2.2 scope: attachment-view capability is owner-only.
        attachment = _get_own_attachment(request.user, pk)
        return Response({"data": _attachment_payload(attachment)})

    def delete(self, request, pk, **kwargs):
        attachment = _get_own_attachment(request.user, pk)
        request_obj = attachment.request
        try:
            att.delete_attachment(
                user=request.user,
                request_obj=request_obj,
                attachment=attachment,
                request_id=request.request_id,
            )
        except AttachmentValidationError as exc:
            return Response(
                error_payload(
                    code="state_conflict",
                    message=exc.message,
                    fields={exc.field: [exc.message]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class AttachmentReplaceView(_AttachmentMutationMixin, APIView):
    """POST replace under same quotas in RETURNED (policy item 5)."""

    def post(self, request, pk, **kwargs):
        attachment = _get_own_attachment(request.user, pk)
        request_obj = attachment.request
        fileobj = request.FILES.get("file")
        if fileobj is None:
            return Response(
                error_payload(
                    code="validation_error",
                    message="A multipart 'file' part is required.",
                    fields={"file": ["A file is required."]},
                    request=request,
                ),
                status=422,
            )
        try:
            new_attachment = att.replace_attachment(
                user=request.user,
                request_obj=request_obj,
                old_attachment=attachment,
                fileobj=fileobj,
                request_id=request.request_id,
            )
        except AttachmentValidationError as exc:
            return Response(
                error_payload(
                    code="validation_error",
                    message=exc.message,
                    fields={exc.field: [exc.message]},
                    request=request,
                ),
                status=422,
            )
        return Response({"data": _attachment_payload(new_attachment)}, status=status.HTTP_201_CREATED)


class AttachmentDownloadView(APIView):
    """Serve file bytes for CLEAN attachments only, fresh-scope-checked.

    Pending/failed/rejected never leak bytes (stable 422/409 envelope); every
    blocked attempt is audited. GET is unthrottled by design.
    """

    throttle_classes = []

    def get(self, request, pk, **kwargs):
        attachment = _get_own_attachment(request.user, pk)
        request_obj = attachment.request
        # Fresh parent-scope check: owner must still be the requester, and the
        # state must still authorize view capability.
        if request_obj.requester_id != request.user.pk:
            AuditEvent.objects.create(
                actor=request.user,
                subject=request.user,
                action="attachment_download_blocked",
                request_id=request.request_id,
                before={"attachment_id": str(attachment.pk)},
                after={"reason": "out_of_scope"},
            )
            raise Http404
        if attachment.scan_status != RequestAttachment.ScanStatus.CLEAN:
            AuditEvent.objects.create(
                actor=request.user,
                subject=request.user,
                action="attachment_download_blocked",
                request_id=request.request_id,
                before={"attachment_id": str(attachment.pk)},
                after={"reason": attachment.scan_status.lower()},
            )
            return Response(
                error_payload(
                    code="scan_quarantined",
                    message="This attachment is quarantined pending a clean malware scan.",
                    fields={"scan_status": [f"Download is not available while scan status is {attachment.scan_status}."]},
                    request=request,
                ),
                status=422,
            )
        file_path = safe_join(settings.MEDIA_ROOT, *attachment.storage_key.split("/"))
        if not Path(file_path).exists():
            raise Http404
        safe_name = attachment.original_filename or "attachment"
        response = FileResponse(
            open(file_path, "rb"),
            content_type=attachment.detected_content_type,
            as_attachment=True,
            filename=safe_name,
        )
        response["X-Content-Type-Options"] = "nosniff"
        AuditEvent.objects.create(
            actor=request.user,
            subject=request.user,
            action="attachment_downloaded",
            request_id=request.request_id,
            before={},
            after={
                "attachment_id": str(attachment.pk),
                "request_id": str(attachment.request_id),
            },
        )
        return response
