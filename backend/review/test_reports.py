"""Story 4.3 focused tests: bounded scoped CSV reports (manager/HR).

Covers:
- Scope parity: rows / totals / dashboard / CSV all derive from the ONE
  server-derived scope+filter source (same scope, same filters, same rows).
- Scope BEFORE filtering/counting: out-of-scope rows never appear anywhere.
- Manager = active direct reports; HR = organization-wide read.
- Authorized filters (status / date_from / date_to / q) and invalid
  filters -> 422.
- Deterministic output and explicit metadata (org timezone, date interval,
  scope) present in EVERY output, and CSV comment rows carry the same.
- CSV: UTF-8-safe (BOM + Arabic round-trip), formula injection
  neutralized, explicit minute units, deterministic byte order.
- 10,000-row boundary: CSV rejects with no partial output; rows endpoint
  truncates with meta flag.
- Unauthorized users (employee/anonymous) -> 403/401; revoked (inactive)
  accounts -> 403.
- Rate limit 5/hour -> 429 (cache-cleared base).
- Export audit event append-only; rejected exports leave no audit event.
- No disk save claim: response is streamed bytes only (no file written).
- Read-only: no decision/edit capability granted by report output.
"""
import csv
import io
from datetime import date, timedelta
from unittest import mock

import django.utils.timezone as django_tz

from django.core.cache import cache
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from accounts.models import AuditEvent, EmployeeProfile, User
from reqs.models import EmployeeRequest, RequestType
from timesheets.models import TimeEntry, Timesheet


def _mk_user(email, role=User.Role.EMPLOYEE, active=True, **kw):
    u = User.objects.create_user(email=email, password="pass-12345678", role=role, **kw)
    u.is_active = active
    u.save(update_fields=["is_active"])
    return u


class ReportBase(APITestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.employee = _mk_user("emp@example.com")
        self.employee.full_name = "Emp=First"
        self.employee.save(update_fields=["full_name"])
        self.employee2 = _mk_user("emp2@example.com")
        self.manager = _mk_user("mgr@example.com", role=User.Role.MANAGER)
        self.other_mgr = _mk_user("mgr2@example.com", role=User.Role.MANAGER)
        self.hr = _mk_user("hr@example.com", role=User.Role.HR)
        self.plain = _mk_user("plain@example.com")
        EmployeeProfile.objects.create(user=self.employee, manager=self.manager, employee_number="E-001")
        EmployeeProfile.objects.create(user=self.employee2, manager=self.other_mgr, employee_number="E-002")

        self.rtype = RequestType.objects.create(name="Equipment", requires_manager_approval=True)
        self.submitted = EmployeeRequest.objects.create(
            requester=self.employee,
            request_type=self.rtype,
            title="Laptop @work",
            status=EmployeeRequest.Status.PENDING_MANAGER,
            manager_at_submission=self.manager,
            version=1,
        )
        self.other_req = EmployeeRequest.objects.create(
            requester=self.employee2,
            request_type=self.rtype,
            title="Other laptop",
            status=EmployeeRequest.Status.PENDING_MANAGER,
            manager_at_submission=self.other_mgr,
            version=1,
        )
        now = date.today()
        monday = now - timedelta(days=now.weekday())
        self.sheet = Timesheet.objects.create(employee=self.employee, week_start=monday, status=Timesheet.Status.SUBMITTED)
        TimeEntry.objects.create(timesheet=self.sheet, work_date=monday, duration_minutes=480, unpaid_break_minutes=30)
        self.other_sheet = Timesheet.objects.create(employee=self.employee2, week_start=monday, status=Timesheet.Status.SUBMITTED)
        TimeEntry.objects.create(timesheet=self.other_sheet, work_date=monday, duration_minutes=120)

    def auth_manager(self):
        self.client.force_authenticate(user=self.manager)

    def auth_hr(self):
        self.client.force_authenticate(user=self.hr)


class TestScopeParity(ReportBase):
    def url(self, kind, cat="requests"):
        return reverse(f"review:report-{kind}", args=[cat])

    def test_rows_vs_csv_same_rows_manager(self):
        self.auth_manager()
        rows = self.client.get(self.url("rows"), {"status": "PENDING_MANAGER"}).json()["data"]
        resp = self.client.get(self.url("csv"), {"status": "PENDING_MANAGER"})
        text = resp.content.decode("utf-8-sig")
        reader = list(csv.reader(io.StringIO(text)))
        data_rows = [r for r in reader if r and not r[0].startswith("#")][1:]  # skip header
        self.assertEqual(len(rows), len(data_rows))
        self.assertEqual({r["title"] for r in rows}, {r[9] for r in data_rows})

    def test_rows_totals_dashboard_agree(self):
        self.auth_hr()
        params = {"q": "laptop"}
        rows = self.client.get(self.url("rows"), params).json()
        totals = self.client.get(self.url("totals"), params).json()
        dash = self.client.get(self.url("dashboard"), params).json()
        self.assertEqual(rows["meta"]["row_count"], totals["data"]["total"])
        self.assertEqual(dash["data"]["total"], totals["data"]["total"])
        self.assertEqual(
            rows["meta"]["scope"],
            totals["meta"]["scope"],
        )

    def test_out_of_scope_rows_absent_everywhere(self):
        self.auth_manager()
        for kind in ("rows",):
            data = self.client.get(self.url(kind)).json()["data"]
            titles = {r["title"] for r in data}
            self.assertNotIn("Other laptop", titles)
        csv_text = self.client.get(self.url("csv")).content.decode("utf-8-sig")
        self.assertNotIn("Other laptop", csv_text)
        dash = self.client.get(self.url("dashboard")).json()
        self.assertEqual(dash["data"]["counts_by_status"]["PENDING_MANAGER"], 1)

    def test_hr_sees_organization(self):
        self.auth_hr()
        rows = self.client.get(self.url("rows")).json()["data"]
        self.assertEqual(len(rows), 2)
        dash = self.client.get(reverse(f"review:report-dashboard", args=["timesheets"])).json()
        self.assertEqual(dash["meta"]["scope"], "HR_ORGANIZATION")

    def test_manager_active_direct_reports_only(self):
        # Employee2 belongs to other_mgr and must be invisible to manager.
        self.auth_manager()
        data = self.client.get(self.url("rows", "timesheets")).json()["data"]
        self.assertEqual([r["employee_id"] for r in data], [str(self.employee.pk)])

    def test_no_decision_capability_escalation(self):
        self.auth_manager()
        body = self.client.get(self.url("rows")).json()
        self.assertNotIn("permissions", body)
        self.assertNotIn("permissions", body["data"][0])

    def test_unknown_category_404(self):
        self.auth_manager()
        resp = self.client.get(self.url("rows", "audit"))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


class TestMetadataAndDeterminism(ReportBase):
    def url(self, kind, cat="requests"):
        return reverse(f"review:report-{kind}", args=[cat])

    def test_metadata_present_on_json_outputs(self):
        self.auth_manager()
        from timesheets.models import TimezoneConfig

        TimezoneConfig.objects.update_or_create(pk=1, defaults={"name": "Africa/Cairo"})
        params = {"date_from": "2000-01-01", "date_to": "2100-01-01"}
        for kind in ("rows", "totals", "dashboard"):
            meta = self.client.get(self.url(kind), params).json()["meta"]
            self.assertEqual(meta["org_timezone"], "Africa/Cairo")
            self.assertEqual(meta["date_from"], "2000-01-01")
            self.assertEqual(meta["date_to"], "2100-01-01")
            self.assertEqual(meta["scope"], "MANAGER_ACTIVE_DIRECT_REPORTS")
            self.assertEqual(meta["row_limit"], 10000)

    def test_csv_metadata_rows(self):
        self.auth_hr()
        text = self.client.get(self.url("csv")).content.decode("utf-8-sig")
        self.assertIn("# org_timezone,Africa/Cairo", text) if "Africa/Cairo" in text else self.assertIn("# org_timezone,UTC", text)
        self.assertIn("# scope,HR_ORGANIZATION", text)
        self.assertIn("# generated_at_utc,", text)
        self.assertIn("# total_units,counts; minute totals in minutes", text)

    def test_deterministic_rows_order(self):
        # two in-scope requests; ordering must be stable across calls
        e3 = _mk_user("emp3@example.com")
        EmployeeProfile.objects.create(user=e3, manager=self.manager, employee_number="E-003")
        EmployeeRequest.objects.create(
            requester=e3, request_type=self.rtype, title="Buddy laptop",
            status=EmployeeRequest.Status.PENDING_MANAGER, manager_at_submission=self.manager,
        )
        self.auth_manager()
        def titles():
            return [r["title"] for r in self.client.get(self.url("rows")).json()["data"]]
        first = titles()
        self.assertEqual(first, titles())

    def test_csv_deterministic_bytes(self):
        self.auth_manager()
        with mock.patch("django.utils.timezone.now", return_value=django_tz.now()):
            b1 = self.client.get(self.url("csv")).content
            b2 = self.client.get(self.url("csv")).content
        self.assertEqual(b1, b2)

    def test_invalid_filters_422(self):
        self.auth_manager()
        resp = self.client.get(self.url("rows"), {"date_from": "not-a-date"})
        self.assertEqual(resp.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("validation_error", resp.json()["error"]["code"])
        resp2 = self.client.get(self.url("rows", "timesheets"), {"status": "BOGUS"})
        self.assertEqual(resp2.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)


class TestCsvContent(ReportBase):
    def test_utf8_bom_and_arabic(self):
        self.submitted.title = "طلب ح Ages: لمرحلة"
        self.submitted.save(update_fields=["title"])
        self.auth_manager()
        resp = self.client.get(reverse("review:report-csv", args=["requests"]))
        self.assertTrue(resp.content.startswith(b"\xef\xbb\xbf"))
        text = resp.content.decode("utf-8-sig")
        self.assertIn(self.submitted.title, text)

    def test_formula_injection_neutralized(self):
        self.submitted.title = "=SUM(A1); @cmd"
        self.submitted.save(update_fields=["title"])
        self.auth_manager()
        text = self.client.get(reverse("review:report-csv", args=["requests"])).content.decode("utf-8-sig")
        reader = list(csv.reader(io.StringIO(text)))
        data_rows = [r for r in reader if r and not r[0].startswith("#")][1:]
        title_cells = {r[9] for r in data_rows}
        self.assertIn("'=SUM(A1); @cmd", title_cells)

    def test_sanitize_leading_plus_minus_at_pipe_tab(self):
        from review.csv_export import sanitize_cell

        self.assertEqual(sanitize_cell("=x"), "'=x")
        self.assertEqual(sanitize_cell("+x"), "'+x")
        self.assertEqual(sanitize_cell("-x"), "'-x")
        self.assertEqual(sanitize_cell("@x"), "'@x")
        self.assertEqual(sanitize_cell("\tx"), "'\tx")
        self.assertEqual(sanitize_cell("normal"), "normal")
        self.assertEqual(sanitize_cell(None), "")
        self.assertEqual(sanitize_cell("a\x01b"), "ab")

    def test_multiline_and_comma_values_survive(self):
        self.submitted.title = "has, comma\nand newline"
        self.submitted.save(update_fields=["title"])
        self.auth_manager()
        text = self.client.get(reverse("review:report-csv", args=["requests"])).content.decode("utf-8-sig")
        rows = list(csv.reader(io.StringIO(text)))
        joined = "\n".join(",".join(r) for r in rows)
        self.assertIn(self.submitted.title, joined.replace("\r", "\n"))

    def test_csv_content_disposition_download_only(self):
        # No disk-save mock target: download initiation via Content-Disposition.
        self.auth_hr()
        resp = self.client.get(reverse("review:report-csv", args=["requests"]))
        self.assertTrue(resp["Content-Disposition"].startswith("attachment; filename="))
        self.assertIn("text/csv", resp["Content-Type"])
        self.assertIn("charset=utf-8", resp["Content-Type"])


class TestRowLimit(ReportBase):
    def url(self, kind, cat="requests"):
        return reverse(f"review:report-{kind}", args=[cat])

    def test_csv_rejects_over_limit_no_partial(self):
        self.auth_hr()
        with mock.patch("review.reports.MAX_REPORT_ROWS", 1):
            resp = self.client.get(self.url("csv"))
        self.assertEqual(resp.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(resp.json()["error"]["code"], "row_limit_exceeded")
        self.assertNotIn("text/csv", resp["Content-Type"])
        # No audit event was recorded for the rejected export.
        self.assertFalse(AuditEvent.objects.filter(action="REPORT_EXPORT_REQUESTS").exists())

    def test_rows_endpoint_truncates_at_limit(self):
        self.auth_hr()
        with mock.patch("review.reports.MAX_REPORT_ROWS", 1):
            body = self.client.get(self.url("rows")).json()
        self.assertEqual(len(body["data"]), 1)
        self.assertTrue(body["meta"].get("truncated"))

    def test_totals_unaffected_by_limit_mock(self):
        self.auth_hr()
        with mock.patch("review.reports.MAX_REPORT_ROWS", 1):
            data = self.client.get(self.url("totals")).json()
        self.assertEqual(data["data"]["total"], EmployeeRequest.objects.exclude(status=EmployeeRequest.Status.DRAFT).count())


class TestAuthorization(ReportBase):
    def url(self, kind, cat="requests"):
        return reverse(f"review:report-{kind}", args=[cat])

    def test_anonymous_401(self):
        resp = self.client.get(self.url("rows"))
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_employee_403(self):
        self.client.force_authenticate(user=self.plain)
        for kind in ("rows", "totals", "dashboard", "csv"):
            self.assertEqual(self.client.get(self.url(kind)).status_code, status.HTTP_403_FORBIDDEN)

    def test_revoked_manager_403(self):
        self.manager.is_active = False
        self.manager.save(update_fields=["is_active"])
        self.client.force_authenticate(user=self.manager)
        for kind in ("rows", "csv", "dashboard", "totals"):
            self.assertEqual(self.client.get(self.url(kind)).status_code, status.HTTP_403_FORBIDDEN)


class TestRateLimitAndAudit(ReportBase):
    def test_export_rate_limit_429(self):
        self.auth_hr()
        url = reverse("review:report-csv", args=["requests"])
        for i in range(5):
            resp = self.client.get(url)
            self.assertEqual(resp.status_code, status.HTTP_200_OK, f"export {i+1}")
        throttled = self.client.get(url)
        self.assertEqual(throttled.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(throttled.json()["error"]["code"], "throttled")

    def rate(self):
        pass

    def test_success_export_audited_once_per_request(self):
        self.auth_hr()
        before = AuditEvent.objects.filter(action="REPORT_EXPORT_REQUESTS").count()
        resp = self.client.get(reverse("review:report-csv", args=["requests"]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        events = AuditEvent.objects.filter(action="REPORT_EXPORT_REQUESTS")
        self.assertEqual(events.count(), before + 1)
        event = events.order_by("-id").first()
        self.assertEqual(event.actor, self.hr)
        self.assertIn("row_count", event.after)
        self.assertTrue(resp["X-Audit-Event-Id"])

    def test_rejected_export_not_audited_and_no_csv_bytes(self):
        self.client.force_authenticate(user=self.plain)
        resp = self.client.get(reverse("review:report-csv", args=["requests"]))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(AuditEvent.objects.filter(action="REPORT_EXPORT_REQUESTS").exists())

    def test_no_disk_save(self):
        # The view writes bytes into the response only; assert no file write
        # happens by patching open() during the export.
        self.auth_hr()
        with mock.patch("builtins.open", side_effect=AssertionError("disk save attempted")):
            resp = self.client.get(reverse("review:report-csv", args=["timesheets"]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_export_json_outputs_unthrottled(self):
        self.auth_hr()
        url_rows = reverse("review:report-rows", args=["requests"])
        for _ in range(12):
            self.assertEqual(self.client.get(url_rows).status_code, status.HTTP_200_OK)


class TestTimesheetReportValues(ReportBase):
    def test_minutes_units_and_values(self):
        self.auth_manager()
        dash = self.client.get(reverse("review:report-dashboard", args=["timesheets"])).json()
        self.assertEqual(dash["data"]["total_worked_minutes"], 480)
        self.assertEqual(dash["data"]["total_unpaid_break_minutes"], 30)
        resp = self.client.get(reverse("review:report-csv", args=["timesheets"]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
