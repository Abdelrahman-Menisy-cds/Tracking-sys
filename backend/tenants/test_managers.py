"""H30 Step-1 gate — the TenantManager.of() contract (plan §3.2.2).

``of(user_or_company)`` is documented to accept "either a company instance
or an authenticated user". The company-instance path was BROKEN: a Company
has no ``.company`` attribute, so the ``except AttributeError`` branch fell
into ``current_company(company)``, which found no ``is_authenticated`` and
answered None — ``.of(company)`` silently returned an EMPTY queryset
instead of that company's rows. Fail-closed, but a silent wrong answer.

These tests pin the real contract:
  * ``.of(company)`` returns THAT company's rows (regression — failed on
    the pre-fix code with 0 rows),
  * ``.of(anonymous)`` and ``.of(None)`` return nothing (fail-closed kept),
  * ``.of(user)`` keeps scoping to the user's own company.

No production model carries TenantManager until the enforcement phases
(R4/R5) switch the managers; these tests bind it to ``Department`` through
Django's real manager binding (``add_to_class``) so the exact production
class is exercised, not a stand-in.
"""
import pytest
from django.contrib.auth.models import AnonymousUser

from accounts.models import Company, Department, User
from tenants.context import default_company
from tenants.managers import TenantManager

pytestmark = pytest.mark.django_db


@pytest.fixture(scope="module")
def tenant_objects():
    """TenantManager bound to Department for this module (idempotent)."""
    if not hasattr(Department, "tenant_objects"):
        Department.add_to_class("tenant_objects", TenantManager())
    return Department.tenant_objects


def _department(company, code):
    return Department.objects.create(company=company, code=code, name_ar=code, name_en=code)


@pytest.fixture
def two_companies_with_departments():
    """Company A and B (plus the __default__ anchor), one department each."""
    company_a = Company.objects.create(slug="a-co", name="Company A")
    company_b = Company.objects.create(slug="b-co", name="Company B")
    dept_a = _department(company_a, "DEP-A")
    dept_b = _department(company_b, "DEP-B")
    return company_a, company_b, dept_a, dept_b


@pytest.mark.django_db
def test_of_company_instance_returns_that_companys_rows(tenant_objects, two_companies_with_departments):
    company_a, company_b, dept_a, _dept_b = two_companies_with_departments

    rows = list(tenant_objects.of(company_a))

    assert rows == [dept_a], ".of(company) must return that company's rows, not an empty set"


@pytest.mark.django_db
def test_of_company_instance_excludes_other_companies(tenant_objects, two_companies_with_departments):
    _company_a, company_b, _dept_a, _dept_b = two_companies_with_departments

    assert tenant_objects.of(company_b).count() == 1
    assert not tenant_objects.of(company_b).filter(code="DEP-A").exists()


@pytest.mark.django_db
def test_of_anonymous_user_returns_nothing(tenant_objects, two_companies_with_departments):
    two_companies_with_departments

    assert tenant_objects.of(AnonymousUser()).count() == 0


@pytest.mark.django_db
def test_of_none_returns_nothing(tenant_objects, two_companies_with_departments):
    two_companies_with_departments

    assert tenant_objects.of(None).count() == 0


@pytest.mark.django_db
def test_of_user_scopes_to_the_users_own_company(tenant_objects, two_companies_with_departments):
    company_a, _company_b, dept_a, _dept_b = two_companies_with_departments
    user = User.objects.create_user(
        company=company_a, email="mgr.a@example.com", password="pass-12345678", role=User.Role.HR
    )

    assert [d.pk for d in tenant_objects.of(user)] == [dept_a.pk]


@pytest.mark.django_db
def test_every_tenant_model_carries_a_company_field():
    """H30 §9.2 row 4 — the standing guard against 'the backfill misses a
    table (future model without company)': every model in the plan's §6
    inventory must have a ``company`` field. A new tenant model without one
    fails here, in CI, before it can become the founding-leak class again."""
    from django.apps import apps

    missing = []
    inventory_apps = ("accounts", "reqs", "timesheets", "notifications", "holidays")
    for app_label in inventory_apps:
        for model in apps.get_app_config(app_label).get_models():
            if model.__name__ == "Company":
                continue  # the anchor itself
            if not any(f.name == "company" for f in model._meta.get_fields()):
                missing.append(f"{app_label}.{model.__name__}")
    assert not missing, (
        "tenant models without a company field (H30 §9.2 row 4): " f"{missing}"
    )


def test_of_default_company_returns_only_its_rows(tenant_objects):
    """The __default__ anchor scopes like any company (company_all parity)."""
    user = User.objects.create_user(
        company=default_company(), email="def.co@x.test", password="pass-12345678"
    )
    Department.objects.create(company=default_company(), code="DEF-D", name_ar="افتراضي")

    rows = tenant_objects.of(default_company())

    assert rows.count() == 1 and rows[0].code == "DEF-D" and rows[0].company == user.company


def test_user_email_uniqueness_stays_global():
    """Deliberate non-flip (accounts/0014 docstring): email is the login
    identity (USERNAME_FIELD) — one person, one account, across companies."""
    from django.db import IntegrityError, transaction

    company_b = Company.objects.create(slug="dup-mail", name="DM")
    User.objects.create_user(
        company=default_company(), email="same@x.test", password="pass-12345678"
    )
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            User.objects.create_user(
                company=company_b, email="same@x.test", password="pass-12345678"
            )
