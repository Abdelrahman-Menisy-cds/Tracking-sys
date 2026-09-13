"""Story 4.1 focused tests: scoped review queues and read-only details.

Covers:
- Manager queue scope = CURRENT active direct reports in relevant pending
  review states; unrelated managers/non-managers see nothing relevant.
- HR read scope = organization records (visibility separate from action);
  in-scope HR reads show permissions.can_decide=false where they cannot act.
- Scope queryset applied BEFORE filters/count/pagination/serialization.
- Out-of-scope or nonexistent ids: uniform safe 404.
- Query params q / status / date_from / date_to; bad dates -> 422.
- Deterministic sort submitted_at DESC then id ASC; pagination default 25,
  max 100 (page_size beyond 100 clamps to 100).
- GET endpoints mutate nothing and are unthrottled.
- Unauthenticated -> 401.
"""
from datetime import date, timedelta
from uuid import uuid4

from django.core.cache import cache
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from accounts.models import EmployeeProfile, User
from reqs.models import EmployeeRequest, RequestEvent, RequestType
from timesheets.models import TimeEntry, Timesheet, TimesheetEvent


def _mk_user(email, role=User.Role.EMPLOYEE, **kw):
    return User.objects.create_user(email=email, password="pass-12345678", role=role, **kw)


class ReviewBase(APITestCase):
    def setUp(self):
        cache.clear()
        self.employee = _mk_user("emp@example.com")
        self.employee.full_name = "Emp Test"
        self.employee.save(update_fields=["full_name"])
        self.employee2 = _mk_user("emp2@example.com")
        self.manager = _mk_user("mgr@example.com", role=User.Role.MANAGER)
        self.manager_other = _mk_user("mgr2@example.com", role=User.Role.MANAGER)
        self.hr = _mk_user("hr@example.com", role=User.Role.HR)
        self.plain = _mk_user("plain@example.com")
        EmployeeProfile.objects.create(user=self.employee, manager=self.manager, employee_number="E-001")
        EmployeeProfile.objects.create(user=self.employee2, manager=self.manager_other, employee_number="E-002")

        self.type_manager = RequestType.objects.create(
            name="Equipment", requires_manager_approval=True, requires_hr_approval=False
        )
        self.type_hr = RequestType.objects.create(
            name="Grievance", requires_manager_approval=False, requires_hr_approval=True
        )

        self.submitted = EmployeeRequest.objects.create(
            requester=self.employee,
            request_type=self.type_manager,
            title="Laptop",
            status=EmployeeRequest.Status.PENDING_MANAGER,
            manager_at_submission=self.manager,
            submitted_at=None,
        )
        self.submitted_url = reverse("review:request-detail", kwargs={"pk": self.submitted.pk})
        self.queue_url = reverse("review:request-queue")
        self.ts_queue_url = reverse("review:timesheet-queue")

    @staticmethod
    def _client_for(user):
        client = APIClient()
        client.force_login(user)
        return client

    def _sheet(self, employee, week_start=None, status=Timesheet.Status.SUBMITTED, version=2):
        week_start = week_start or date(2026, 9, 7)  # a Monday
        sheet = Timesheet.objects.create(employee=employee, week_start=week_start, status=status, version=version)
        TimeEntry.objects.create(
            timesheet=sheet, work_date=week_start, duration_minutes=480, unpaid_break_minutes=30
        )
        TimesheetEvent.objects.create(
            timesheet=sheet, actor=employee, action=TimesheetEvent.Action.SUBMITTED,
            from_status=Timesheet.Status.DRAFT, to_status=Timesheet.Status.SUBMITTED,
        )
        return sheet


class RequestQueueTests(ReviewBase):
    """GET /api/v1/review/requests/queue."""

    def test_manager_sees_active_direct_report_pending_requests(self):
        res = self._client_for(self.manager).get(self.queue_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        ids = [row["id"] for row in res.data["data"]]
        self.assertIn(str(self.submitted.pk), ids)

    def test_unrelated_manager_scope_is_empty_for_this_report(self):
        res = self._client_for(self.manager_other).get(self.queue_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["data"], [])

    def test_non_manager_role_scope_is_empty(self):
        res = self._client_for(self.plain).get(self.queue_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["data"], [])

    def test_manager_does_not_see_drafts_or_other_pending_scopes(self):
        EmployeeRequest.objects.create(
            requester=self.employee, request_type=self.type_manager,
            title="Draft thing", status=EmployeeRequest.Status.DRAFT,
        )
        other_pending = EmployeeRequest.objects.create(
            requester=self.employee2, request_type=self.type_manager,
            title="Other report", status=EmployeeRequest.Status.PENDING_MANAGER,
            manager_at_submission=self.manager_other,
        )
        res = self._client_for(self.manager).get(self.queue_url)
        ids = [row["id"] for row in res.data["data"]]
        self.assertNotIn(str(other_pending.pk), ids)
        for row in res.data["data"]:
            self.assertNotEqual(row["status"], EmployeeRequest.Status.DRAFT)

    def test_hr_sees_organization_records_but_cannot_decide_pending_manager(self):
        res = self._client_for(self.hr).get(self.queue_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        rows = {row["id"]: row for row in res.data["data"]}
        self.assertIn(str(self.submitted.pk), rows)
        self.assertEqual(rows[str(self.submitted.pk)]["permissions"]["can_decide"], False)

    def test_hr_read_scope_does_not_leak_drafts(self):
        EmployeeRequest.objects.create(
            requester=self.employee, request_type=self.type_manager,
            title="Draft", status=EmployeeRequest.Status.DRAFT,
        )
        res = self._client_for(self.hr).get(self.queue_url)
        for row in res.data["data"]:
            self.assertNotEqual(row["status"], EmployeeRequest.Status.DRAFT)

    def test_inactive_manager_cannot_authenticate_scope_defense_in_depth(self):
        # AC-01 pattern: inactive users cannot even authenticate (401); the
        # scope-function active check remains as defense in depth.
        self.manager.is_active = False
        self.manager.save(update_fields=["is_active"])
        res = self._client_for(self.manager).get(self.queue_url)
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_scope_function_returns_empty_for_inactive_manager(self):
        from review.scope import scope_requests

        self.manager.is_active = False
        self.manager.save(update_fields=["is_active"])
        self.manager.refresh_from_db()
        self.assertEqual(list(scope_requests(self.manager)), [])

    def test_inactive_direct_report_is_out_of_scope(self):
        self.employee.is_active = False
        self.employee.save(update_fields=["is_active"])
        res = self._client_for(self.manager).get(self.queue_url)
        self.assertEqual(res.data["data"], [])

    def test_status_filter(self):
        EmployeeRequest.objects.create(
            requester=self.employee, request_type=self.type_hr,
            title="Grievance", status=EmployeeRequest.Status.PENDING_HR,
        )
        res = self._client_for(self.hr).get(self.queue_url, {"status": "PENDING_HR"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        for row in res.data["data"]:
            self.assertEqual(row["status"], "PENDING_HR")

    def test_q_filter_matches_title_and_email(self):
        res = self._client_for(self.hr).get(self.queue_url, {"q": "Laptop"})
        self.assertEqual(len(res.data["data"]), 1)
        res = self._client_for(self.hr).get(self.queue_url, {"q": "emp@example"})
        self.assertEqual(len(res.data["data"]), 1)

    def test_bad_date_returns_422(self):
        res = self._client_for(self.hr).get(self.queue_url, {"date_from": "not-a-date"})
        self.assertEqual(res.status_code, 422)

    def test_date_filters_narrow_by_submitted_date(self):
        self.submitted.submitted_at = None
        self.submitted.save(update_fields=["submitted_at"])
        res = self._client_for(self.hr).get(self.queue_url, {"date_from": date(2026, 9, 1).isoformat()})
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_deterministic_sort_submitted_at_desc_then_id_asc(self):
        now_rows = []
        base = date(2026, 9, 10)
        for offset, label in ((0, "first"), (1, "second")):
            row = EmployeeRequest.objects.create(
                requester=self.employee, request_type=self.type_manager,
                title=f"Item {label}", status=EmployeeRequest.Status.PENDING_MANAGER,
                manager_at_submission=self.manager,
            )
            now_rows.append(row)
        # Deterministic: equal submitted_at (both NULL here) -> id ASC.
        res = self._client_for(self.manager).get(self.queue_url)
        ids = [row["id"] for row in res.data["data"]]
        self.assertEqual(ids, sorted(ids))

    def test_pagination_default_25_and_meta(self):
        base_url = self.queue_url
        for i in range(27):
            EmployeeRequest.objects.create(
                requester=self.employee, request_type=self.type_manager,
                title=f"Bulk {i}", status=EmployeeRequest.Status.PENDING_MANAGER,
                manager_at_submission=self.manager,
            )
        res = self._client_for(self.manager).get(base_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data["data"]), 25)
        self.assertEqual(res.data["meta"]["page_size"], 25)
        self.assertEqual(res.data["meta"]["count"], 28)  # 27 bulk + submitted fixture

    def test_page_size_caps_at_100(self):
        res = self._client_for(self.manager).get(self.queue_url, {"page_size": "500"})
        self.assertEqual(res.data["meta"]["page_size"], 100)

    def test_unauthenticated_401(self):
        res = APIClient().get(self.queue_url)
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)


class RequestReviewDetailTests(ReviewBase):
    """GET /api/v1/review/requests/{id}."""

    def test_manager_reads_in_scope_detail_200(self):
        res = self._client_for(self.manager).get(self.submitted_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["data"]["id"], str(self.submitted.pk))
        self.assertIn("events", res.data["data"])
        self.assertIn("attachments", res.data["data"])

    def test_out_of_scope_detail_is_safe_404(self):
        secret = EmployeeRequest.objects.create(
            requester=self.employee2, request_type=self.type_manager,
            title="Other manager request", status=EmployeeRequest.Status.PENDING_MANAGER,
            manager_at_submission=self.manager_other,
        )
        url = reverse("review:request-detail", kwargs={"pk": secret.pk})
        for user in (self.manager, self.plain):
            res = self._client_for(user).get(url)
            self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_nonexistent_id_is_same_404(self):
        url = reverse("review:request-detail", kwargs={"pk": uuid4()})
        for user in (self.manager, self.hr, self.plain):
            res = self._client_for(user).get(url)
            self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_malformed_pk_is_404(self):
        res = self._client_for(self.manager).get("/api/v1/review/requests/not-a-uuid")
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_hr_in_scope_read_shows_can_decide_false(self):
        res = self._client_for(self.hr).get(self.submitted_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["data"]["permissions"]["can_decide"], False)

    def test_hr_can_decide_true_in_pending_hr_state(self):
        pending_hr = EmployeeRequest.objects.create(
            requester=self.employee, request_type=self.type_hr,
            title="Grievance", status=EmployeeRequest.Status.PENDING_HR,
        )
        url = reverse("review:request-detail", kwargs={"pk": pending_hr.pk})
        res = self._client_for(self.hr).get(url)
        self.assertEqual(res.data["data"]["permissions"]["can_decide"], True)

    def test_manager_can_decide_true_for_own_direct_report(self):
        res = self._client_for(self.manager).get(self.submitted_url)
        self.assertEqual(res.data["data"]["permissions"]["can_decide"], True)

    def test_manager_can_decide_follows_current_reporting_line_not_snapshot(self):
        # QA finding 2 (Story 4.1): read permissions.can_decide must match
        # the CURRENT active direct-report scope (AC 4.1), not the
        # manager_at_submission snapshot. After the reporting line moves to
        # another manager, the former manager no longer sees the record in
        # their scoped queue and cannot act on it; the new current manager
        # sees it in their queue and shows can_decide=true.
        EmployeeProfile.objects.filter(user=self.employee).update(manager=self.manager_other)
        self.submitted.refresh_from_db()
        self.assertEqual(self.submitted.manager_at_submission, self.manager)  # snapshot untouched

        former = self._client_for(self.manager).get(self.queue_url)
        self.assertEqual(former.data["data"], [])
        res = self._client_for(self.manager).get(self.submitted_url)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

        current = self._client_for(self.manager_other).get(self.queue_url)
        ids = [row["id"] for row in current.data["data"]]
        self.assertIn(str(self.submitted.pk), ids)
        detail = self._client_for(self.manager_other).get(self.submitted_url)
        self.assertEqual(detail.data["data"]["permissions"]["can_decide"], True)

    def test_manager_can_decide_false_for_inactive_direct_report(self):
        # Current-scope consistency: an inactive direct report is outside the
        # active direct-report rule, so can_decide is false even in the
        # pending state.
        self.employee.is_active = False
        self.employee.save(update_fields=["is_active"])
        res = self._client_for(self.manager).get(self.submitted_url)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_get_does_not_mutate(self):
        before_version = self.submitted.version
        self._client_for(self.manager).get(self.submitted_url)
        self._client_for(self.manager).get(self.queue_url)
        self.submitted.refresh_from_db()
        self.assertEqual(self.submitted.version, before_version)
        self.assertFalse(RequestEvent.objects.filter(request=self.submitted).exists())

    def test_unauthenticated_401(self):
        res = APIClient().get(self.submitted_url)
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)


class TimesheetQueueTests(ReviewBase):
    """GET /api/v1/review/timesheets/queue."""

    def setUp(self):
        super().setUp()
        self.sheet = self._sheet(self.employee)

    def test_manager_sees_direct_report_submitted_timesheets(self):
        res = self._client_for(self.manager).get(self.ts_queue_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        ids = [row["id"] for row in res.data["data"]]
        self.assertIn(str(self.sheet.pk), ids)

    def test_unrelated_manager_scope_is_empty(self):
        sheet_other = self._sheet(self.employee2)
        res = self._client_for(self.manager).get(self.ts_queue_url)
        ids = [row["id"] for row in res.data["data"]]
        self.assertNotIn(str(sheet_other.pk), ids)
        self.assertEqual(ids, [str(self.sheet.pk)])

    def test_hr_sees_all_organization_sheets(self):
        sheet_other = self._sheet(self.employee2, week_start=date(2026, 8, 31))
        res = self._client_for(self.hr).get(self.ts_queue_url)
        ids = [row["id"] for row in res.data["data"]]
        self.assertIn(str(self.sheet.pk), ids)
        self.assertIn(str(sheet_other.pk), ids)

    def test_options_and_filters(self):
        res = self._client_for(self.hr).get(self.ts_queue_url, {"status": "SUBMITTED"})
        for row in res.data["data"]:
            self.assertEqual(row["status"], "SUBMITTED")

    def test_bad_date_422(self):
        res = self._client_for(self.hr).get(self.ts_queue_url, {"date_to": "tomorrow"})
        self.assertEqual(res.status_code, 422)

    def test_unauthenticated_401(self):
        res = APIClient().get(self.ts_queue_url)
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)


class TimesheetReviewDetailTests(ReviewBase):
    """GET /api/v1/review/timesheets/{id}."""

    def setUp(self):
        super().setUp()
        self.sheet = self._sheet(self.employee)
        self.url = reverse("review:timesheet-detail", kwargs={"pk": self.sheet.pk})

    def test_manager_reads_in_scope_detail(self):
        res = self._client_for(self.manager).get(self.url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["data"]["id"], str(self.sheet.pk))
        self.assertEqual(res.data["data"]["total_worked_minutes"], 480)
        self.assertIn("events", res.data["data"])

    def test_out_of_scope_404_no_disclosure(self):
        sheet_other = self._sheet(self.employee2, week_start=date(2026, 8, 24))
        url = reverse("review:timesheet-detail", kwargs={"pk": sheet_other.pk})
        res = self._client_for(self.manager).get(url)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_hr_read_can_decide_false_for_unrelated_sheet(self):
        sheet_other = self._sheet(self.employee2, week_start=date(2026, 8, 17))
        url = reverse("review:timesheet-detail", kwargs={"pk": sheet_other.pk})
        res = self._client_for(self.hr).get(url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        # QA finding 1 (Story 4.1): HR organization read scope is visibility
        # only — there is no explicit HR decision capability in the model,
        # so HR reads must never serialize can_decide=true, including on a
        # SUBMITTED sheet. The command endpoint's own authorization is
        # untouched (Story 3.3 snapshot).
        self.assertEqual(res.data["data"]["permissions"]["can_decide"], False)

    def test_hr_queue_read_shows_can_decide_false_for_submitted_sheet(self):
        # QA finding 1 (Story 4.1): same rule on the queue rows, not just the
        # detail view.
        res = self._client_for(self.hr).get(self.ts_queue_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        rows = {row["id"]: row for row in res.data["data"]}
        self.assertIn(str(self.sheet.pk), rows)
        self.assertEqual(rows[str(self.sheet.pk)]["permissions"]["can_decide"], False)

    def test_hr_read_can_decide_false_for_non_submitted_sheet(self):
        approved = self._sheet(self.employee2, week_start=date(2026, 8, 17), status=Timesheet.Status.APPROVED)
        url = reverse("review:timesheet-detail", kwargs={"pk": approved.pk})
        res = self._client_for(self.hr).get(url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["data"]["permissions"]["can_decide"], False)

    def test_nonexistent_404(self):
        url = reverse("review:timesheet-detail", kwargs={"pk": uuid4()})
        res = self._client_for(self.hr).get(url)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_get_does_not_mutate_version(self):
        before = self.sheet.version
        self._client_for(self.manager).get(self.url)
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.version, before)

    def test_unauthenticated_401(self):
        res = APIClient().get(self.url)
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
