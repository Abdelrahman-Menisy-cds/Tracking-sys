"""H30 §8.1 — the cross-company leak suite (the owner's requirement).

One sentence, from the owner: a company that signs up must never see anything
belonging to another company — inside the app AND inside the assistant.

Every test builds TWO fully separate tenants (their own HR, employee,
department, request type, request and timesheet) and then asserts through a
REAL production entry point — never through a hand-written queryset, which
would prove nothing about what the app actually does.
"""
import pytest

from accounts.models import Company, Department, User, WorkSchedule
from reqs.models import EmployeeRequest, RequestType
from timesheets.models import Timesheet

pytestmark = pytest.mark.django_db


@pytest.fixture
def two_companies():
    """Two tenants, each with an HR, an employee, a department and one row."""
    made = {}
    for key, slug in (("a", "alpha"), ("b", "beta")):
        company = Company.objects.create(slug=slug, name=slug.title())
        made[key] = {
            "company": company,
            "hr": User.objects.create_user(
                email=f"hr@{slug}.test",
                password="pass-12345678",
                role=User.Role.HR,
                company=company,
            ),
            "emp": User.objects.create_user(
                email=f"emp@{slug}.test",
                password="pass-12345678",
                role=User.Role.EMPLOYEE,
                company=company,
            ),
            "dept": Department.objects.create(
                company=company, code=f"D-{slug.upper()}", name_ar=slug
            ),
        }
        rtype = RequestType.objects.create(company=company, name=f"إجازة {slug}")
        made[key]["req"] = EmployeeRequest.objects.create(
            company=company,
            requester=made[key]["emp"],
            request_type=rtype,
            title=f"طلب {slug}",
            status=EmployeeRequest.Status.PENDING_HR,
        )
        made[key]["sheet"] = Timesheet.objects.create(
            company=company,
            employee=made[key]["emp"],
            week_start="2026-01-05",
            status=Timesheet.Status.SUBMITTED,
        )
    return made


def test_hr_request_queue_is_one_company_only(two_companies):
    """HR of A reads A's records and never B's (review/scope.scope_requests)."""
    from review.scope import scope_requests

    rows = scope_requests(two_companies["a"]["hr"])
    assert two_companies["a"]["req"].pk in set(rows.values_list("pk", flat=True))
    assert two_companies["b"]["req"].pk not in set(rows.values_list("pk", flat=True))


def test_hr_timesheet_queue_is_one_company_only(two_companies):
    """HR of A reads A's timesheets and never B's."""
    from review.scope import scope_timesheets

    rows = scope_timesheets(two_companies["a"]["hr"])
    assert two_companies["a"]["sheet"].pk in set(rows.values_list("pk", flat=True))
    assert two_companies["b"]["sheet"].pk not in set(rows.values_list("pk", flat=True))


def test_manager_queue_is_one_company_only(two_companies):
    """A manager's queue is bounded by their company too, not only by reports."""
    from review.scope import scope_requests

    manager = two_companies["a"]["hr"]
    manager.role = User.Role.MANAGER
    manager.save(update_fields=["role"])
    rows = scope_requests(manager)
    assert two_companies["b"]["req"].pk not in set(rows.values_list("pk", flat=True))


def test_hr_people_list_is_one_company_only(two_companies):
    """The HR workforce list (accounts.employee_views._visible_users)."""
    from accounts.employee_views import _visible_users

    rows = _visible_users(two_companies["a"]["company"])
    ids = set(rows.values_list("pk", flat=True))
    assert two_companies["a"]["emp"].pk in ids
    assert two_companies["b"]["emp"].pk not in ids


def test_assistant_departments_are_the_callers_company_only(two_companies):
    """The assistant's department tool must not narrate another tenant's org."""
    from accounts.assistant_tools import read_departments

    result = read_departments(two_companies["a"]["hr"], {})
    assert result["ok"] is True
    codes = {row["code"] for row in result["departments"]}
    assert "D-ALPHA" in codes
    assert "D-BETA" not in codes


def test_assistant_cannot_resolve_a_foreign_employee(two_companies):
    """A foreign id is not found — the assistant answers 404, never a row."""
    from accounts.assistant_views import _get_employee

    assert _get_employee(two_companies["a"]["company"], two_companies["a"]["emp"].pk) is not None
    assert _get_employee(two_companies["a"]["company"], two_companies["b"]["emp"].pk) is None


def test_holidays_register_is_one_company_only(two_companies):
    """GET /api/v1/holidays returns the caller's company register only.

    Every company keeps its own holiday rows (they are per-company since H30),
    so an unscoped read here showed the same day once per tenant.
    """
    from django.test import Client

    from holidays.models import PublicHoliday

    for key in ("a", "b"):
        PublicHoliday.objects.create(
            company=two_companies[key]["company"],
            country_code="EG",
            year=2026,
            date="2026-01-07",
            name=f"holiday-{key}",
        )
    client = Client()
    client.force_login(two_companies["a"]["hr"])
    response = client.get("/api/v1/holidays?year=2026&country=EG")
    assert response.status_code == 200
    names = {row["name"] for row in response.json()["data"]}
    assert "holiday-a" in names
    assert "holiday-b" not in names


def _create_schedule(client, name):
    """POST /work-schedules through the REAL endpoint (never an ORM row)."""
    response = client.post(
        "/api/v1/work-schedules",
        {
            "name": name,
            "effective_from": "2026-11-01",
            "days": [
                {"weekday": wd, "is_working_day": wd < 5,
                 "start_time": "08:00:00" if wd < 5 else None,
                 "end_time": "16:00:00" if wd < 5 else None}
                for wd in range(7)
            ],
        },
        format="json",
    )
    assert response.status_code == 201, response.json()
    return response.json()["data"]


def _schedule_clients(two_companies):
    """Each HR creates one schedule through the API; both clients stay open.

    APIClient (not the plain Django Client): the schedule body is JSON and
    the plain Client multipart-encodes nested lists into unusable strings.
    """
    from rest_framework.test import APIClient

    clients = {}
    schedules = {}
    for key in ("a", "b"):
        client = APIClient()
        client.force_login(two_companies[key]["hr"])
        clients[key] = client
        schedules[key] = _create_schedule(client, f"دوام {key}")
    return clients, schedules


def test_work_schedules_list_is_one_company_only(two_companies):
    """GET /api/v1/work-schedules as HR of A returns A's schedule and never
    B's (Story H39; department_views.py shipped this exact bug class until
    cb74a25 — the schedule list is built scoped from day one)."""
    from rest_framework.test import APIClient

    for key in ("a", "b"):
        client = APIClient()
        client.force_login(two_companies[key]["hr"])
        response = client.post(
            "/api/v1/work-schedules",
            {
                "name": f"دوام {key}",
                "effective_from": "2026-11-01",
                "days": [{"weekday": 0, "is_working_day": False}],
            },
            format="json",
        )
        assert response.status_code == 201, response.json()
    viewer = APIClient()
    viewer.force_login(two_companies["a"]["hr"])
    response = viewer.get("/api/v1/work-schedules")
    assert response.status_code == 200
    names = {row["name"] for row in response.json()["data"]}
    assert "دوام a" in names
    assert "دوام b" not in names


def test_foreign_work_schedule_detail_is_404(two_companies):
    """A schedule id from another company answers the shared 404 envelope."""
    clients, schedules = _schedule_clients(two_companies)
    response = clients["a"].get(f"/api/v1/work-schedules/{schedules['b']['id']}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_foreign_work_schedule_patch_is_404_and_untouched(two_companies):
    """PATCHing another company's schedule is a 404, and the schedule is
    unchanged — a guessed id must neither read nor write across tenants."""
    clients, schedules = _schedule_clients(two_companies)
    response = clients["a"].patch(
        f"/api/v1/work-schedules/{schedules['b']['id']}",
        {"name": "captured", "is_active": True},
        format="json",
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    schedule = WorkSchedule.objects.get(pk=schedules["b"]["id"])
    assert schedule.name == "دوام b"
    assert schedule.is_active is True


def test_foreign_work_schedule_delete_is_404(two_companies):
    """DELETE on another company's schedule neither deactivates it nor
    discloses that it exists."""
    clients, schedules = _schedule_clients(two_companies)
    response = clients["a"].delete(f"/api/v1/work-schedules/{schedules['b']['id']}")
    assert response.status_code == 404
    assert WorkSchedule.objects.get(pk=schedules["b"]["id"]).is_active is True
