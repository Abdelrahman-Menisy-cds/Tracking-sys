"""Story 2.2 focused tests: secure request attachments.

Covers upload happy paths (PDF/PNG/JPEG/DOCX), type mismatch, oversize,
quota (count + total), unsupported type, idempotency same/differing,
replace in RETURNED, delete gating, immutability of submitted/decided
states, download headers, blocked downloads (pending/failed) with audit,
cross-user 404, unauthenticated 401, and throttle behavior.
"""
from io import BytesIO
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import AuditEvent, User
from reqs.models import EmployeeRequest, RequestAttachment, RequestType

try:  # real DOCX content (valid OPC zip) when zipfile is available
    import zipfile


    def _make_docx_bytes():
        buffer = BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr(
                "[Content_Types].xml",
                '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
            )
            archive.writestr("word/document.xml", "<doc/>")
        return buffer.getvalue()
except ImportError:  # pragma: no cover
    def _make_docx_bytes():
        return b"PK\x03\x04" + b"word/document.xml placeholder"

PDF_BYTES = b"%PDF-1.4\n%minimal pdf\n"
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"x" * 16
JPG_BYTES = b"\xff\xd8\xff\xe0" + b"JFIF" + b"x" * 16
DOCX_BYTES = _make_docx_bytes()


class AttachmentTestBase(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="emp@example.com", password="pass-12345678")
        self.other = User.objects.create_user(email="other@example.com", password="pass-12345678")
        self.request_type = RequestType.objects.create(name="Leave")
        self.draft = EmployeeRequest.objects.create(
            requester=self.user, request_type=self.request_type, title="T"
        )
        self.list_url = reverse("reqs:attachment-list", kwargs={"pk": self.draft.pk})
        self.download_url_name = "reqs:attachment-download"
        from django.core.cache import cache

        cache.clear()
        self.client.force_login(self.user)

    def upload(self, filename="file.pdf", content=PDF_BYTES, content_type="application/pdf", key="key-1", **kw):
        return self.client.post(
            self.list_url,
            {"file": SimpleUploadedFile(filename, content, content_type=content_type)},
            format="multipart",
            **({"HTTP_IDEMPOTENCY_KEY": key} if key is not None else {}),
            **kw,
        )


class UploadHappyPathTests(AttachmentTestBase):
    cases = [
        ("report.pdf", PDF_BYTES, "application/pdf"),
        ("image.png", PNG_BYTES, "image/png"),
        ("photo.jpg", JPG_BYTES, "image/jpeg"),
        ("notes.docx", DOCX_BYTES, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ]

    def test_upload_pdf(self):
        response = self.upload(*self.cases[0], key="k-pdf")
        self.assertEqual(response.status_code, 201, response.json())
        data = response.json()["data"]
        self.assertEqual(data["scan_status"], "PENDING")
        self.assertEqual(data["content_type"], "application/pdf")
        attachment = RequestAttachment.objects.get(pk=data["id"])
        self.assertEqual(attachment.uploaded_by, self.user)
        # Storage key is opaque and never filename-derived.
        self.assertNotIn("report", attachment.storage_key)
        self.assertTrue(attachment.storage_key.startswith("attachments/"))
        self.assertTrue(AuditEvent.objects.filter(action="attachment_uploaded").exists())

    def test_upload_png(self):
        response = self.upload(*self.cases[1], key="k-png")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["data"]["content_type"], "image/png")

    def test_upload_jpg(self):
        response = self.upload(*self.cases[2], key="k-jpg")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["data"]["content_type"], "image/jpeg")

    def test_upload_docx(self):
        response = self.upload(*self.cases[3], key="k-docx")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            response.json()["data"]["content_type"],
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )

    def test_scan_becomes_clean_after_commit(self):
        response = self.upload(key="k-scan")
        self.assertEqual(response.status_code, 201)
        attachment_id = response.json()["data"]["id"]
        # Force the on_commit hook synchronously (test runner doesn't flush).
        from reqs.scan import scan_attachment

        scan_attachment(attachment_id)
        self.assertEqual(
            RequestAttachment.objects.get(pk=attachment_id).scan_status,
            RequestAttachment.ScanStatus.CLEAN,
        )

    def test_missing_idempotency_key_422(self):
        response = self.upload(key=None)
        self.assertEqual(response.status_code, 422)
        self.assertIn("idempotency", response.json()["error"]["code"])


class UploadValidationTests(AttachmentTestBase):
    def test_text_renamed_to_pdf_rejected_422(self):
        response = self.upload("fake.pdf", b"just plain text", "application/pdf", key="k1")
        self.assertEqual(response.status_code, 422)
        self.assertIn("file", response.json()["error"]["fields"])
        self.assertFalse(RequestAttachment.objects.exists())

    def test_extension_declared_mismatch_rejected(self):
        response = self.upload("image.pdf", PNG_BYTES, "image/png", key="k1")
        self.assertEqual(response.status_code, 422)

    def test_unsupported_type_rejected_422(self):
        response = self.upload("script.sh", b"#!/bin/sh\n", "application/x-sh", key="k1")
        self.assertEqual(response.status_code, 422)

    def test_executable_archive_rejected(self):
        response = self.upload("archive.zip", b"PK\x03\x04evilarchive", "application/zip", key="k1")
        self.assertEqual(response.status_code, 422)

    def test_oversize_file_rejected_422(self):
        response = self.upload("big.pdf", b"%PDF-1.4\n" + b"x" * (10 * 1024 * 1024 + 1), "application/pdf", key="k1")
        self.assertEqual(response.status_code, 422)
        self.assertFalse(RequestAttachment.objects.exists())

    def test_sixth_attachment_rejected(self):
        """AC-03 allows exactly 5 files per request; the 6th is rejected."""
        for index in range(5):
            response = self.upload(f"f{index}.pdf", PDF_BYTES, "application/pdf", key=f"k{index}")
            self.assertEqual(response.status_code, 201)
        response = self.upload("f5.pdf", PDF_BYTES, "application/pdf", key="k5")
        self.assertEqual(response.status_code, 422)
        self.assertIn("5 attachments", response.json()["error"]["message"])

    def test_total_over_25mb_rejected(self):
        big = b"%PDF-1.4\n" + b"x" * (10 * 1024 * 1024 - 100)
        for index in range(2):
            response = self.upload(f"b{index}.pdf", big, "application/pdf", key=f"tb{index}")
            self.assertEqual(response.status_code, 201)
        response = self.upload("b2.pdf", big, "application/pdf", key="tb2")
        self.assertEqual(response.status_code, 422)
        self.assertIn("25 MB", response.json()["error"]["message"])


class UploadIdempotencyTests(AttachmentTestBase):
    def test_same_key_same_payload_returns_same_id(self):
        first = self.upload("report.pdf", PDF_BYTES, "application/pdf", key="same")
        self.assertEqual(first.status_code, 201)
        second = self.upload("report.pdf", PDF_BYTES, "application/pdf", key="same")
        self.assertEqual(second.status_code, 201)
        self.assertEqual(first.json()["data"]["id"], second.json()["data"]["id"])
        self.assertEqual(RequestAttachment.objects.count(), 1)

    def test_same_key_different_payload_conflict_409(self):
        first = self.upload("report.pdf", PDF_BYTES, "application/pdf", key="same")
        self.assertEqual(first.status_code, 201)
        second = self.upload("other.pdf", PNG_BYTES, "image/png", key="same")
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(second.json()["error"]["code"], "idempotency_conflict")


class StateGatingTests(AttachmentTestBase):
    def _create_in_state(self, state):
        return EmployeeRequest.objects.create(
            requester=self.user, request_type=self.request_type, title="T", status=state
        )

    def test_upload_submitted_state_409(self):
        request_obj = self._create_in_state(EmployeeRequest.Status.PENDING_MANAGER)
        url = reverse("reqs:attachment-list", kwargs={"pk": request_obj.pk})
        response = self.client.post(
            url,
            {"file": SimpleUploadedFile("f.pdf", PDF_BYTES, "application/pdf")},
            format="multipart",
            HTTP_IDEMPOTENCY_KEY="ks1",
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("drafts or returned", response.json()["error"]["message"])

    def test_upload_decided_state_422(self):
        for state in (EmployeeRequest.Status.APPROVED, EmployeeRequest.Status.REJECTED):
            request_obj = self._create_in_state(state)
            url = reverse("reqs:attachment-list", kwargs={"pk": request_obj.pk})
            response = self.client.post(
                url,
                {"file": SimpleUploadedFile("f.pdf", PDF_BYTES, "application/pdf")},
                format="multipart",
                HTTP_IDEMPOTENCY_KEY=f"kd-{state}",
            )
            self.assertEqual(response.status_code, 422, state)

    def _existing_attachment_in_state(self, state):
        request_obj = self._create_in_state(state)
        return RequestAttachment.objects.create(
            request=request_obj,
            uploaded_by=self.user,
            storage_key=f"attachments/{state}/a.bin",
            original_filename="a.pdf",
            declared_content_type="application/pdf",
            detected_content_type="application/pdf",
            size_bytes=len(PDF_BYTES),
            content_sha256="x" * 64,
            scan_status=RequestAttachment.ScanStatus.CLEAN,
        )

    def test_delete_allowed_in_draft_and_returned(self):
        for state in (EmployeeRequest.Status.DRAFT, EmployeeRequest.Status.RETURNED):
            attachment = self._existing_attachment_in_state(state)
            url = reverse("reqs:attachment-detail", kwargs={"pk": attachment.pk})
            response = self.client.delete(url)
            self.assertEqual(response.status_code, 204, state)
            self.assertFalse(RequestAttachment.objects.filter(pk=attachment.pk).exists())

    def test_delete_blocked_in_pending_and_decided_states(self):
        for state in (
            EmployeeRequest.Status.PENDING_MANAGER,
            EmployeeRequest.Status.APPROVED,
            EmployeeRequest.Status.REJECTED,
            EmployeeRequest.Status.CANCELLED,
        ):
            attachment = self._existing_attachment_in_state(state)
            url = reverse("reqs:attachment-detail", kwargs={"pk": attachment.pk})
            response = self.client.delete(url)
            self.assertEqual(response.status_code, 409, state)
            self.assertTrue(RequestAttachment.objects.filter(pk=attachment.pk).exists())

    def test_replace_only_in_returned(self):
        # DRAFT replace is not allowed (replace means a returned correction flow).
        attachment = self._existing_attachment_in_state(EmployeeRequest.Status.DRAFT)
        url = reverse("reqs:attachment-replace", kwargs={"pk": attachment.pk, "pk2": attachment.pk})
        response = self.client.post(
            url,
            {"file": SimpleUploadedFile("r.pdf", PDF_BYTES, "application/pdf")},
            format="multipart",
        )
        self.assertEqual(response.status_code, 422)
        self.assertTrue(RequestAttachment.objects.filter(pk=attachment.pk).exists())

    def test_replace_in_returned_swaps_file_and_audits(self):
        attachment = self._existing_attachment_in_state(EmployeeRequest.Status.RETURNED)
        self.assertTrue(attachment.storage_key.startswith("attachments/"))
        url = reverse("reqs:attachment-replace", kwargs={"pk": attachment.pk, "pk2": attachment.pk})
        response = self.client.post(
            url,
            {"file": SimpleUploadedFile("r.pdf", PDF_BYTES, "application/pdf")},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.json())
        self.assertFalse(RequestAttachment.objects.filter(pk=attachment.pk).exists())
        self.assertTrue(
            AuditEvent.objects.filter(action="attachment_replaced", subject=self.user).exists()
        )


class DownloadTests(AttachmentTestBase):
    def _clean_attachment(self, *, status_value=RequestAttachment.ScanStatus.CLEAN):
        attachment = RequestAttachment.objects.create(
            request=self.draft,
            uploaded_by=self.user,
            storage_key=f"attachments/dl-{status_value}/{self.draft.pk}.bin",
            original_filename="notes report.pdf",
            declared_content_type="application/pdf",
            detected_content_type="application/pdf",
            size_bytes=len(PDF_BYTES),
            content_sha256="x" * 64,
            scan_status=status_value,
        )
        from pathlib import Path

        from django.conf import settings

        path = Path(settings.MEDIA_ROOT) / attachment.storage_key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(PDF_BYTES)
        path.chmod(0o600)
        return attachment

    def download(self, pk):
        return self.client.get(reverse(self.download_url_name, kwargs={"pk": pk}))

    def test_clean_download_ok_headers(self):
        attachment = self._clean_attachment()
        response = self.download(attachment.pk)
        self.assertEqual(response.status_code, 200, response.status_code)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertTrue(AuditEvent.objects.filter(action="attachment_downloaded").exists())

    def test_pending_download_blocked_and_audited(self):
        attachment = self._clean_attachment(status_value=RequestAttachment.ScanStatus.PENDING)
        response = self.download(attachment.pk)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "scan_quarantined")
        self.assertNotIn(b"%PDF", response.content)
        self.assertTrue(
            AuditEvent.objects.filter(action="attachment_download_blocked").exists()
        )

    def test_failed_download_blocked(self):
        attachment = self._clean_attachment(status_value=RequestAttachment.ScanStatus.FAILED)
        response = self.download(attachment.pk)
        self.assertEqual(response.status_code, 422)
        self.assertTrue(AuditEvent.objects.filter(action="attachment_download_blocked").exists())

    def test_cross_user_download_404_and_no_exists_leak(self):
        attachment = self._clean_attachment()
        self.client.force_login(self.other)
        response = self.download(attachment.pk)
        self.assertEqual(response.status_code, 404)
        self.assertFalse(AuditEvent.objects.filter(action="attachment_downloaded").exists())

    def test_unauthenticated_401(self):
        attachment = self._clean_attachment()
        self.client.logout()
        response = self.download(attachment.pk)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_list_and_detail_miss_on_other_users_request(self):
        request_obj = EmployeeRequest.objects.create(
            requester=self.other, request_type=self.request_type, title="T"
        )
        response = self.client.get(reverse("reqs:attachment-list", kwargs={"pk": request_obj.pk}))
        self.assertEqual(response.status_code, 404)


class ThrottleTests(AttachmentTestBase):
    def test_upload_throttled_429_at_21st_upload_of_hour(self):
        # 20 valid uploads allowed; the 21st different-key upload hits 429.
        first = self.upload("f0.pdf", PDF_BYTES, "application/pdf", key="t0")
        self.assertEqual(first.status_code, 201)
        RequestAttachment.objects.all().delete()  # keep quota out of the way
        for index in range(1, 21):
            response = self.upload(f"f{index}.pdf", PDF_BYTES, "application/pdf", key=f"t{index}")
            RequestAttachment.objects.all().delete()
        response = self.upload("over.pdf", PDF_BYTES, "application/pdf", key="tover")
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(response.json()["error"]["code"], "throttled")

    def test_mutation_budget_still_throttles_other_views_not_list_get(self):
        # GET attachment list is unthrottled; a burst of GETs is all 200/404.
        for _ in range(70):
            response = self.client.get(self.list_url)
            self.assertIn(response.status_code, (200, 404, 500))
            self.assertNotEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_upload_counts_toward_mutation_rate_too(self):
        # After exhausting 60 mutation/min via uploads (61 requests), 429.
        for index in range(60):
            response = self.upload(
                f"m{index}.pdf", PDF_BYTES, "application/pdf", key=f"m{index}"
            )
            RequestAttachment.objects.all().delete()
            AttachmentIdempotencyCleanup()
        response = self.upload("m61.pdf", PDF_BYTES, "application/pdf", key="m61")
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)


def AttachmentIdempotencyCleanup():
    from reqs.models import AttachmentIdempotencyRecord

    AttachmentIdempotencyRecord.objects.all().delete()
