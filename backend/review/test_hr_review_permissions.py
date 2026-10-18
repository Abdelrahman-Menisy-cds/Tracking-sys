"""Behaviour contract: a reviewer who can SEE a queue row can DECIDE on it.

The review screens offer a decision from ONE signal — the row's
``permissions.can_decide`` — so that flag has to agree with what the decision
endpoints actually accept. These tests pin that agreement for the HR reviewer
on both review resources (requests and timesheets), and pin the denials that
must survive: a manager acts only inside their own scope, a non-reviewer gets
the safe 404, and nobody reviews their own record.
"""
from datetime import date

from django.core.cache import cache
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from accounts.models import EmployeeProfile, User
from reqs.models import EmployeeRequest, RequestType
from timesheets.models import TimeEntry, Timesheet, TimesheetEvent
from tenants.context import default_company


def _mk_user(email, role=User.Role.EMPLOYEE, **kw):
    return User.objects.create_user(company=default_company(), email=email, password="pass-12345678", role=role, **kw)


class HrReviewContractBase(APITestCase):
    def setUp(self):
        cache.clear()
        self.employee = _mk_user("emp@example.com")
        self.employee2 = _mk_user("emp2@example.com")
        self.manager = _mk_user("mgr@example.com", role=User.Role.MANAGER)
        self.manager_other = _mk_user("mgr2@example.com", role=User.Role.MANAGER)
        self.hr = _mk_user("hr@example.com", role=User.Role.HR)
        self.plain = _mk_user("plain@example.com")
        EmployeeProfile.objects.create(company=default_company(), user=self.employee, manager=self.manager, employee_number="E-001")
        EmployeeProfile.objects.create(company=default_company(), user=self.employee2, manager=self.manager_other, employee_number="E-002")

        self.type_hr = RequestType.objects.create(
            company=default_company(), name="Grievance", requires_manager_approval=False, requires_hr_approval=True
        )
        self.type_manager = RequestType.objects.create(
            company=default_company(), name="Equipment", requires_manager_approval=True, requires_hr_approval=False
        )

        # A request waiting on HR: the state the HR reviewer is meant to decide.
        self.pending_hr = EmployeeRequest.objects.create(
            requester=self.employee, request_type=self.type_hr, title="Grievance",
            status=EmployeeRequest.Status.PENDING_HR, manager_at_submission=self.manager, submitted_at=None,
        )
        # A manager-stage request of THIS manager's report, and one of another manager's.
        self.pending_manager = EmployeeRequest.objects.create(
            requester=self.employee, request_type=self.type_manager, title="Laptop",
            status=EmployeeRequest.Status.PENDING_MANAGER, manager_at_submission=self.manager, submitted_at=None,
        )
        self.other_manager_pending = EmployeeRequest.objects.create(
            requester=self.employee2, request_type=self.type_manager, title="Other manager request",
            status=EmployeeRequest.Status.PENDING_MANAGER, manager_at_submission=self.manager_other, submitted_at=None,
        )

        self.request_queue_url = reverse("review:request-queue")
        self.ts_queue_url = reverse("review:timesheet-queue")

    @staticmethod
    def _client_for(user):
        client = APIClient()
        client.force_login(user)
        return client

    def _sheet(self, employee, week_start=date(2026, 9, 7)):
        sheet = Timesheet.objects.create(
            employee=employee, week_start=week_start, status=Timesheet.Status.SUBMITTED, version=2
        )
        TimeEntry.objects.create(timesheet=sheet, work_date=week_start, duration_minutes=480, unpaid_break_minutes=30)
        TimesheetEvent.objects.create(
            timesheet=sheet, actor=employee, action=TimesheetEvent.Action.SUBMITTED,
            from_status=Timesheet.Status.DRAFT, to_status=Timesheet.Status.SUBMITTED,
        )
        return sheet

    def _decide_request(self, user, request_obj, action="approve", key="k-req"):
        url = reverse("reqs:request-decision", kwargs={"pk": request_obj.pk})
        return self._client_for(user).post(
            url, {"action": action, "version": request_obj.version}, format="json", HTTP_IDEMPOTENCY_KEY=key
        )


class HrDecidesPendingHrRequestTests(HrReviewContractBase):
    """HR owns the PENDING_HR stage: it must see the row AND be able to decide it."""

    def test_queue_row_for_pending_hr_offers_hr_a_decision(self):
        res = self._client_for(self.hr).get(self.request_queue_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        rows = {row["id"]: row for row in res.data["data"]}
        self.assertIn(str(self.pending_hr.pk), rows)
        self.assertEqual(rows[str(self.pending_hr.pk)]["permissions"]["can_decide"], True)

    def test_hr_decision_advances_pending_hr_to_approved(self):
        before = self.pending_hr.version
        response = self._decide_request(self.hr, self.pending_hr)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.pending_hr.refresh_from_db()
        self.assertEqual(self.pending_hr.status, EmployeeRequest.Status.APPROVED)
        self.assertEqual(self.pending_hr.version, before + 1)

    def test_hr_self_review_still_denied(self):
        own = EmployeeRequest.objects.create(
            requester=self.hr, request_type=self.type_hr, title="My own request",
            status=EmployeeRequest.Status.PENDING_HR, submitted_at=None,
        )
        rows = {row["id"]: row for row in self._client_for(self.hr).get(self.request_queue_url).data["data"]}
        self.assertEqual(rows[str(own.pk)]["permissions"]["can_decide"], False)
        response = self._decide_request(self.hr, own, key="k-self")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)


class HrDecidesSubmittedTimesheetTests(HrReviewContractBase):
    """The sibling resource: HR sees SUBMITTED sheets, so the flag must let HR decide them."""

    def test_queue_row_for_submitted_sheet_offers_hr_a_decision(self):
        sheet = self._sheet(self.employee)
        res = self._client_for(self.hr).get(self.ts_queue_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        rows = {row["id"]: row for row in res.data["data"]}
        self.assertIn(str(sheet.pk), rows)
        self.assertEqual(rows[str(sheet.pk)]["permissions"]["can_decide"], True)

    def test_hr_decision_advances_submitted_sheet_to_approved(self):
        sheet = self._sheet(self.employee)
        url = reverse("timesheets:timesheet-decision", kwargs={"pk": sheet.pk})
        response = self._client_for(self.hr).post(
            url, {"action": "approve", "version": sheet.version}, format="json", HTTP_IDEMPOTENCY_KEY="k-ts"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        sheet.refresh_from_db()
        self.assertEqual(sheet.status, Timesheet.Status.APPROVED)


class ScopeDenialsSurviveTests(HrReviewContractBase):
    """Widening the HR rule must not widen anyone else's."""

    def test_manager_decides_own_scoped_row(self):
        response = self._decide_request(self.manager, self.pending_manager, key="k-mgr")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.pending_manager.refresh_from_db()
        self.assertEqual(self.pending_manager.status, EmployeeRequest.Status.APPROVED)

    def test_manager_cannot_decide_another_managers_row(self):
        response = self._decide_request(self.manager, self.other_manager_pending, key="k-mgr2")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_manager_is_not_offered_the_hr_stage_row(self):
        rows = {row["id"]: row for row in self._client_for(self.manager).get(self.request_queue_url).data["data"]}
        self.assertIn(str(self.pending_hr.pk), rows)  # read scope keeps the history
        self.assertEqual(rows[str(self.pending_hr.pk)]["permissions"]["can_decide"], False)

    def test_non_scoped_employee_decision_is_safe_404(self):
        response = self._decide_request(self.plain, self.pending_hr, key="k-plain")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
