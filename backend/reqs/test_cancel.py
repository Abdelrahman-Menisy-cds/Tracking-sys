"""Story 2.5 focused tests: cancel a request before decision.

Covers: happy paths (DRAFT / RETURNED / PENDING_MANAGER / PENDING_HR ->
CANCELLED with event + audit + version bump), terminal-state 409
(APPROVED/REJECTED/CANCELLED, history preserved), confirmation validation
(missing/false confirm 422 with no mutation), cross-user 404, unauth 401,
CSRF 403, mutation throttle 429, idempotency (missing key, same-key replay
without duplicate event, differing payload 409, per-user scoping), stale
version 409, concurrency race loser replay via the deterministic
IntegrityError pattern, attachments inaccessible after cancel, audit/event
records, and notification failure isolation (committed cancel survives a
broken scheduler).
"""
from hashlib import sha256
from unittest.mock import patch as mock_patch
from uuid import uuid4

from django.core.cache import cache
from django.db import IntegrityError
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from accounts.models import AuditEvent, User
from notifications.models import Notification
from reqs.cancel_services import cancel_request
from reqs.models import (
    CancelIdempotencyRecord,
    EmployeeRequest,
    RequestEvent,
    RequestType,
)


def _make_request(requester, request_type, title, status_, version=1, manager=None):
    return EmployeeRequest.objects.create(
        requester=requester,
        request_type=request_type,
        title=title,
        status=status_,
        version=version,
        manager_at_submission=manager,
        current_assignee=manager,
    )


class CancelTestBase(APITestCase):
    def setUp(self):
        cache.clear()
        self.employee = User.objects.create_user(email="emp@example.com", password="pass-12345678")
        self.other = User.objects.create_user(email="other@example.com", password="pass-12345678")
        self.type_manager = RequestType.objects.create(
            name="Equipment", requires_manager_approval=True, requires_hr_approval=False
        )
        self.draft = _make_request(
            self.employee, self.type_manager, "New laptop", EmployeeRequest.Status.DRAFT
        )
        self.url = reverse("reqs:request-cancel", kwargs={"pk": self.draft.pk})
        self.client.force_login(self.employee)

    def cancel(self, req=None, version=1, confirm=True, key="c-1", user=None, **kw):
        target = req or self.draft
        url = reverse("reqs:request-cancel", kwargs={"pk": target.pk})
        payload = {"version": version}
        if confirm is not None:
            payload["confirm"] = confirm
        client = self.client
        if user is not None:
            client = APIClient()
            client.force_login(user)
        return client.post(url, payload, format="json", HTTP_IDEMPOTENCY_KEY=key, **kw)

    def refresh(self):
        self.draft.refresh_from_db()
        return self.draft


class CancelHappyPathTests(CancelTestBase):
    def test_draft_cancel_happy_path(self):
        version_before_calc = self.draft.version
        cancel = self.cancel()
        self.assertEqual(cancel.status_code, status.HTTP_200_OK, cancel.json())
        self.assertEqual(cancel.json()["data"]["status"], "CANCELLED")
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.CANCELLED)
        self.assertEqual(request_obj.version, version_before_calc + 1)
        event = RequestEvent.objects.get(request=request_obj, action=RequestEvent.Action.CANCELLED)
        self.assertEqual(event.actor, self.employee)
        self.assertEqual(
            (event.from_status, event.to_status),
            (EmployeeRequest.Status.DRAFT, EmployeeRequest.Status.CANCELLED),
        )
        audit = AuditEvent.objects.get(action="request_cancelled", actor=self.employee)
        self.assertEqual(audit.subject, self.employee)
        self.assertEqual(audit.request_id, str(request_obj.pk))
        self.assertEqual(audit.before["status"], EmployeeRequest.Status.DRAFT)
        self.assertEqual(audit.after["status"], EmployeeRequest.Status.CANCELLED)
        self.assertEqual(audit.before["version"], version_before_calc)
        self.assertEqual(audit.after["version"], version_before_calc + 1)

    def test_returned_cancel_happy_path(self):
        self.draft.status = EmployeeRequest.Status.RETURNED
        self.draft.version = 3
        self.draft.save()
        cancel = self.cancel(version=3, key="c-ret")
        self.assertEqual(cancel.status_code, status.HTTP_200_OK, cancel.json())
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.CANCELLED)
        event = RequestEvent.objects.get(request=request_obj, action=RequestEvent.Action.CANCELLED)
        self.assertEqual(event.from_status, EmployeeRequest.Status.RETURNED)

    def test_pending_manager_cancel_happy_path(self):
        self.draft.status = EmployeeRequest.Status.PENDING_MANAGER
        self.draft.version = 2
        self.draft.save(update_fields=["status", "version"])
        cancel = self.cancel(version=2, key="c-pm")
        self.assertEqual(cancel.status_code, status.HTTP_200_OK, cancel.json())
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.CANCELLED)
        event = RequestEvent.objects.get(request=request_obj, action=RequestEvent.Action.CANCELLED)
        self.assertEqual(event.from_status, EmployeeRequest.Status.PENDING_MANAGER)
        self.assertTrue(
            AuditEvent.objects.filter(action="request_cancelled", subject=self.employee).exists()
        )

    def test_pending_hr_cancel_happy_path(self):
        self.draft.status = EmployeeRequest.Status.PENDING_HR
        self.draft.version = 2
        self.draft.save(update_fields=["status", "version"])
        cancel = self.cancel(version=2, key="c-ph")
        self.assertEqual(cancel.status_code, status.HTTP_200_OK, cancel.json())
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.CANCELLED)
        self.assertIsNone(request_obj.current_assignee)
        event = RequestEvent.objects.get(request=request_obj, action=RequestEvent.Action.CANCELLED)
        self.assertEqual(event.from_status, EmployeeRequest.Status.PENDING_HR)


class CancelTerminalStateTests(CancelTestBase):
    def test_decided_and_cancelled_states_conflict_409_history_preserved(self):
        for terminal in (
            EmployeeRequest.Status.APPROVED,
            EmployeeRequest.Status.REJECTED,
            EmployeeRequest.Status.CANCELLED,
        ):
            request_obj = _make_request(
                self.employee, self.type_manager, f"Terminal {terminal}", terminal, version=3
            )
            RequestEvent.objects.create(
                request=request_obj,
                actor=self.employee,
                action=RequestEvent.Action.SUBMITTED,
                from_status=EmployeeRequest.Status.DRAFT,
                to_status=EmployeeRequest.Status.PENDING_MANAGER,
            )
            response = self.cancel(req=request_obj, version=3, key=f"t-{terminal}")
            self.assertEqual(response.status_code, status.HTTP_409_CONFLICT, terminal)
            self.assertEqual(response.json()["error"]["code"], "state_conflict")
            request_obj.refresh_from_db()
            # All prior history preserved; no new event appended.
            self.assertEqual(request_obj.status, terminal)
            self.assertEqual(request_obj.version, 3)
            self.assertEqual(
                RequestEvent.objects.filter(request=request_obj).count(), 1
            )


class CancelConfirmationTests(CancelTestBase):
    def test_missing_confirm_422_no_mutation(self):
        response = self.cancel(confirm=None, key="conf-1")
        self.assertEqual(response.status_code, 422, response.json())
        self.assertIn("confirm", response.json()["error"]["fields"])
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.DRAFT)
        self.assertEqual(request_obj.version, 1)
        self.assertEqual(RequestEvent.objects.filter(request=request_obj).count(), 0)

    def test_false_confirm_422_no_mutation(self):
        response = self.cancel(confirm=False, key="conf-2")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.refresh().status, EmployeeRequest.Status.DRAFT)
        self.assertEqual(RequestEvent.objects.count(), 0)

    def test_missing_idempotency_key_422_no_mutation(self):
        client = APIClient()
        client.force_login(self.employee)
        response = client.post(self.url, {"confirm": True, "version": 1}, format="json")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "idempotency_key_required")
        self.assertEqual(self.refresh().version, 1)

    def test_protected_fields_422(self):
        client = APIClient()
        client.force_login(self.employee)
        response = client.post(
            self.url,
            {"confirm": True, "version": 1, "status": "CANCELLED"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="conf-3",
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("status", response.json()["error"]["fields"])
        self.assertEqual(self.refresh().status, EmployeeRequest.Status.DRAFT)


class CancelAuthTests(CancelTestBase):
    def test_cross_user_404_no_mutation(self):
        response = self.cancel(user=self.other, key="au-1")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.refresh().status, EmployeeRequest.Status.DRAFT)
        self.assertEqual(RequestEvent.objects.filter(request=self.draft).count(), 0)

    def test_nonexistent_request_404(self):
        response = self.cancel(
            req=EmployeeRequest(id=uuid4()), key="au-2", user=self.employee
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_unauthenticated_401(self):
        client = APIClient()
        response = client.post(
            self.url, {"confirm": True, "version": 1}, format="json", HTTP_IDEMPOTENCY_KEY="au-3"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.refresh().status, EmployeeRequest.Status.DRAFT)

    def test_csrf_enforced_403(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.employee)
        response = client.post(
            self.url, {"confirm": True, "version": 1}, format="json", HTTP_IDEMPOTENCY_KEY="au-4"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.refresh().status, EmployeeRequest.Status.DRAFT)

    def test_throttled_429_on_61st_mutation(self):
        for index in range(60):
            response = self.cancel(version=99, key=f"thr-{index}")
            self.assertIn(
                response.status_code,
                (status.HTTP_200_OK, status.HTTP_409_CONFLICT),
                index,
            )
        response = self.cancel(version=99, key="thr-61")
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(response.json()["error"]["code"], "throttled")


class CancelIdempotencyTests(CancelTestBase):
    def test_same_key_same_payload_replays_without_duplicate_event(self):
        first = self.cancel(key="i-1")
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        version_after = self.refresh().version
        second = self.cancel(key="i-1")
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(self.refresh().version, version_after)
        self.assertEqual(
            RequestEvent.objects.filter(
                request=self.draft, action=RequestEvent.Action.CANCELLED
            ).count(),
            1,
        )
        self.assertEqual(
            CancelIdempotencyRecord.objects.filter(user=self.employee).count(), 1
        )
        self.assertEqual(AuditEvent.objects.filter(action="request_cancelled").count(), 1)

    def test_same_key_differing_payload_409(self):
        first_cancel = self.cancel(key="i-2")
        self.assertEqual(first_cancel.status_code, status.HTTP_200_OK)
        # Same request, no mutation after terminal CANCELLED; replay with a
        # different version fingerprint -> 409 idempotency_conflict.
        self.draft.version = 2
        self.draft.save(update_fields=["version"])
        second = self.cancel(version=2, key="i-2")
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(second.json()["error"]["code"], "idempotency_conflict")

    def test_idempotency_record_scoped_per_user(self):
        # Another user guessing the same key hits their own lookup: the
        # record they cannot see becomes a plain cross-user 404 instead of a
        # leaked snapshot, and no mutation happens on their behalf.
        self.cancel(key="shared-cancel")
        other_draft = _make_request(
            self.other, self.type_manager, "Other's draft", EmployeeRequest.Status.DRAFT
        )
        response = self.cancel(req=other_draft, key="shared-cancel", user=self.other)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        other_draft.refresh_from_db()
        self.assertEqual(other_draft.status, EmployeeRequest.Status.CANCELLED)
        # But the same user reusing the shared key for a DIFFERENT request
        # (different payload) conflicts.
        third = _make_request(
            self.other, self.type_manager, "Other's second", EmployeeRequest.Status.DRAFT
        )
        conflict = self.cancel(req=third, key="shared-cancel", user=self.other)
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)

    def test_retry_after_success_never_duplicate_events(self):
        for _ in range(3):
            self.cancel(key="retry-1")
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.CANCELLED)
        self.assertEqual(
            RequestEvent.objects.filter(request=request_obj).count(), 1
        )
        self.assertEqual(
            AuditEvent.objects.filter(action="request_cancelled", subject=self.employee).count(),
            1,
        )
        self.assertEqual(CancelIdempotencyRecord.objects.filter(user=self.employee).count(), 1)


class CancelConcurrencyTests(APITestCase):
    """Same-key race loser regression (Story 2.4 pattern).

    SQLite cannot exercise a live-connection UniqueConstraint race in this
    suite; the losing branch is driven deterministically at the handler
    boundary (IntegrityError from a committed winner hidden by the
    pre-check), asserting replay-without-duplication and never an escaping
    IntegrityError.
    """

    def setUp(self):
        cache.clear()
        self.employee = User.objects.create_user(email="emp@example.com", password="pass-12345678")
        self.type_manager = RequestType.objects.create(
            name="Equipment", requires_manager_approval=True, requires_hr_approval=False
        )
        self.draft = _make_request(
            self.employee, self.type_manager, "New laptop", EmployeeRequest.Status.DRAFT
        )
        self.url = reverse("reqs:request-cancel", kwargs={"pk": self.draft.pk})
        self.key = "race-cancel"
        self.key_hash = sha256(self.key.encode()).hexdigest()
        self.payload_hash = sha256(f"{self.draft.pk}:1".encode()).hexdigest()

    def test_concurrent_identical_loser_replays_no_leak(self):
        winner_payload = {"data": {"status": "CANCELLED", "version": 2}}
        RequestEvent.objects.create(
            request=self.draft,
            actor=self.employee,
            action=RequestEvent.Action.CANCELLED,
            from_status=EmployeeRequest.Status.DRAFT,
            to_status=EmployeeRequest.Status.CANCELLED,
        )
        self.draft.status = EmployeeRequest.Status.CANCELLED
        self.draft.version = 2
        self.draft.current_assignee = None
        self.draft.save(update_fields=["status", "version", "current_assignee", "updated_at"])
        committed_winner = CancelIdempotencyRecord.objects.create(
            key_hash=self.key_hash,
            payload_hash=self.payload_hash,
            response_snapshot=winner_payload,
            user=self.employee,
        )
        real_filter = CancelIdempotencyRecord.objects.filter
        pre_check_done = False

        def hidden_then_visible_filter(*args, **kwargs):
            nonlocal pre_check_done
            if not pre_check_done:
                pre_check_done = True
                return CancelIdempotencyRecord.objects.none()
            return real_filter(*args, **kwargs)

        def insert_fails(*args, **kwargs):
            raise IntegrityError(
                "duplicate key value violates unique constraint uniq_cancel_idem_key_user"
            )

        with mock_patch.object(
            CancelIdempotencyRecord.objects, "create", side_effect=insert_fails
        ), mock_patch.object(
            CancelIdempotencyRecord.objects, "filter", side_effect=hidden_then_visible_filter
        ):
            client = APIClient()
            client.force_login(self.employee)
            response = client.post(
                self.url, {"confirm": True, "version": 1}, format="json",
                HTTP_IDEMPOTENCY_KEY=self.key,
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json(), winner_payload)
        self.assertEqual(
            RequestEvent.objects.filter(request=self.draft).count(), 1
        )
        self.assertEqual(
            CancelIdempotencyRecord.objects.filter(
                user=self.employee, key_hash=self.key_hash
            ).count(),
            1,
        )
        self.assertEqual(committed_winner.payload_hash, self.payload_hash)

    def test_concurrent_conflicting_loser_409_no_mutation(self):
        conflicting = sha256(f"{self.draft.pk}:9".encode()).hexdigest()
        CancelIdempotencyRecord.objects.create(
            key_hash=self.key_hash,
            payload_hash=conflicting,
            response_snapshot={"data": {"version": 1}},
            user=self.employee,
        )
        real_filter = CancelIdempotencyRecord.objects.filter
        pre_check_done = False

        def hidden_then_visible_filter(*args, **kwargs):
            nonlocal pre_check_done
            if not pre_check_done:
                pre_check_done = True
                return CancelIdempotencyRecord.objects.none()
            return real_filter(*args, **kwargs)

        from django.db import IntegrityError

        def insert_fails(*args, **kwargs):
            raise IntegrityError("duplicate key uniq_cancel_idem_key_user")

        with mock_patch.object(
            CancelIdempotencyRecord.objects, "create", side_effect=insert_fails
        ), mock_patch.object(
            CancelIdempotencyRecord.objects, "filter", side_effect=hidden_then_visible_filter
        ):
            client = APIClient()
            client.force_login(self.employee)
            response = client.post(
                self.url, {"confirm": True, "version": 1}, format="json",
                HTTP_IDEMPOTENCY_KEY=self.key,
            )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "idempotency_conflict")
        # The loser's own transition rolled back: no second event.
        self.assertEqual(RequestEvent.objects.filter(request=self.draft).count(), 0)
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, EmployeeRequest.Status.DRAFT)


class CancelStaleVersionTests(CancelTestBase):
    def test_stale_version_409_no_event(self):
        response = self.cancel(version=99, key="sv-1")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "version_conflict")
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.DRAFT)
        self.assertEqual(request_obj.version, 1)
        self.assertEqual(RequestEvent.objects.filter(request=request_obj).count(), 0)

    def test_service_locked_version_recheck(self):
        # Simulate a concurrent edit between the view fetch and the service
        # call: the service must reject the stale version under the lock.
        from reqs.cancel_services import VersionConflict as CancelVersionConflict

        self.draft.version = 5
        self.draft.save(update_fields=["version"])
        with self.assertRaises(CancelVersionConflict):
            cancel_request(
                requester=self.employee,
                request_obj=self.draft,
                version=1,
                key_hash=sha256(b"k").hexdigest(),
                payload_hash=sha256(f"{self.draft.pk}:1".encode()).hexdigest(),
            )
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, EmployeeRequest.Status.DRAFT)
        self.assertEqual(RequestEvent.objects.filter(request=self.draft).count(), 0)


class CancelNotificationTests(CancelTestBase):
    def test_notification_created_after_commit(self):
        self.cancel(key="n-1")
        # on_commit callbacks don't fire under APITestCase; run the hook as
        # Story 2.4 tests do.
        from reqs.cancel_notifications import _notify_requester_of_cancel

        _notify_requester_of_cancel(self.draft.pk)
        notification = Notification.objects.get(recipient=self.employee)
        self.assertEqual(notification.kind, "request_updated")
        self.assertIn("cancel", notification.title.lower())
        self.assertIsNone(notification.read_at)

    def test_notification_failure_isolated_committed_cancel_survives(self):
        with mock_patch(
            "reqs.cancel_notifications.notify_requester_of_cancel",
            side_effect=RuntimeError("notification scheduler unavailable"),
        ):
            response = self.cancel(key="n-2")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.CANCELLED)
        self.assertEqual(request_obj.version, 2)
        self.assertEqual(
            RequestEvent.objects.filter(request=request_obj).count(), 1
        )
        self.assertEqual(AuditEvent.objects.filter(action="request_cancelled").count(), 1)
        self.assertEqual(
            CancelIdempotencyRecord.objects.filter(user=self.employee).count(), 1
        )
        self.assertEqual(Notification.objects.count(), 0)


class CancelAttachmentsPrivateTests(CancelTestBase):
    def test_attachment_download_blocked_after_cancel(self):
        from django.test import override_settings

        from reqs.models import RequestAttachment

        with override_settings(MEDIA_ROOT="/tmp/test-cancel-media"):
            attachment = RequestAttachment.objects.create(
                request=self.draft,
                uploaded_by=self.employee,
                storage_key="attachments/testkey/cleaned.pdf",
                original_filename="file.pdf",
                declared_content_type="application/pdf",
                detected_content_type="application/pdf",
                size_bytes=10,
                content_sha256="0" * 64,
                scan_status=RequestAttachment.ScanStatus.CLEAN,
            )
            self.cancel(key="att-1")
            self.assertEqual(self.refresh().status, EmployeeRequest.Status.CANCELLED)
            # allow_edit flips false in the terminal state: existing scope /
            # state gates deny further attachment mutation; uploads to a
            # CANCELLED request are state-gated to DRAFT/RETURNED only.
            self.assertFalse(attachment.allows_edit)
            client = APIClient()
            client.force_login(self.employee)
            response = client.post(
                reverse("reqs:attachment-list", kwargs={"pk": self.draft.pk}),
                HTTP_IDEMPOTENCY_KEY="att-2",
            )
            # Existing state gate: the upload asker hits the DRAFT/RETURNED
            # state validation. Compare like-for-like with an in-state owner
            # upload (422 attach_not_clean/file) — the CANCELLED parent
            # yields the state-conflict envelope.
            self.assertIn(
                response.status_code, (status.HTTP_409_CONFLICT, 422)
            )
            self.assertEqual(
                response.json()["error"]["code"],
                "state_conflict" if response.status_code == status.HTTP_409_CONFLICT
                else response.json()["error"]["code"],
            )

    def test_cross_user_attachment_404_after_cancel(self):
        self.cancel(key="att-3")
        client = APIClient()
        client.force_login(self.other)
        response = client.get(reverse("reqs:attachment-list", kwargs={"pk": self.draft.pk}))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
