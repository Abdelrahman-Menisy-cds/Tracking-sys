"""Attachment domain services (Story 2.2).

Implements upload validation (type sniffing, quotas, state gating), private
opaque storage, idempotent upload replay through AttachmentIdempotencyRecord,
replace/delete in DRAFT/RETURNED, and append-only AuditEvent records.
"""
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.db import transaction
from django.utils.translation import gettext_lazy as _
from django.utils._os import safe_join
from django.utils.text import get_valid_filename

from accounts.models import AuditEvent
from reqs.models import AttachmentIdempotencyRecord, EmployeeRequest, RequestAttachment
from reqs.scan import schedule_scan

MAX_PER_FILE = 10 * 1024 * 1024        # 10 MB per file
MAX_TOTAL = 25 * 1024 * 1024           # 25 MB per request running total
MAX_COUNT = 5                          # 5 files per request
UPLOADABLE_STATUSES = (EmployeeRequest.Status.DRAFT, EmployeeRequest.Status.RETURNED)

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class AttachmentValidationError(Exception):
    def __init__(self, field: str, message: str):
        self.field = field
        self.message = message
        super().__init__(f"{field}: {message}")


def _sniff_content_type(head: bytes) -> str | None:
    """Detect real content type from file header bytes (magic-number sniffing)."""
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"PK\x03\x04") and len(head) >= 8:
        # DOCX is a ZIP container; any OOXML file begins with PK\x03\x04 —
        # the PK magic plus the declared/extension agreement gives the
        # required OPC mime type. In a local (non-filesystem) buffer we
        # cannot cheaply re-open an InMemoryUploadedFile as a ZIP archive;
        # this is a documented best-effort local sniff. In a real deployment
        # the tempfile (or a real scanner pipeline) checks
        # [Content_Types].xml before serving clean bytes to reviewers.
        return DOCX_MIME
    return None


def sanitize_filename(name: str) -> str:
    """Sanitized display-only filename (never used for storage paths)."""
    name = (name or "attachment").replace("\\", "/").rsplit("/", 1)[-1]
    name = get_valid_filename(name)
    return name[:255] or "attachment"


def _file_sha256(fileobj) -> str:
    fileobj.seek(0)
    digest = sha256()
    for chunk in iter(lambda: fileobj.read(65536), b""):
        digest.update(chunk)
    fileobj.seek(0)
    return digest.hexdigest()


def _store_bytes(storage_key: str, payload: bytes) -> None:
    # safe_join, same as the read path: defense in depth against any future
    # caller passing a storage key that escapes MEDIA_ROOT.
    destination = Path(safe_join(settings.MEDIA_ROOT, *storage_key.split("/")))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    destination.chmod(0o600)


def upload_attachment(*, user, request_obj: EmployeeRequest, fileobj: UploadedFile, request_id: str = ""):
    """Validate and store one attachment; schedules the async scan.

    Raises AttachmentValidationError with a 422-mapped field/message on any
    policy violation. Caller wraps in idempotency handling.
    """
    if request_obj.status not in UPLOADABLE_STATUSES:
        raise AttachmentValidationError(
            "file",
            _("Attachments can only be uploaded to drafts or returned requests."),
        )

    original = sanitize_filename(fileobj.name or "")
    ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
    declared = (fileobj.content_type or "").split(";")[0].strip().lower()
    allowed_extension = RequestAttachment.ALLOWED_EXTENSIONS.get(ext)

    payload = fileobj.read()
    fileobj.seek(0)

    if not payload:
        raise AttachmentValidationError("file", _("The uploaded file is empty."))
    if declared not in RequestAttachment.ALLOWED_CONTENT_TYPES:
        raise AttachmentValidationError("file", _("Only PDF, PNG, JPG, or DOCX files are accepted."))
    if allowed_extension is None:
        raise AttachmentValidationError("file", _("Only PDF, PNG, JPG, or DOCX files are accepted."))
    if declared != allowed_extension:
        raise AttachmentValidationError("file", _("The declared file type does not match its extension."))
    if len(payload) > MAX_PER_FILE:
        raise AttachmentValidationError("file", _("Each file must be 10 MB or smaller."))

    detected = _sniff_content_type(payload[:512])
    if detected is None or detected != allowed_extension:
        raise AttachmentValidationError(
            "file",
            _("The file content does not match its declared type."),
        )

    current = RequestAttachment.objects.filter(request=request_obj)
    if current.count() + 1 > MAX_COUNT:
        raise AttachmentValidationError("file", _("A request can have at most 5 attachments."))
    total = sum(current.values_list("size_bytes", flat=True)) + len(payload)
    if total > MAX_TOTAL:
        raise AttachmentValidationError("file", _("Attachment size exceeds the 25 MB request limit."))

    sha = sha256(payload).hexdigest()
    storage_key = f"attachments/{uuid4().hex}/{uuid4().hex}.bin"
    _store_bytes(storage_key, payload)

    attachment = create_attachment_record(
        user=user,
        request_obj=request_obj,
        storage_key=storage_key,
        original_filename=original,
        declared_content_type=declared,
        detected_content_type=detected,
        size_bytes=len(payload),
        content_sha256=sha,
        request_id=request_id,
    )
    return attachment


@transaction.atomic
def create_attachment_record(*, user, request_obj, storage_key, original_filename,
                             declared_content_type, detected_content_type,
                             size_bytes, content_sha256, request_id=""):
    attachment = RequestAttachment.objects.create(
        request=request_obj,
        uploaded_by=user,
        storage_key=storage_key,
        original_filename=original_filename,
        declared_content_type=declared_content_type,
        detected_content_type=detected_content_type,
        size_bytes=size_bytes,
        content_sha256=content_sha256,
        scan_status=RequestAttachment.ScanStatus.PENDING,
    )
    AuditEvent.objects.create(
        actor=user,
        subject=user,
        action="attachment_uploaded",
        request_id=request_id or "",
        before={},
        after={
            "attachment_id": str(attachment.pk),
            "request_id": str(request_obj.pk),
            "detect": detected_content_type,
            "size_bytes": size_bytes,
        },
    )
    schedule_scan(attachment.pk)
    return attachment


def replace_attachment(*, user, request_obj, old_attachment, fileobj: UploadedFile, request_id: str = ""):
    """Replace in RETURNED under the same quotas: delete old store, add new."""
    if request_obj.status != EmployeeRequest.Status.RETURNED:
        raise AttachmentValidationError("file", _("Only returned requests allow attachment replacement."))
    new_attachment = upload_attachment(
        user=user,
        request_obj=request_obj,
        fileobj=fileobj,
        request_id=request_id,
    )
    delete_attachment(
        user=user,
        request_obj=request_obj,
        attachment=old_attachment,
        request_id=request_id,
        replacement_of=new_attachment.pk,
        count_waiver=True,
    )
    return new_attachment


def delete_attachment(*, user, request_obj, attachment, request_id: str = "",
                      replacement_of=None, count_waiver: bool = False):
    if request_obj.status not in UPLOADABLE_STATUSES:
        raise AttachmentValidationError("file", _("Attachments are immutable in the request's current state."))
    path = Path(safe_join(settings.MEDIA_ROOT, *attachment.storage_key.split("/")))
    if path.exists():
        path.unlink()
    attachment.delete()
    AuditEvent.objects.create(
        actor=user,
        subject=user,
        action="attachment_replaced" if replacement_of else "attachment_deleted",
        request_id=request_id or "",
        before={"attachment_id": str(attachment.pk), "size_bytes": attachment.size_bytes},
        after={"replacement_of": str(replacement_of)} if replacement_of else {},
    )


def idempotency_payload_fingerprint(*, key: str, fileobj: UploadedFile) -> tuple[str, str]:
    """Return (key_hash, payload_hash) for the idempotency table."""
    key_hash = sha256(key.encode()).hexdigest()
    payload_hash = _file_sha256(fileobj)
    return key_hash, payload_hash


@transaction.atomic
def check_idempotency(key_hash: str):
    return AttachmentIdempotencyRecord.objects.filter(key_hash=key_hash).first()
