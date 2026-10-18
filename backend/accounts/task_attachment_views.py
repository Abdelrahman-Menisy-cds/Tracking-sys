"""Task attachment endpoints: upload + list + download, owner-or-assignee only.

Mirrors ``reqs.attachment_views``. The scope here is the task's two people:
whoever created it and whoever it was handed to (the same rule ``Task``
itself uses for reads and status moves). Anyone else — a colleague in the same
company, a manager who is neither side of the task, a stranger — gets the same
404 the rest of the API returns for an out-of-scope row, so the answer never
reveals that the task, or a file on it, exists.

Upload is multipart and accepts several files at once (the create dialog lets
the user pick more than one); each file is validated and stored through the
shared request-attachment validator, so a task file obeys exactly the same
type/size/quota policy and lands in exactly the same on-disk store.
"""
from pathlib import Path

from django.conf import settings
from django.db.models import Q
from django.http import FileResponse, Http404
from django.urls import reverse
from django.utils._os import safe_join
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import AuditEvent, Task, TaskAttachment
from accounts.permissions import IsAuthenticated401
from accounts.task_attachment_services import AttachmentValidationError, upload_task_attachment
from accounts.throttles import AttachmentUploadRateThrottle, MutationRateThrottle
from config.api import error_payload


def _scoped_tasks(user):
    """The tasks this caller may attach to or read from: their own, either side."""
    return Task.objects.filter(company=user.company).filter(Q(owner=user) | Q(assignee=user))


def _get_scoped_task(user, task_id):
    task = _scoped_tasks(user).filter(pk=task_id).first()
    if task is None:
        raise Http404
    return task


def _get_scoped_attachment(user, task_id, pk):
    attachment = (
        TaskAttachment.objects.filter(pk=pk, task_id=task_id)
        .filter(Q(task__owner=user) | Q(task__assignee=user), task__company=user.company)
        .first()
    )
    if attachment is None:
        raise Http404
    return attachment


def _attachment_payload(attachment: TaskAttachment) -> dict:
    return {
        "id": str(attachment.pk),
        "task_id": attachment.task_id,
        "original_filename": attachment.original_filename,
        "content_type": attachment.declared_content_type,
        "detected_content_type": attachment.detected_content_type,
        "size_bytes": attachment.size_bytes,
        "scan_status": attachment.scan_status,
        "created_at": attachment.created_at.isoformat(),
        "download_url": reverse(
            "accounts:task-attachment-download",
            kwargs={"task_id": attachment.task_id, "pk": attachment.pk},
        ),
    }


class _TaskAttachmentMutationMixin:
    """Mutations hit the 60/min mutation budget; upload POSTs also count
    toward the separate 20/hour upload scope (the same budget requests use)."""

    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()


class TaskAttachmentListView(_TaskAttachmentMutationMixin, APIView):
    """GET /api/v1/tasks/<id>/attachments - list; POST - upload one or more."""

    permission_classes = [IsAuthenticated401]

    def get_throttles(self):
        if self.request.method == "POST":
            return [MutationRateThrottle(), AttachmentUploadRateThrottle()]
        return super().get_throttles()

    def get(self, request, task_id, **kwargs):
        task = _get_scoped_task(request.user, task_id)
        attachments = TaskAttachment.objects.filter(task=task)
        return Response({"data": [_attachment_payload(att) for att in attachments]})

    def post(self, request, task_id, **kwargs):
        task = _get_scoped_task(request.user, task_id)
        # The dialog sends several files under one "files" part name; a single
        # "file" part (the request-attachment field) is accepted too.
        fileobjs = list(request.FILES.getlist("files"))
        if not fileobjs and "file" in request.FILES:
            fileobjs = [request.FILES["file"]]
        if not fileobjs:
            return Response(
                error_payload(
                    code="validation_error",
                    message="At least one multipart 'files' part is required.",
                    fields={"files": ["A file is required."]},
                    request=request,
                ),
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        created = []
        for fileobj in fileobjs:
            try:
                created.append(
                    upload_task_attachment(
                        user=request.user,
                        task=task,
                        fileobj=fileobj,
                        request_id=request.request_id,
                    )
                )
            except AttachmentValidationError as exc:
                # A refused file is a real error, named with the file it came
                # from; files stored earlier in this same request stay (each
                # upload is its own atomic store, exactly like requests).
                return Response(
                    error_payload(
                        code="validation_error",
                        message=exc.message,
                        fields={exc.field: [f"{exc.message} ({fileobj.name})"]},
                        request=request,
                    ),
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
        return Response(
            {"data": [_attachment_payload(att) for att in created]},
            status=status.HTTP_201_CREATED,
        )


class TaskAttachmentDownloadView(APIView):
    """GET /api/v1/tasks/<id>/attachments/<uuid>/download — CLEAN bytes only.

    Same posture as the request download: a fresh owner-or-assignee scope check,
    and bytes only while the scan status is CLEAN; blocked attempts are audited
    and never leak bytes. GET is unthrottled by design.
    """

    permission_classes = [IsAuthenticated401]
    throttle_classes = []

    def get(self, request, task_id, pk, **kwargs):
        attachment = _get_scoped_attachment(request.user, task_id, pk)
        if attachment.scan_status != TaskAttachment.ScanStatus.CLEAN:
            AuditEvent.objects.create(
                company=request.user.company,
                actor=request.user,
                subject=request.user,
                action="task_attachment_download_blocked",
                request_id=request.request_id,
                before={"attachment_id": str(attachment.pk)},
                after={"reason": attachment.scan_status.lower()},
            )
            return Response(
                error_payload(
                    code="scan_quarantined",
                    message="This attachment is quarantined pending a clean malware scan.",
                    fields={
                        "scan_status": [
                            f"Download is not available while scan status is {attachment.scan_status}."
                        ]
                    },
                    request=request,
                ),
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
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
            company=request.user.company,
            actor=request.user,
            subject=request.user,
            action="task_attachment_downloaded",
            request_id=request.request_id,
            before={},
            after={
                "attachment_id": str(attachment.pk),
                "task_id": attachment.task_id,
            },
        )
        return response
