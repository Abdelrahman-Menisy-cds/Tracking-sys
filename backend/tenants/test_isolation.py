"""H30 §8.1 — the cross-company leak suite (the owner's requirement).

One sentence, from the owner: a company that signs up must never see anything
belonging to another company — inside the app AND inside the assistant.

Every test builds TWO fully separate tenants (their own HR, employee,
department, request type, request and timesheet) and then asserts through a
REAL production entry point — never through a hand-written queryset, which
would prove nothing about what the app actually does.
"""
import pytest

from accounts.models import Company, Department, User
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
