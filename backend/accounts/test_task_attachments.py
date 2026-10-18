"""Task attachments: the dialog's files really land, scoped to the task's people.

Covers the required surface: the owner uploads and lists, the assignee does too,
an unrelated user gets the uniform 404 on list and download (never a disclosure),
and an oversize or blocked type is refused. Also: several files in one request,
the on-disk layout matches the request store, and a CLEAN download serves bytes
while a PENDING one is quarantined and audited.
"""
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import AuditEvent, Task, TaskAttachment, User
from tenants.context import default_company

PDF_BYTES = b"%PDF-1.4\n%minimal pdf\n"
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"x" * 16


class TaskAttachmentTestBase(APITestCase):
    def setUp(self):
        company = default_company()
        self.company = company
        self.owner = User.objects.create_user(company=company, email="owner@example.com", password="pass-12345678")
        self.assignee = User.objects.create_user(company=company, email="assignee@example.com", password="pass-12345678")
        self.stranger = User.objects.create_user(company=company, email="stranger@example.com", password="pass-12345678")
        self.task = Task.objects.create(
            company=company, owner=self.owner, assignee=self.assignee, title="Ship the release"
        )
        from django.core.cache import cache

        cache.clear()

    def list_url(self, task=None):
        return reverse("accounts:task-attachment-list", kwargs={"task_id": (task or self.task).id})

    def download_url(self, attachment, task=None):
        return reverse(
            "accounts:task-attachment-download",
            kwargs={"task_id": (task or self.task).id, "pk": attachment.pk},
        )

    def upload(self, files, *, as_user, task=None):
        """POST multipart with one or more files under the 'files' part name."""
        if isinstance(files, tuple):
            files = [files]
        self.client.force_login(as_user)
        payload = {
            "files": [
                SimpleUploadedFile(name, content, content_type=content_type)
                for (name, content, content_type) in files
            ]
        }
        return self.client.post(self.list_url(task), payload, format="multipart")

    def make_clean(self, attachment):
        """Run the (stub) scan synchronously so the file is downloadable."""
        from reqs.scan import scan_attachment

        scan_attachment(attachment.pk, model=TaskAttachment)
        attachment.refresh_from_db()
        return attachment


class UploadAndListTests(TaskAttachmentTestBase):
    def test_owner_can_upload_and_list(self):
        response = self.upload(("report.pdf", PDF_BYTES, "application/pdf"), as_user=self.owner)
        self.assertEqual(response.status_code, 201, response.json())
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["original_filename"], "report.pdf")
        self.assertEqual(rows[0]["content_type"], "application/pdf")
        self.assertEqual(rows[0]["scan_status"], "PENDING")

        attachment = TaskAttachment.objects.get(pk=rows[0]["id"])
        self.assertEqual(attachment.uploaded_by, self.owner)
        self.assertEqual(attachment.company_id, self.company.id)
        # The SAME opaque layout the request store uses, never filename-derived.
        self.assertTrue(attachment.storage_key.startswith("attachments/"))
        self.assertNotIn("report", attachment.storage_key)
        self.assertTrue(AuditEvent.objects.filter(action="task_attachment_uploaded").exists())

        listed = self.client.get(self.list_url())
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()["data"]), 1)
        self.assertEqual(listed.json()["data"][0]["id"], rows[0]["id"])

    def test_assignee_can_upload_and_list(self):
        response = self.upload(("note.pdf", PDF_BYTES, "application/pdf"), as_user=self.assignee)
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(TaskAttachment.objects.get().uploaded_by, self.assignee)
        listed = self.client.get(self.list_url())
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()["data"]), 1)

    def test_multiple_files_in_one_request(self):
        response = self.upload(
            [
                ("a.pdf", PDF_BYTES, "application/pdf"),
                ("b.png", PNG_BYTES, "image/png"),
            ],
            as_user=self.owner,
        )
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(len(response.json()["data"]), 2)
        self.assertEqual(TaskAttachment.objects.count(), 2)

    def test_empty_part_list_is_a_real_422(self):
        self.client.force_login(self.owner)
        response = self.client.post(self.list_url(), {}, format="multipart")
        self.assertEqual(response.status_code, 422)
        self.assertFalse(TaskAttachment.objects.exists())

    def test_unauthenticated_401(self):
        self.client.logout()
        response = self.client.get(self.list_url())
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class ScopeTests(TaskAttachmentTestBase):
    def setUp(self):
        super().setUp()
        # An attachment exists, created by the owner.
        self.upload(("secret.pdf", PDF_BYTES, "application/pdf"), as_user=self.owner)
        self.attachment = TaskAttachment.objects.get()

    def test_unrelated_user_gets_404_on_list_and_download(self):
        self.client.force_login(self.stranger)
        listed = self.client.get(self.list_url())
        self.assertEqual(listed.status_code, 404)
        downloaded = self.client.get(self.download_url(self.attachment))
        self.assertEqual(downloaded.status_code, 404)
        # No bytes and no disclosure leak out of the refused read.
        self.assertNotIn(b"%PDF", downloaded.content)
        self.assertFalse(AuditEvent.objects.filter(action="task_attachment_downloaded").exists())

    def test_unrelated_user_cannot_upload(self):
        response = self.upload(("mine.pdf", PDF_BYTES, "application/pdf"), as_user=self.stranger)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(TaskAttachment.objects.count(), 1)

    def test_another_company_owner_gets_404(self):
        from accounts.models import Company

        other_company = Company.objects.create(slug="other-co", name="Other Co")
        outsider = User.objects.create_user(
            company=other_company, email="outsider@example.com", password="pass-12345678"
        )
        self.client.force_login(outsider)
        self.assertEqual(self.client.get(self.list_url()).status_code, 404)
        self.assertEqual(self.client.get(self.download_url(self.attachment)).status_code, 404)


class ValidationTests(TaskAttachmentTestBase):
    def test_oversize_file_refused(self):
        big = b"%PDF-1.4\n" + b"x" * (10 * 1024 * 1024 + 1)
        response = self.upload(("big.pdf", big, "application/pdf"), as_user=self.owner)
        self.assertEqual(response.status_code, 422, response.status_code)
        self.assertIn("file", response.json()["error"]["fields"])
        self.assertFalse(TaskAttachment.objects.exists())

    def test_blocked_type_refused(self):
        response = self.upload(("script.sh", b"#!/bin/sh\n", "application/x-sh"), as_user=self.owner)
        self.assertEqual(response.status_code, 422)
        self.assertFalse(TaskAttachment.objects.exists())

    def test_text_renamed_to_pdf_refused(self):
        response = self.upload(("fake.pdf", b"just plain text", "application/pdf"), as_user=self.owner)
        self.assertEqual(response.status_code, 422)
        self.assertFalse(TaskAttachment.objects.exists())


class DownloadTests(TaskAttachmentTestBase):
    def test_clean_download_serves_bytes_with_headers(self):
        self.upload(("notes.pdf", PDF_BYTES, "application/pdf"), as_user=self.owner)
        attachment = self.make_clean(TaskAttachment.objects.get())
        response = self.client.get(self.download_url(attachment))
        self.assertEqual(response.status_code, 200, response.status_code)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertTrue(AuditEvent.objects.filter(action="task_attachment_downloaded").exists())

    def test_pending_download_blocked_and_audited(self):
        self.upload(("notes.pdf", PDF_BYTES, "application/pdf"), as_user=self.owner)
        attachment = TaskAttachment.objects.get()  # still PENDING: scan hasn't run
        response = self.client.get(self.download_url(attachment))
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "scan_quarantined")
        self.assertNotIn(b"%PDF", response.content)
        self.assertTrue(AuditEvent.objects.filter(action="task_attachment_download_blocked").exists())
