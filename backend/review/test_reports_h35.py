"""H35 focused tests: attendance + people report categories, the contract
filter set (from/to aliases, repeatable status, department/employee ids)
and the month-closing totals.

Covers:
- Each new category scoped for BOTH roles: a manager sees exactly their
  department scope (review.scope.scoped_employee_ids), HR sees their own
  company — and never any other tenant's rows.
- A cross-company department id / employee id narrows to nothing (200 with
  empty rows), never an existence-disclosing error.
- The month closing: attendance /totals with from/to covering a month
  returns per-employee day counts and canonical minute totals.
- The filter set: from/to aliases, repeatable status (repeated params and
  comma form), malformed ids -> 422, people has no status vocabulary.
- CSV shape for the new categories: header, Content-Disposition, audit
  event, row-count parity with /rows.
- Employees stay 403 on every kind of the new categories.
"""
import csv
import io

from datetime import date, timedelta

from django.core.cache import cache
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from accounts.models import AuditEvent, Company, Department, EmployeeProfile, User
from reqs.models import EmployeeRequest, RequestType
from tenants.context import default_company
from timesheets.models import TimeEntry, Timesheet


def _mk_user(email, role=User.Role.EMPLOYEE, active=True, company=None, **kw):
    u = User.objects.create_user(
        company=company or default_company(), email=email, password="pass-12345678", role=role, **kw
    )
    if not active:
        u.is_active = False
        u.save(update_fields=["is_active"])
    return u


def _monday_of_this_week():
    today = date.today()
    return today - timedelta(days=today.weekday())


class ReportH35Base(APITestCase):
    """One company with two departments + one empty tenant (`beta`)."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        company = default_company()

        self.dept1 = Department.objects.create(company=company, code="D-1", name_ar="الأولى")
        self.dept2 = Department.objects.create(company=company, code="D-2", name_ar="الثانية")
        self.manager1 = _mk_user("mgr1@example.com", role=User.Role.MANAGER, full_name="Manager One")
        self.manager2 = _mk_user("mgr2@example.com", role=User.Role.MANAGER, full_name="Manager Two")
        self.dept1.manager = self.manager1
        self.dept2.manager = self.manager2
        self.dept1.save(update_fields=["manager"])
        self.dept2.save(update_fields=["manager"])

        self.emp1 = _mk_user("emp1@example.com", full_name="Employee One")
        self.emp2 = _mk_user("emp2@example.com", full_name="Employee Two")
        self.emp3 = _mk_user("emp3@example.com", full_name="Employee Three")
        self.hr = _mk_user("hr@example.com", role=User.Role.HR, full_name="HR Person")
        self.plain = _mk_user("plain@example.com", full_name="Plain Person")

        EmployeeProfile.objects.create(company=company, user=self.emp1, manager=self.manager1, department=self.dept1, employee_number="E-001")
        EmployeeProfile.objects.create(company=company, user=self.emp2, manager=self.manager2, department=self.dept2, employee_number="E-002")
        EmployeeProfile.objects.create(company=company, user=self.emp3, manager=self.manager1, employee_number="E-003")  # no department
        EmployeeProfile.objects.create(company=company, user=self.manager1, department=self.dept1, employee_number="M-001")
        EmployeeProfile.objects.create(company=company, user=self.manager2, department=self.dept2, employee_number="M-002")

        self.rtype = RequestType.objects.create(company=company, name="Equipment", requires_manager_approval=True)
        self.req1 = EmployeeRequest.objects.create(requester=self.emp1, request_type=self.rtype, title="Emp1 laptop", status=EmployeeRequest.Status.PENDING_MANAGER, manager_at_submission=self.manager1)
        self.req_ok = EmployeeRequest.objects.create(requester=self.emp1, request_type=self.rtype, title="Emp1 approved", status=EmployeeRequest.Status.APPROVED)
        self.req2 = EmployeeRequest.objects.create(requester=self.emp2, request_type=self.rtype, title="Emp2 laptop", status=EmployeeRequest.Status.PENDING_MANAGER, manager_at_submission=self.manager2)

        monday = _monday_of_this_week()
        self.monday = monday
        prev_monday = monday - timedelta(days=7)
        self.prev_monday = prev_monday

        # emp1 current week: one PRESENT day + one INCOMPLETE day
        self.sheet1 = Timesheet.objects.create(employee=self.emp1, week_start=monday, status=Timesheet.Status.SUBMITTED)
        self.entry_present = TimeEntry.objects.create(timesheet=self.sheet1, work_date=monday, duration_minutes=480, unpaid_break_minutes=30)
        self.entry_incomplete = TimeEntry.objects.create(timesheet=self.sheet1, work_date=monday + timedelta(days=1), duration_minutes=0)
        # emp1 previous week (APPROVED): outside the default current-week window
        self.sheet_prev = Timesheet.objects.create(employee=self.emp1, week_start=prev_monday, status=Timesheet.Status.APPROVED)
        self.entry_prev = TimeEntry.objects.create(timesheet=self.sheet_prev, work_date=prev_monday + timedelta(days=2), duration_minutes=240)
        # emp2 (dept2) current week
        self.sheet2 = Timesheet.objects.create(employee=self.emp2, week_start=monday, status=Timesheet.Status.SUBMITTED)
        self.entry_emp2 = TimeEntry.objects.create(timesheet=self.sheet2, work_date=monday, duration_minutes=300)
        # emp1 DRAFT sheet NEXT week: inside HR scope, outside the manager's
        # (unique (employee, week_start) forces a different week; the below
        # HR test asks for a window covering both weeks).
        self.sheet_draft = Timesheet.objects.create(employee=self.emp1, week_start=monday + timedelta(days=7), status=Timesheet.Status.DRAFT)
        self.entry_draft = TimeEntry.objects.create(timesheet=self.sheet_draft, work_date=monday + timedelta(days=9), duration_minutes=60)

        # Second tenant: nothing here may ever reach company A's reports.
        beta = Company.objects.create(slug="h35-beta", name="Beta")
        self.beta_company = beta
        self.hr_b = _mk_user("hr@beta.test", role=User.Role.HR, company=beta)
        self.emp_b = _mk_user("emp@beta.test", company=beta)
        self.dept_b = Department.objects.create(company=beta, code="B-1", name_ar="بيتا")
        self.req_b = EmployeeRequest.objects.create(
            company=beta, requester=self.emp_b,
            request_type=RequestType.objects.create(company=beta, name="Beta equip"),
            title="Beta request", status=EmployeeRequest.Status.PENDING_HR,
        )
        self.sheet_b = Timesheet.objects.create(company=beta, employee=self.emp_b, week_start=monday, status=Timesheet.Status.SUBMITTED)
        self.entry_b = TimeEntry.objects.create(timesheet=self.sheet_b, work_date=monday, duration_minutes=90)

    def auth_manager(self):
        self.client.force_authenticate(user=self.manager1)

    def auth_hr(self):
        self.client.force_authenticate(user=self.hr)

    def url(self, kind, cat):
        return reverse(f"review:report-{kind}", args=[cat])

    def csv_rows(self, resp):
        text = resp.content.decode("utf-8-sig")
        reader = list(csv.reader(io.StringIO(text)))
        header = next(r for r in reader if r and not r[0].startswith("#"))
        data = [r for r in reader if r and not r[0].startswith("#")]
        return header, data[1:]


class TestAttendanceScoped(ReportH35Base):
    def test_manager_sees_own_department_non_draft_only(self):
        self.auth_manager()
        data = self.client.get(self.url("rows", "attendance")).json()["data"]
        # Default window = current week; DRAFT sheets are outside the manager's
        # scope; emp2 belongs to dept2 (other manager).
        self.assertEqual(
            {(r["employee_id"], r["duration_minutes"]) for r in data},
            {(str(self.emp1.pk), 480), (str(self.emp1.pk), 0)},
        )
        self.assertNotIn(str(self.entry_draft.id), {r["id"] for r in data})

    def test_hr_sees_whole_company_including_draft_never_beta(self):
        self.auth_hr()
        # A window covering the current AND the next week: the DRAFT-sheet day
        # is in scope for HR (it is not for a manager), beta never appears.
        data = self.client.get(
            self.url("rows", "attendance"),
            {"from": self.monday.isoformat(), "to": (self.monday + timedelta(days=13)).isoformat()},
        ).json()["data"]
        self.assertEqual(
            {r["duration_minutes"] for r in data}, {480, 0, 300, 60}
        )
        self.assertNotIn(str(self.emp_b.pk), {r["employee_id"] for r in data})

    def test_default_window_is_current_week(self):
        self.auth_manager()
        without = self.client.get(self.url("rows", "attendance")).json()["data"]
        self.assertNotIn(str(self.entry_prev.id), {r["id"] for r in without})
        meta = self.client.get(self.url("rows", "attendance")).json()["meta"]
        self.assertEqual(meta["date_from"], self.monday.isoformat())
        self.assertEqual(meta["date_to"], (self.monday + timedelta(days=6)).isoformat())

        window = {
            "from": self.prev_monday.isoformat(),
            "to": (self.prev_monday + timedelta(days=6)).isoformat(),
        }
        with_prev = self.client.get(self.url("rows", "attendance"), window).json()["data"]
        self.assertIn(str(self.entry_prev.id), {r["id"] for r in with_prev})
        self.assertNotIn(str(self.entry_present.id), {r["id"] for r in with_prev})

    def test_derived_status_and_status_filter(self):
        self.auth_manager()
        present = self.client.get(self.url("rows", "attendance"), {"status": "PRESENT"}).json()["data"]
        self.assertEqual([r["duration_minutes"] for r in present], [480])
        incomplete = self.client.get(self.url("rows", "attendance"), {"status": "INCOMPLETE"}).json()["data"]
        self.assertEqual([r["duration_minutes"] for r in incomplete], [0])
        totals = self.client.get(self.url("totals", "attendance")).json()["data"]
        # Manager default window: 480 (PRESENT) + the 0-minute day (INCOMPLETE);
        # the DRAFT-sheet day is outside the manager's scope, prev week out of window.
        self.assertEqual(totals["counts_by_status"], {"PRESENT": 1, "INCOMPLETE": 1})
        self.assertEqual(totals["total"], 2)

    def test_status_filter_unknown_vocabulary_422(self):
        self.auth_manager()
        resp = self.client.get(self.url("rows", "attendance"), {"status": "LEAVE"})
        self.assertEqual(resp.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        resp2 = self.client.get(self.url("rows", "attendance"), {"status": "ABSENT"})
        self.assertEqual(resp2.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_department_and_employee_filters_narrow_inside_scope(self):
        self.auth_hr()
        rows = self.client.get(self.url("rows", "attendance"), {"employee": str(self.emp1.pk)}).json()["data"]
        self.assertEqual({r["employee_id"] for r in rows}, {str(self.emp1.pk)})
        rows = self.client.get(self.url("rows", "attendance"), {"department": str(self.dept2.pk)}).json()["data"]
        self.assertEqual({r["employee_id"] for r in rows}, {str(self.emp2.pk)})
        rows = self.client.get(self.url("rows", "attendance"), {"department": str(self.dept_b.pk)}).json()["data"]
        self.assertEqual(rows, [])

    def test_employee_403_on_every_kind(self):
        self.client.force_authenticate(user=self.plain)
        for kind in ("rows", "totals", "dashboard", "csv"):
            self.assertEqual(self.client.get(self.url(kind, "attendance")).status_code, status.HTTP_403_FORBIDDEN)

    def test_manager_meta_scope(self):
        self.auth_manager()
        meta = self.client.get(self.url("totals", "attendance")).json()["meta"]
        self.assertEqual(meta["scope"], "MANAGER_ACTIVE_DIRECT_REPORTS")
        self.assertEqual(meta["report"], "attendance")


class TestPeopleScoped(ReportH35Base):
    def test_hr_rows_headcounts_totals(self):
        self.auth_hr()
        body = self.client.get(self.url("rows", "people")).json()
        rows = body["data"]
        by_code = {r["department_code"]: r["headcount"] for r in rows}
        self.assertEqual(by_code, {"D-1": 2, "D-2": 2, "": 1})  # "" bucket = emp3, unassigned
        unassigned = next(r for r in rows if r["department_id"] is None)
        self.assertEqual(unassigned["id"], "unassigned")
        self.assertEqual(rows[-1]["department_id"], None)  # deterministic: bucket last
        totals = self.client.get(self.url("totals", "people")).json()["data"]
        self.assertEqual(totals["total"], 5)  # emp1, emp2, emp3, manager1, manager2
        self.assertEqual(totals["departments"], 2)
        self.assertEqual(totals["managers"], 2)

    def test_manager_scope_is_their_department_plus_self(self):
        self.auth_manager()
        rows = self.client.get(self.url("rows", "people")).json()["data"]
        self.assertEqual(
            [(r["department_code"], r["headcount"]) for r in rows],
            [("D-1", 2)],  # emp1 + the manager themself
        )
        totals = self.client.get(self.url("totals", "people")).json()["data"]
        self.assertEqual(totals, {"total": 2, "departments": 1, "managers": 1})

    def test_cross_company_department_narrows_to_nothing(self):
        self.auth_hr()
        resp = self.client.get(self.url("rows", "people"), {"department": str(self.dept_b.pk)})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.json()["data"], [])
        self.assertEqual(resp.json()["meta"]["row_count"], 0)

    def test_cross_company_employee_narrows_to_nothing(self):
        self.auth_manager()
        resp = self.client.get(self.url("rows", "people"), {"employee": str(self.emp_b.pk)})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.json()["data"], [])

    def test_nonexistent_ids_narrow_to_nothing(self):
        self.auth_hr()
        for params in ({"department": "999999"}, {"employee": "999999"}):
            resp = self.client.get(self.url("rows", "people"), params)
            self.assertEqual(resp.status_code, status.HTTP_200_OK)
            self.assertEqual(resp.json()["data"], [])

    def test_people_has_no_status_vocabulary_422(self):
        self.auth_hr()
        resp = self.client.get(self.url("rows", "people"), {"status": "APPROVED"})
        self.assertEqual(resp.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("people", resp.json()["error"]["fields"]["non_field_errors"][0])

    def test_dates_validated_but_do_not_narrow_headcount(self):
        self.auth_hr()
        base = self.client.get(self.url("rows", "people")).json()["data"]
        windowed = self.client.get(
            self.url("rows", "people"), {"from": "2000-01-01", "to": "2100-01-01"}
        ).json()
        self.assertEqual(windowed["data"], base)
        self.assertEqual(windowed["meta"]["date_from"], "2000-01-01")

    def test_malformed_ids_422(self):
        self.auth_hr()
        for params in ({"department": "abc"}, {"employee": "1.5"}, {"department": "0"}):
            resp = self.client.get(self.url("rows", "people"), params)
            self.assertEqual(resp.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_employee_403_on_every_kind(self):
        self.client.force_authenticate(user=self.plain)
        for kind in ("rows", "totals", "dashboard", "csv"):
            self.assertEqual(self.client.get(self.url(kind, "people")).status_code, status.HTTP_403_FORBIDDEN)

    def test_hr_meta_scope(self):
        self.auth_hr()
        meta = self.client.get(self.url("dashboard", "people")).json()["meta"]
        self.assertEqual(meta["scope"], "HR_ORGANIZATION")


class TestMonthClosing(ReportH35Base):
    """Fixed March 2026 data: `totals` with from/to covering a month IS the
    month closing (per-employee day counts + canonical minutes)."""

    def setUp(self):
        super().setUp()
        week = date(2026, 3, 2)  # Monday
        sheet_a = Timesheet.objects.create(employee=self.emp1, week_start=week, status=Timesheet.Status.APPROVED)
        TimeEntry.objects.create(timesheet=sheet_a, work_date=week, duration_minutes=480, unpaid_break_minutes=15)
        TimeEntry.objects.create(timesheet=sheet_a, work_date=week + timedelta(days=1), duration_minutes=0)
        TimeEntry.objects.create(timesheet=sheet_a, work_date=week + timedelta(days=2), duration_minutes=240)
        sheet_b = Timesheet.objects.create(employee=self.emp2, week_start=week, status=Timesheet.Status.SUBMITTED)
        TimeEntry.objects.create(timesheet=sheet_b, work_date=week, duration_minutes=600, unpaid_break_minutes=45)
        # Outside the March window: must never appear in the closing.
        sheet_out = Timesheet.objects.create(employee=self.emp1, week_start=date(2026, 4, 6), status=Timesheet.Status.APPROVED)
        TimeEntry.objects.create(timesheet=sheet_out, work_date=date(2026, 4, 7), duration_minutes=120)

    def test_hr_month_closing_per_employee(self):
        self.auth_hr()
        data = self.client.get(
            self.url("totals", "attendance"), {"from": "2026-03-01", "to": "2026-03-31"}
        ).json()["data"]
        self.assertEqual(data["total"], 4)
        self.assertEqual(data["counts_by_status"], {"PRESENT": 3, "INCOMPLETE": 1})
        by_email = {row["employee_email"]: row for row in data["per_employee"]}
        self.assertEqual(
            by_email["emp1@example.com"],
            {
                "employee_id": str(self.emp1.pk),
                "employee_name": "Employee One",
                "employee_email": "emp1@example.com",
                "present_days": 2,
                "incomplete_days": 1,
                "total_worked_minutes": 720,
                "total_unpaid_break_minutes": 15,
            },
        )
        self.assertEqual(by_email["emp2@example.com"]["total_worked_minutes"], 600)
        self.assertEqual(by_email["emp2@example.com"]["total_unpaid_break_minutes"], 45)
        self.assertEqual(len(data["per_employee"]), 2)  # the April entry is out

    def test_manager_month_closing_is_their_department_only(self):
        self.auth_manager()
        data = self.client.get(
            self.url("totals", "attendance"), {"from": "2026-03-01", "to": "2026-03-31"}
        ).json()["data"]
        self.assertEqual(len(data["per_employee"]), 1)
        self.assertEqual(data["per_employee"][0]["employee_id"], str(self.emp1.pk))
        self.assertEqual(data["per_employee"][0]["total_worked_minutes"], 720)

    def test_beta_hr_cannot_see_company_a_month(self):
        self.client.force_authenticate(user=self.hr_b)
        data = self.client.get(
            self.url("totals", "attendance"), {"from": "2026-03-01", "to": "2026-03-31"}
        ).json()["data"]
        self.assertEqual(data["total"], 0)
        self.assertEqual(data["per_employee"], [])


class TestContractFilters(ReportH35Base):
    def test_from_to_aliases_match_legacy_names_timesheets(self):
        self.auth_manager()
        legacy = self.client.get(
            self.url("rows", "timesheets"),
            {"date_from": self.monday.isoformat(), "date_to": self.monday.isoformat()},
        ).json()["data"]
        alias = self.client.get(
            self.url("rows", "timesheets"),
            {"from": self.monday.isoformat(), "to": self.monday.isoformat()},
        ).json()["data"]
        self.assertEqual(alias, legacy)
        self.assertEqual(len(alias), 1)  # only the current-week sheet (prev week cut)

    def test_repeatable_status_repeated_params(self):
        self.auth_hr()
        data = self.client.get(
            self.url("rows", "requests"),
            [("status", "PENDING_MANAGER"), ("status", "APPROVED")],
        ).json()["data"]
        self.assertEqual({r["status"] for r in data}, {"PENDING_MANAGER", "APPROVED"})
        self.assertEqual(len(data), 3)
        filters = self.client.get(
            self.url("rows", "requests"), {"status": "APPROVED"}
        ).json()["meta"]["filters_applied"]
        self.assertEqual(filters["status"], ["APPROVED"])

    def test_repeatable_status_comma_form(self):
        self.auth_hr()
        data = self.client.get(
            self.url("rows", "requests"), {"status": "PENDING_MANAGER,APPROVED"}
        ).json()["data"]
        self.assertEqual(len(data), 3)

    def test_repeatable_status_invalid_value_422(self):
        self.auth_hr()
        resp = self.client.get(
            self.url("rows", "requests"), {"status": "APPROVED", "status": "BOGUS"}
        )
        self.assertEqual(resp.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_department_employee_filters_on_requests(self):
        self.auth_hr()
        rows = self.client.get(self.url("rows", "requests"), {"department": str(self.dept1.pk)}).json()["data"]
        self.assertEqual({r["requester_id"] for r in rows}, {str(self.emp1.pk)})
        rows = self.client.get(self.url("rows", "requests"), {"employee": str(self.emp2.pk)}).json()["data"]
        self.assertEqual({r["requester_id"] for r in rows}, {str(self.emp2.pk)})
        rows = self.client.get(self.url("rows", "requests"), {"department": str(self.dept_b.pk)}).json()["data"]
        self.assertEqual(rows, [])

    def test_manager_department_filter_outside_scope_narrows_to_nothing(self):
        self.auth_manager()
        rows = self.client.get(self.url("rows", "requests"), {"department": str(self.dept2.pk)}).json()["data"]
        self.assertEqual(rows, [])
        rows = self.client.get(self.url("rows", "timesheets"), {"department": str(self.dept2.pk)}).json()["data"]
        self.assertEqual(rows, [])

    def test_cross_company_employee_on_timesheets_narrows_to_nothing(self):
        self.auth_hr()
        rows = self.client.get(self.url("rows", "timesheets"), {"employee": str(self.emp_b.pk)}).json()["data"]
        self.assertEqual(rows, [])


class TestCsvShapeNewCategories(ReportH35Base):
    def test_attendance_csv_shape_and_audit(self):
        from review.csv_export import ATTENDANCE_ROWS_HEADER

        self.auth_hr()
        rows_json = self.client.get(self.url("rows", "attendance")).json()["data"]
        resp = self.client.get(self.url("csv", "attendance"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp["Content-Disposition"].startswith("attachment; filename="))
        self.assertIn("attendance_report_", resp["Content-Disposition"])
        header, data = self.csv_rows(resp)
        self.assertEqual(tuple(header), ATTENDANCE_ROWS_HEADER)
        self.assertEqual(len(data), len(rows_json))
        self.assertIn("REPORT_EXPORT_ATTENDANCE", [e.action for e in AuditEvent.objects.all()])
        self.assertTrue(resp["X-Audit-Event-Id"])

    def test_people_csv_shape_and_audit(self):
        from review.csv_export import PEOPLE_ROWS_HEADER

        self.auth_hr()
        rows_json = self.client.get(self.url("rows", "people")).json()["data"]
        resp = self.client.get(self.url("csv", "people"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        header, data = self.csv_rows(resp)
        self.assertEqual(tuple(header), PEOPLE_ROWS_HEADER)
        self.assertEqual(len(data), len(rows_json))
        headcounts = {r[6]: r[9] for r in data}  # department_code -> headcount
        self.assertEqual(headcounts, {"D-1": "2", "D-2": "2", "": "1"})
        self.assertIn("REPORT_EXPORT_PEOPLE", [e.action for e in AuditEvent.objects.all()])

    def test_attendance_csv_values_match_rows(self):
        self.auth_manager()
        rows_json = self.client.get(self.url("rows", "attendance")).json()["data"]
        _header, data = self.csv_rows(self.client.get(self.url("csv", "attendance")))
        # work_date column 8, status column 9, minutes column 10
        self.assertEqual(
            {(r[8], r[9], int(r[10])) for r in data},
            {(r["work_date"], r["status"], r["duration_minutes"]) for r in rows_json},
        )

    def test_rejected_people_export_not_audited(self):
        self.client.force_authenticate(user=self.plain)
        resp = self.client.get(self.url("csv", "people"))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(AuditEvent.objects.filter(action="REPORT_EXPORT_PEOPLE").exists())
        self.assertFalse(AuditEvent.objects.filter(action="REPORT_EXPORT_ATTENDANCE").exists())
