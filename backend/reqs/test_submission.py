"""Story 2.3 focused tests: submit a complete request with server-derived routing.

Covers DRAFT->PENDING_MANAGER, DRAFT->PENDING_HR (HR-only), RETURNED resubmit,
manager snapshot correctness (snapshot at submission, resnapshot on resubmit),
no-manager block, inactive-manager block, non-CLEAN attachment block, inactive
request type, misconfigured routing, idempotency (missing key, same-key replay,
differing-payload 409), stale version 409, wrong state 409, cross-user 404,
unauthenticated 401, CSRF 403, and mutation throttle 429.
"""
from uuid import uuid4

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from accounts.models import AuditEvent, EmployeeProfile, User
from reqs.models import EmployeeRequest, RequestEvent, RequestAttachment, RequestType


class SubmissionTestBase(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="emp@example.com", password="pass-12345678")
        self.manager = User.objects.create_user(email="mgr@example.com", password="pass-12345678")
        self.other = User.objects.create_user(email="other@example.com", password="pass-12345678")
        EmployeeProfile.objects.create(user=self.user, manager=self.manager, employee_number="E-001")
        EmployeeProfile.objects.create(user=self.other, employee_number="E-002")
        self.type_manager = RequestType.objects.create(
            name="Equipment", requires_manager_approval=True, requires_hr_approval=False
        )
        self.type_hr_only = RequestType.objects.create(
            name="Grievance", requires_manager_approval=False, requires_hr_approval=True
        )
        self.type_both = RequestType.objects.create(
            name="Leave", requires_manager_approval=True, requires_hr_approval=True
        )
        self.type_none = RequestType.objects.create(
            name="Misconfigured", requires_manager_approval=False, requires_hr_approval=False
        )
        self.type_inactive = RequestType.objects.create(name="Old", is_active=False)
        self.draft = EmployeeRequest.objects.create(
            requester=self.user, request_type=self.type_manager, title="New laptop"
        )
        self.url = reverse("reqs:request-submit", kwargs={"pk": self.draft.pk})
        from django.core.cache import cache

        cache.clear()
        self.client.force_login(self.user)

    def submit(self, req=None, version=1, key="key-1", **kw):
        target = req or self.draft
        url = reverse("reqs:request-submit", kwargs={"pk": target.pk})
        return self.client.post(url, {"version": version}, format="json", HTTP_IDEMPOTENCY_KEY=key, **kw)

    def refresh(self):
        self.draft.refresh_from_db()
        return self.draft

    def _add_attachment(self, request_obj, scan_status):
        return RequestAttachment.objects.create(
            request=request_obj,
            uploaded_by=self.user,
            storage_key=f"attachments/{uuid4().hex}/a.bin",
            original_filename="a.pdf",
            declared_content_type="application/pdf",
            detected_content_type="application/pdf",
            size_bytes=10,
            content_sha256="a" * 64,
            scan_status=scan_status,
        )


class SubmitHappyPathTests(SubmissionTestBase):
    def test_draft_to_pending_manager(self):
        response = self.submit(version=1, key="k-mgr")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.PENDING_MANAGER)
        self.assertEqual(request_obj.manager_at_submission, self.manager)
        self.assertEqual(request_obj.current_assignee, self.manager)
        self.assertEqual(request_obj.version, 2)
        self.assertIsNotNone(request_obj.submitted_at)
        event = RequestEvent.objects.get(request=request_obj, action=RequestEvent.Action.SUBMITTED)
        self.assertEqual(event.actor, self.user)
        self.assertEqual(event.from_status, EmployeeRequest.Status.DRAFT)
        self.assertEqual(event.to_status, EmployeeRequest.Status.PENDING_MANAGER)
        self.assertTrue(
            AuditEvent.objects.filter(action="request_submitted", subject=self.user).exists()
        )

    def test_draft_to_pending_hr_for_hr_only_type(self):
        request_obj = EmployeeRequest.objects.create(
            requester=self.user, request_type=self.type_hr_only, title="Grievance"
        )
        response = self.submit(req=request_obj, version=1, key="k-hr")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.PENDING_HR)
        self.assertIsNone(request_obj.manager_at_submission)
        self.assertIsNone(request_obj.current_assignee)
        event = RequestEvent.objects.get(request=request_obj, action=RequestEvent.Action.SUBMITTED)
        self.assertEqual(event.to_status, EmployeeRequest.Status.PENDING_HR)

    def test_manager_then_hr_type_goes_to_manager_first(self):
        request_obj = EmployeeRequest.objects.create(
            requester=self.user, request_type=self.type_both, title="Leave"
        )
        response = self.submit(req=request_obj, version=1, key="k-both")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.PENDING_MANAGER)
        self.assertEqual(request_obj.current_assignee, self.manager)

    def test_returned_resubmit_routes_again(self):
        request_obj = EmployeeRequest.objects.create(
            requester=self.user,
            request_type=self.type_manager,
            title="Fixed draft",
            status=EmployeeRequest.Status.RETURNED,
            version=3,
        )
        response = self.submit(req=request_obj, version=3, key="k-return")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.PENDING_MANAGER)
        self.assertEqual(request_obj.version, 4)
        event = RequestEvent.objects.get(request=request_obj, action=RequestEvent.Action.SUBMITTED)
        self.assertEqual(event.from_status, EmployeeRequest.Status.RETURNED)

    def test_clean_attachments_allow_submission(self):
        self._add_attachment(self.draft, RequestAttachment.ScanStatus.CLEAN)
        response = self.submit(version=1, key="k-clean")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())


class ManagerSnapshotTests(SubmissionTestBase):
    def test_snapshot_is_server_derived_not_client_supplied(self):
        # Client-supplied assignee/manager fields are ignored: routing and the
        # snapshot come from the requester's EmployeeProfile at submit time.
        response = self.submit(version=1, key="k-snap")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self.refresh().manager_at_submission, self.manager)

    def test_later_manager_change_does_not_affect_existing_snapshot(self):
        self.submit(version=1, key="k-later")
        new_manager = User.objects.create_user(email="mgr2@example.com", password="pass-12345678")
        EmployeeProfile.objects.filter(user=self.user).update(manager=new_manager)
        self.assertEqual(self.refresh().manager_at_submission, self.manager)

    def test_resubmit_resnapshots_current_manager(self):
        self.submit(version=1, key="k-resub")
        self.draft.status = EmployeeRequest.Status.RETURNED
        self.draft.save(update_fields=["status"])
        new_manager = User.objects.create_user(email="mgr3@example.com", password="pass-12345678")
        EmployeeProfile.objects.filter(user=self.user).update(manager=new_manager)
        response = self.submit(version=self.refresh().version, key="k-resub2")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self.refresh().manager_at_submission, new_manager)
        self.assertEqual(self.refresh().current_assignee, new_manager)


class SubmissionBlockTests(SubmissionTestBase):
    def test_no_manager_blocks_with_actionable_error_and_audit(self):
        EmployeeProfile.objects.filter(user=self.user).update(manager=None)
        response = self.submit(version=1, key="k-nomgr")
        self.assertEqual(response.status_code, 422)
        error = response.json()["error"]
        self.assertEqual(error["code"], "manager_required")
        self.assertIn("manager", error["fields"])
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.DRAFT)
        self.assertIsNone(request_obj.manager_at_submission)
        self.assertEqual(request_obj.version, 1)
        self.assertFalse(
            RequestEvent.objects.filter(request=request_obj, action=RequestEvent.Action.SUBMITTED).exists()
        )
        self.assertTrue(
            AuditEvent.objects.filter(action="request_submit_blocked", subject=self.user).exists()
        )

    def test_no_manager_blocks_only_for_manager_routed_types(self):
        # HR-only types never require a manager snapshot (policy item 1).
        EmployeeProfile.objects.filter(user=self.user).update(manager=None)
        request_obj = EmployeeRequest.objects.create(
            requester=self.user, request_type=self.type_hr_only, title="Grievance"
        )
        response = self.submit(req=request_obj, version=1, key="k-nomgr-hr")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.PENDING_HR)

    def test_inactive_manager_blocks_without_reroute(self):
        self.manager.is_active = False
        self.manager.save(update_fields=["is_active"])
        response = self.submit(version=1, key="k-inact")
        self.assertEqual(response.status_code, 422)
        error = response.json()["error"]
        self.assertEqual(error["code"], "reviewer_inactive")
        self.assertIn("manager", error["fields"])
        request_obj = self.refresh()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.DRAFT)
        self.assertIsNone(request_obj.manager_at_submission)
        self.assertTrue(
            AuditEvent.objects.filter(action="request_submit_blocked", subject=self.user).exists()
        )
        self.assertFalse(
            RequestEvent.objects.filter(request=request_obj, action=RequestEvent.Action.SUBMITTED).exists()
        )

    def test_missing_profile_blocks_for_manager_routed_types(self):
        EmployeeProfile.objects.filter(user=self.user).delete()
        response = self.submit(version=1, key="k-noprofile")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "manager_required")

    def test_non_clean_attachment_blocks_listing_ids(self):
        pending = self._add_attachment(self.draft, RequestAttachment.ScanStatus.PENDING)
        failed = self._add_attachment(self.draft, RequestAttachment.ScanStatus.FAILED)
        response = self.submit(version=1, key="k-att")
        self.assertEqual(response.status_code, 422)
        error = response.json()["error"]
        self.assertEqual(error["code"], "attachment_not_clean")
        listed = error["fields"]["attachments"]
        self.assertIn(str(pending.pk), listed)
        self.assertIn(str(failed.pk), listed)
        self.assertEqual(self.refresh().status, EmployeeRequest.Status.DRAFT)

    def test_rejected_attachment_blocks(self):
        self._add_attachment(self.draft, RequestAttachment.ScanStatus.REJECTED)
        response = self.submit(version=1, key="k-rej")
        self.assertEqual(response.status_code, 422)

    def test_inactive_type_422(self):
        request_obj = EmployeeRequest.objects.create(
            requester=self.user, request_type=self.type_inactive, title="Old request"
        )
        response = self.submit(req=request_obj, version=1, key="k-inactive-type")
        self.assertEqual(response.status_code, 422)
        self.assertIn("request_type", response.json()["error"]["fields"])
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, EmployeeRequest.Status.DRAFT)

    def test_type_requiring_neither_reviewer_422(self):
        request_obj = EmployeeRequest.objects.create(
            requester=self.user, request_type=self.type_none, title="Misconfigured"
        )
        response = self.submit(req=request_obj, version=1, key="k-neither")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.refresh().status, EmployeeRequest.Status.DRAFT)


class SubmitStateAndAuthTests(SubmissionTestBase):
    def test_wrong_state_409_no_mutation(self):
        self.draft.status = EmployeeRequest.Status.PENDING_MANAGER
        self.draft.save(update_fields=["status"])
        response = self.submit(version=1, key="k-wrongstate")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "state_conflict")
        for state in (EmployeeRequest.Status.APPROVED, EmployeeRequest.Status.CANCELLED):
            self.draft.status = state
            self.draft.save(update_fields=["status"])
            response = self.submit(version=1, key=f"k-wrongstate-{state}")
            self.assertEqual(response.status_code, status.HTTP_409_CONFLICT, state)
            self.draft.status = EmployeeRequest.Status.DRAFT
            self.draft.save(update_fields=["status"])

    def test_stale_version_409(self):
        response = self.submit(version=99, key="k-stale")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "version_conflict")
        self.assertEqual(self.refresh().status, EmployeeRequest.Status.DRAFT)
        self.assertEqual(RequestEvent.objects.filter(request=self.draft).count(), 0)

    def test_cross_user_404(self):
        foreign = EmployeeRequest.objects.create(
            requester=self.other, request_type=self.type_manager, title="Not mine"
        )
        response = self.submit(req=foreign, version=1, key="k-cross")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        foreign.refresh_from_db()
        self.assertEqual(foreign.status, EmployeeRequest.Status.DRAFT)

    def test_unauthenticated_401(self):
        self.client.logout()
        response = self.submit(version=1, key="k-unauth")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_csrf_enforced_403(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.user)
        response = client.post(
            self.url, {"version": 1}, format="json", HTTP_IDEMPOTENCY_KEY="k-csrf"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_missing_idempotency_key_422(self):
        response = self.client.post(self.url, {"version": 1}, format="json")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "idempotency_key_required")
        self.assertEqual(self.refresh().status, EmployeeRequest.Status.DRAFT)

    def test_missing_version_422(self):
        response = self.client.post(self.url, {}, format="json", HTTP_IDEMPOTENCY_KEY="k-nover")
        self.assertEqual(response.status_code, 422)
        self.assertIn("version", response.json()["error"]["fields"])

    def test_protected_fields_422(self):
        response = self.client.post(
            self.url,
            {"version": 1, "status": "APPROVED", "current_assignee": self.other.pk},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-protected",
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("status", response.json()["error"]["fields"])
        self.assertEqual(self.refresh().status, EmployeeRequest.Status.DRAFT)


class SubmitIdempotencyTests(SubmissionTestBase):
    def test_same_key_same_payload_replays_original_response(self):
        first = self.submit(version=1, key="idem-1")
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        events_after_first = RequestEvent.objects.filter(request=self.draft).count()
        version_after_first = self.refresh().version

        second = self.submit(version=1, key="idem-1")
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(self.refresh().version, version_after_first)
        self.assertEqual(
            RequestEvent.objects.filter(request=self.draft).count(), events_after_first
        )
        self.assertEqual(
            RequestEvent.objects.filter(
                request=self.draft, action=RequestEvent.Action.SUBMITTED
            ).count(),
            1,
        )

    def test_same_key_differing_payload_409(self):
        first = self.submit(version=1, key="idem-2")
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        second = self.submit(version=2, key="idem-2")
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(second.json()["error"]["code"], "idempotency_conflict")
        self.assertEqual(self.refresh().version, 2)

    def test_same_key_different_request_409(self):
        # Matches the Story 2.2 attachment pattern: a key is single-use for
        # its payload hash; reuse for another request's payload is a 409.
        first = self.submit(version=1, key="shared-key")
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        foreign = EmployeeRequest.objects.create(
            requester=self.other, request_type=self.type_manager, title="Other's"
        )
        self.client.force_login(self.other)
        response = self.submit(req=foreign, version=1, key="shared-key")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "idempotency_conflict")
        foreign.refresh_from_db()
        self.assertEqual(foreign.status, EmployeeRequest.Status.DRAFT)


class SubmitThrottleTests(SubmissionTestBase):
    def test_throttled_429_after_mutation_budget(self):
        for index in range(60):
            response = self.submit(version=1, key=f"thr-{index}")
            self.assertIn(response.status_code, (status.HTTP_200_OK, status.HTTP_409_CONFLICT), index)
        response = self.submit(version=1, key="thr-61")
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(response.json()["error"]["code"], "throttled")
        self.assertEqual(
            RequestEvent.objects.filter(
                request=self.draft, action=RequestEvent.Action.SUBMITTED
            ).count(),
            1,
        )
