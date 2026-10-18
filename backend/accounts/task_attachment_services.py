"""Task attachment services — the same store, validator and scan as requests.

A task file is the same kind of object as a request attachment (Story 2.2):
private, opaque-key, PDF/PNG/JPG/DOCX only, 10 MB per file, scanned before a
byte may be served. Rather than re-implement any of that, this module imports
the ONE validator (``sniff_content_type``), the ONE on-disk layout
(``new_storage_key`` + ``store_bytes``), the ONE quota set and the ONE scan
scheduler, so the product keeps a single attachment storage scheme.

What differs from a request attachment is only the audience and the absence of
a workflow: a task file belongs to the task, and the task's owner or assignee
is the whole read/write scope (see ``accounts.task_attachment_views``).
"""
from hashlib import sha256

from django.utils.translation import gettext_lazy as _

from accounts.models import AuditEvent, TaskAttachment
from reqs.attachment_services import (
    MAX_COUNT,
    MAX_PER_FILE,
    MAX_TOTAL,
    AttachmentValidationError,
    new_storage_key,
    sanitize_filename,
    sniff_content_type,
    store_bytes,
)
from reqs.models import RequestAttachment  # the product's one accepted-type policy
from reqs.scan import schedule_scan

# The accepted-file policy is a product policy, not a per-feature one; it is
# declared once on the request attachment model and honoured here unchanged, so
# the two attachment surfaces can never drift apart.
ALLOWED_CONTENT_TYPES = RequestAttachment.ALLOWED_CONTENT_TYPES
ALLOWED_EXTENSIONS = RequestAttachment.ALLOWED_EXTENSIONS


def upload_task_attachment(*, user, task, fileobj, request_id: str = ""):
    """Validate and store one task file; schedules the same async scan.

    Raises AttachmentValidationError with a 422-mapped field/message on any
    policy violation (empty file, wrong/unsupported type, oversize, quota).
    """
    original = sanitize_filename(fileobj.name or "")
    ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
    declared = (fileobj.content_type or "").split(";")[0].strip().lower()
    allowed_extension = ALLOWED_EXTENSIONS.get(ext)

    payload = fileobj.read()
    fileobj.seek(0)

    if not payload:
        raise AttachmentValidationError("file", _("The uploaded file is empty."))
    if declared not in ALLOWED_CONTENT_TYPES:
        raise AttachmentValidationError("file", _("Only PDF, PNG, JPG, or DOCX files are accepted."))
    if allowed_extension is None:
        raise AttachmentValidationError("file", _("Only PDF, PNG, JPG, or DOCX files are accepted."))
    if declared != allowed_extension:
        raise AttachmentValidationError("file", _("The declared file type does not match its extension."))
    if len(payload) > MAX_PER_FILE:
        raise AttachmentValidationError("file", _("Each file must be 10 MB or smaller."))

    detected = sniff_content_type(payload[:512])
    if detected is None or detected != allowed_extension:
        raise AttachmentValidationError(
            "file",
            _("The file content does not match its declared type."),
        )

    current = TaskAttachment.objects.filter(task=task)
    if current.count() + 1 > MAX_COUNT:
        raise AttachmentValidationError("file", _("A task can have at most 5 attachments."))
    total = sum(current.values_list("size_bytes", flat=True)) + len(payload)
    if total > MAX_TOTAL:
        raise AttachmentValidationError("file", _("Attachment size exceeds the 25 MB task limit."))

    storage_key = new_storage_key()
    store_bytes(storage_key, payload)

    attachment = TaskAttachment.objects.create(
        task=task,
        company=task.company,  # H30 §2.6/§6: explicit tenant anchor
        uploaded_by=user,
        storage_key=storage_key,
        original_filename=original,
        declared_content_type=declared,
        detected_content_type=detected,
        size_bytes=len(payload),
        content_sha256=sha256(payload).hexdigest(),
        scan_status=TaskAttachment.ScanStatus.PENDING,
    )
    AuditEvent.objects.create(
        company=user.company,
        actor=user,
        subject=user,
        action="task_attachment_uploaded",
        request_id=request_id or "",
        before={},
        after={
            "attachment_id": str(attachment.pk),
            "task_id": task.pk,
            "detect": detected,
            "size_bytes": len(payload),
        },
    )
    schedule_scan(attachment.pk, model=TaskAttachment)
    return attachment
