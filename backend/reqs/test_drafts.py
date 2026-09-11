"""Story 2.1 focused tests: draft create/list/detail/edit, requester-scoped."""
from unittest.mock import patch

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from reqs.models import EmployeeRequest, RequestEvent, RequestType


class Story21Base(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="emp@example.com", password="pass-12345678")
        self.other = User.objects.create_user(email="other@example.com", password="pass-12345678")
        self.type_active = RequestType.objects.create(name="Leave", requires_hr_approval=True)
        self.type_inactive = RequestType.objects.create(name="Old", is_active=False)
        self.list_url = reverse("reqs:request-list")
        self.client.force_login(self.user)
        from django.core.cache import cache as django_cache

        django_cache.clear()

    def detail_url(self, pk):
        return reverse("reqs:request-detail", kwargs={"pk": pk})


class CreateDraftTests(Story21Base):
    def test_create_draft_happy_path(self):
        response = self.client.post(
            self.list_url,
            {"request_type_id": self.type_active.pk, "title": "Vacation", "details": "One week"},
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()["data"]
        request = EmployeeRequest.objects.get(pk=data["id"])
        self.assertEqual(request.requester, self.user)
        self.assertEqual(request.request_type, self.type_active)
        self.assertEqual(request.status, EmployeeRequest.Status.DRAFT)
        self.assertEqual(request.version, 1)
        event = RequestEvent.objects.get(request=request)
        self.assertEqual(event.actor, self.user)
        self.assertEqual(event.action, RequestEvent.Action.CREATED)
        self.assertIsNone(event.from_status)
        self.assertEqual(event.to_status, EmployeeRequest.Status.DRAFT)

    def test_create_draft_inactive_type_422(self):
        response = self.client.post(
            self.list_url,
            {"request_type_id": self.type_inactive.pk, "title": "Nope"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertFalse(EmployeeRequest.objects.exists())
        self.assertFalse(RequestEvent.objects.exists())

    def test_create_draft_protected_fields_422(self):
        response = self.client.post(
            self.list_url,
            {
                "request_type_id": self.type_active.pk,
                "title": "T",
                "status": EmployeeRequest.Status.APPROVED,
                "manager_at_submission": self.other.pk,
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("status", response.json()["error"]["fields"])
        self.assertFalse(EmployeeRequest.objects.exists())

    def test_create_draft_title_required(self):
        response = self.client.post(self.list_url, {"request_type_id": self.type_active.pk})
        self.assertEqual(response.status_code, 422)


class ListDraftsTests(Story21Base):
    def test_list_is_requester_scoped_with_bounded_pagination(self):
        from config.api import RequestPagination

        for index in range(25):
            EmployeeRequest.objects.create(
                requester=self.other,
                request_type=self.type_active,
                title=f"Other {index}",
            )
        mine = [EmployeeRequest.objects.create(
            requester=self.user,
            request_type=self.type_active,
            title=f"Mine {index}",
        ) for index in range(3)]

        response = self.client.get(self.list_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body["meta"]["count"], 3)
        self.assertEqual({item["id"] for item in body["data"]}, {str(m.pk) for m in mine})

        response = self.client.get(f"{self.list_url}?page_size=999")
        self.assertEqual(response.json()["meta"]["page_size"], RequestPagination.max_page_size)

    def test_list_unthrottled(self):
        with patch("reqs.views.RequestListView.throttle_classes", []):
            for _ in range(65):
                response = self.client.get(self.list_url)
                self.assertNotEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_mutation_throttled_429_on_61st(self):
        for index in range(60):
            response = self.client.post(
                self.list_url,
                {"request_type_id": self.type_active.pk, "title": f"T{index}"},
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED, index)
        response = self.client.post(
            self.list_url,
            {"request_type_id": self.type_active.pk, "title": "T61"},
        )
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(response.json()["error"]["code"], "throttled")


class DetailDraftTests(Story21Base):
    def test_detail_own_request(self):
        request = EmployeeRequest.objects.create(
            requester=self.user, request_type=self.type_active, title="T"
        )
        response = self.client.get(self.detail_url(request.pk))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["title"], "T")
        self.assertEqual(response.json()["data"]["status"], "DRAFT")

    def test_detail_cross_user_404(self):
        request = EmployeeRequest.objects.create(
            requester=self.other, request_type=self.type_active, title="T"
        )
        response = self.client.get(self.detail_url(request.pk))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.json()["error"]["code"], "not_found")

    def test_unauthenticated_401(self):
        self.client.logout()
        response = self.client.get(self.list_url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class PatchDraftTests(Story21Base):
    def test_patch_in_draft_ok_and_single_event(self):
        request = EmployeeRequest.objects.create(
            requester=self.user, request_type=self.type_active, title="T"
        )
        response = self.client.patch(self.detail_url(request.pk), {"title": "New", "details": "D"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["version"], 2)
        request.refresh_from_db()
        self.assertEqual(request.title, "New")
        self.assertEqual(request.version, 2)
        self.assertEqual(RequestEvent.objects.filter(request=request).count(), 1)
        event = RequestEvent.objects.filter(request=request).order_by("id").last()
        self.assertEqual(event.from_status, request.status)
        self.assertEqual(event.to_status, request.status)

    def test_patch_in_returned_ok(self):
        request = EmployeeRequest.objects.create(
            requester=self.user,
            request_type=self.type_active,
            title="T",
            status=EmployeeRequest.Status.RETURNED,
        )
        response = self.client.patch(self.detail_url(request.pk), {"details": "Fixed"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        request.refresh_from_db()
        self.assertEqual(request.details, "Fixed")
        self.assertEqual(RequestEvent.objects.filter(request=request).count(), 1)
        self.assertEqual(request.status, EmployeeRequest.Status.RETURNED)

    def test_patch_pending_manager_409_no_mutation_no_event(self):
        request = EmployeeRequest.objects.create(
            requester=self.user,
            request_type=self.type_active,
            title="T",
            status=EmployeeRequest.Status.PENDING_MANAGER,
        )
        response = self.client.patch(self.detail_url(request.pk), {"title": "Hack"})
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "state_conflict")
        request.refresh_from_db()
        self.assertEqual(request.title, "T")
        self.assertEqual(
            RequestEvent.objects.filter(request=request).count(),
            0,
        )

    def test_patch_approved_and_cancelled_409(self):
        for state in (EmployeeRequest.Status.APPROVED, EmployeeRequest.Status.CANCELLED):
            request = EmployeeRequest.objects.create(
                requester=self.user,
                request_type=self.type_active,
                title="T",
                status=state,
            )
            response = self.client.patch(self.detail_url(request.pk), {"title": "X"})
            self.assertEqual(response.status_code, status.HTTP_409_CONFLICT, state)

    def test_patch_protected_fields_422_no_mutation(self):
        request = EmployeeRequest.objects.create(
            requester=self.user, request_type=self.type_active, title="T"
        )
        response = self.client.patch(
            self.detail_url(request.pk),
            {"status": EmployeeRequest.Status.APPROVED},
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("status", response.json()["error"]["fields"])
        request.refresh_from_db()
        self.assertEqual(request.status, EmployeeRequest.Status.DRAFT)
        self.assertEqual(request.version, 1)
        self.assertEqual(request.title, "T")

    def test_patch_cross_user_404(self):
        request = EmployeeRequest.objects.create(
            requester=self.other, request_type=self.type_active, title="T"
        )
        response = self.client.patch(self.detail_url(request.pk), {"title": "X"})
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_patch_unknown_type_field_422(self):
        request = EmployeeRequest.objects.create(
            requester=self.user, request_type=self.type_active, title="T"
        )
        response = self.client.patch(self.detail_url(request.pk), {"request_type_id": 999})
        self.assertEqual(response.status_code, 422)
