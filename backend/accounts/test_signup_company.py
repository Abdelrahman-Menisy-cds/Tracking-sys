"""Story H34 tests: one-shot company registration via POST /auth/signup.

The owner's ordering: the company screen (company data, activation code as
its LAST field) comes first, then the founding HR account, and the company is
written ONLY once every field validates — Company + COMPLETE CompanyProfile +
the founding HR user inside ONE transaction, so a rejected or abandoned
signup leaves zero rows. Every test asserts the state change it names (row
counts for the zero-write cases), not just a status code.
"""
import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import AuditEvent, Company, CompanyProfile, SubscriptionCode
from tenants.context import default_company

User = get_user_model()

VALID_CODE = "H34-test-code-1"
BOUND_CODE = "H34-test-code-bound"
GOOD_PASSWORD = "correct-horse-battery-strong"

#: A complete company-screen payload: every required field plus every
#: optional one the /company PATCH view accepts.
COMPLETE_COMPANY = {
    "name": "شركة النيل للتجارة",
    "activity": "تجارة الجملة والتفصيل",
    "address": "١٢ شارع الجمهورية، القاهرة",
    "phone": "+20 100 123 4567",
    "email": "info@nile-trading.example",
    "website": "https://nile-trading.example",
    "commercial_register": "123456",
    "tax_card": "654321",
    "contact_name": "عفاف حسن",
    "contact_role": "المدير الإداري",
    "contact_phone": "01001234567",
}
REQUIRED_FIELDS = ("name", "activity", "address", "phone")


@pytest.fixture
def anon_client():
    """Browser-like client with CSRF enforcement active (matches tests.py)."""
    return APIClient(enforce_csrf_checks=True)


@pytest.fixture(autouse=True)
def _clear_cache():
    """Signup throttles count in the cache keyed by IP; clear around each test
    (same posture as test_signup.py) so scopes never bleed between tests."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def tenantless_code(db):
    """An operator bootstrap code: no company bound — it founds a new one."""
    return SubscriptionCode.objects.create(code=VALID_CODE, label="bootstrap")


@pytest.fixture
def bound_company(db):
    return Company.objects.create(slug="bound-co", name="Bound Co")


@pytest.fixture
def bound_code(db, bound_company):
    return SubscriptionCode.objects.create(code=BOUND_CODE, company=bound_company)


def _signup(client, payload):
    """Prime a fresh CSRF pairing then post (session rotation on signup
    invalidates the old token, so each attempt re-primes like a browser)."""
    client.get("/api/v1/auth/csrf")
    token = client.cookies["heya_fawda_csrftoken"].value
    return client.post(
        "/api/v1/auth/signup",
        payload,
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )


def _payload(
    email="hr@nile-trading.example",
    code=VALID_CODE,
    password=GOOD_PASSWORD,
    company=COMPLETE_COMPANY,
):
    body = {"email": email, "code": code, "password": password}
    if company is not None:
        body["company"] = company
    return body


def _row_counts():
    """The three rows H34 writes — or must not write — counted together.

    Compared RELATIVELY: the H30 §2.6 data migration seeds the ``__default__``
    company before any test runs, so absolute zeros would be wrong.
    """
    return (
        User.objects.count(),
        Company.objects.count(),
        CompanyProfile.objects.count(),
    )


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_company_first_signup_founds_everything_and_skips_onboarding(
    anon_client, tenantless_code
):
    before = _row_counts()
    response = _signup(anon_client, _payload())

    assert response.status_code == 200
    assert response.data["data"]["email"] == "hr@nile-trading.example"
    assert response.data["data"]["role"] == User.Role.HR
    assert response.data["data"]["is_active"] is True
    # The profile arrived complete: the SPA enters the app with no onboarding.
    assert response.data["data"]["needs_company_profile"] is False

    # Company + COMPLETE profile + founding HR, each written exactly once.
    assert _row_counts() == (before[0] + 1, before[1] + 1, before[2] + 1)
    user = User.objects.get(email="hr@nile-trading.example")
    company = user.company
    assert company.name == COMPLETE_COMPANY["name"]
    profile = CompanyProfile.objects.get(company=company)
    assert profile.name == COMPLETE_COMPANY["name"]
    assert profile.activity == COMPLETE_COMPANY["activity"]
    assert profile.address == COMPLETE_COMPANY["address"]
    assert profile.phone == COMPLETE_COMPANY["phone"]
    assert profile.email == COMPLETE_COMPANY["email"]
    assert profile.website == COMPLETE_COMPANY["website"]
    assert profile.commercial_register == COMPLETE_COMPANY["commercial_register"]
    assert profile.tax_card == COMPLETE_COMPANY["tax_card"]
    assert profile.contact_name == COMPLETE_COMPANY["contact_name"]
    assert profile.contact_role == COMPLETE_COMPANY["contact_role"]
    assert profile.contact_phone == COMPLETE_COMPANY["contact_phone"]
    assert profile.updated_by == user

    # The caller is actually signed in, and /auth/me agrees on onboarding.
    me = anon_client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.data["data"]["id"] == user.pk
    assert me.data["data"]["needs_company_profile"] is False

    # Self-signup writes no AuditEvent (documented SignupView posture); the
    # code's use counter is the durable record.
    assert AuditEvent.objects.count() == 0
    tenantless_code.refresh_from_db()
    assert tenantless_code.use_count == 1
    assert tenantless_code.last_used_at is not None


@pytest.mark.django_db
def test_company_screen_name_outranks_the_legacy_company_name_field(
    anon_client, tenantless_code
):
    payload = _payload()
    payload["company"] = dict(COMPLETE_COMPANY, name="الشركة المختارة")
    payload["company_name"] = "الاسم القديم من الحقل القديم"
    response = _signup(anon_client, payload)

    assert response.status_code == 200
    user = User.objects.get(email="hr@nile-trading.example")
    assert user.company.name == "الشركة المختارة"
    assert CompanyProfile.objects.get(company=user.company).name == "الشركة المختارة"


# ---------------------------------------------------------------------------
# Zero-write failures: each invalid field leaves every count unchanged
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("missing_field", REQUIRED_FIELDS)
def test_missing_required_company_field_writes_nothing(
    anon_client, tenantless_code, missing_field
):
    before = _row_counts()
    company = {k: v for k, v in COMPLETE_COMPANY.items() if k != missing_field}
    response = _signup(anon_client, _payload(company=company))

    # The same completeness gate and wording the /company PATCH view answers.
    assert response.status_code == 400
    assert response.data["error"]["code"] == "validation_error"
    assert response.data["error"]["message"] == (
        "The company profile is missing required fields."
    )
    assert response.data["error"]["fields"]["company"] == {
        missing_field: ["This field is required."]
    }
    # Zero new rows — the whole point of the owner's ordering.
    assert _row_counts() == before
    tenantless_code.refresh_from_db()
    assert tenantless_code.use_count == 0
    assert tenantless_code.last_used_at is None


@pytest.mark.django_db
@pytest.mark.parametrize("blank_field", ["name", "phone"])
def test_blank_required_company_field_writes_nothing(
    anon_client, tenantless_code, blank_field
):
    before = _row_counts()
    company = dict(COMPLETE_COMPANY, **{blank_field: ""})
    response = _signup(anon_client, _payload(company=company))

    # The write serializer's own blank-field rule (same as the /company PATCH
    # view): a blank required value is a field error, not a completeness one.
    assert response.status_code == 422
    assert response.data["error"]["code"] == "validation_error"
    assert response.data["error"]["fields"]["company"][blank_field]
    assert _row_counts() == before
    tenantless_code.refresh_from_db()
    assert tenantless_code.use_count == 0


@pytest.mark.django_db
@pytest.mark.parametrize(
    "field,value",
    [
        ("phone", "call me maybe"),  # charset rule (PHONE_VALIDATOR)
        ("website", "not-a-url"),  # URLField rule
        ("email", "not-an-email"),  # EmailField rule
    ],
)
def test_invalid_company_field_format_writes_nothing(
    anon_client, tenantless_code, field, value
):
    before = _row_counts()
    company = dict(COMPLETE_COMPANY, **{field: value})
    response = _signup(anon_client, _payload(company=company))

    # The SAME rules the /company PATCH view enforces, surfaced nested under
    # "company" in the error fields.
    assert response.status_code == 422
    assert response.data["error"]["code"] == "validation_error"
    assert response.data["error"]["fields"]["company"][field]
    assert _row_counts() == before
    tenantless_code.refresh_from_db()
    assert tenantless_code.use_count == 0


@pytest.mark.django_db
def test_null_company_object_is_a_validation_error(anon_client, tenantless_code):
    before = _row_counts()
    payload = _payload()
    payload["company"] = None
    response = _signup(anon_client, payload)

    assert response.status_code == 422
    assert response.data["error"]["code"] == "validation_error"
    assert response.data["error"]["fields"]["company"]
    assert _row_counts() == before


@pytest.mark.django_db
def test_weak_password_with_company_data_writes_nothing(anon_client, tenantless_code):
    before = _row_counts()
    response = _signup(anon_client, _payload(password="123"))

    assert response.status_code == 422
    assert response.data["error"]["code"] == "validation_error"
    assert response.data["error"]["fields"]["password"]
    assert _row_counts() == before
    tenantless_code.refresh_from_db()
    assert tenantless_code.use_count == 0


# ---------------------------------------------------------------------------
# Code semantics stay unchanged and first
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_invalid_code_writes_nothing_even_with_complete_company(
    anon_client, tenantless_code
):
    before = _row_counts()
    response = _signup(anon_client, _payload(code="totally-wrong"))

    # Code first: a bad code outranks every other complaint (H34 keeps the
    # H14 semantics verbatim).
    assert response.status_code == 400
    assert response.data["error"]["code"] == "invalid_code"
    assert response.data["error"]["fields"]["code"] == ["الكود غير صحيح."]
    assert _row_counts() == before
    tenantless_code.refresh_from_db()
    assert tenantless_code.use_count == 0


@pytest.mark.django_db
def test_bound_code_with_company_data_is_refused_and_writes_nothing(
    anon_client, bound_code, bound_company
):
    before = _row_counts()
    response = _signup(anon_client, _payload(code=BOUND_CODE))

    assert response.status_code == 400
    assert response.data["error"]["code"] == "company_data_not_expected"
    assert response.data["error"]["fields"]["company"]
    # Join-vs-found is a contradiction: nothing anywhere.
    assert _row_counts() == before
    # The bound company is untouched — no profile invented for it either.
    assert not CompanyProfile.objects.filter(company=bound_company).exists()
    bound_code.refresh_from_db()
    assert bound_code.use_count == 0


@pytest.mark.django_db
def test_bound_code_without_company_data_still_joins_the_company(
    anon_client, bound_code, bound_company
):
    companies_before = Company.objects.count()
    response = _signup(
        anon_client,
        _payload(email="joiner@bound-co.example", code=BOUND_CODE, company=None),
    )

    assert response.status_code == 200
    user = User.objects.get(email="joiner@bound-co.example")
    assert user.company == bound_company
    # No new company was founded (the __default__ seed + the bound one only).
    assert Company.objects.count() == companies_before
    # The joined company has no profile yet — onboarding still applies
    # (the pre-H34 behaviour for bound codes is unchanged).
    assert response.data["data"]["needs_company_profile"] is True
    bound_code.refresh_from_db()
    assert bound_code.use_count == 1


# ---------------------------------------------------------------------------
# Duplicate email behaviour unchanged
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_duplicate_email_with_company_data_stays_non_enumerating(
    anon_client, tenantless_code
):
    User.objects.create_user(
        company=default_company(),
        email="hr@nile-trading.example",
        password="existing-user-pass-99",
        full_name="Victim",
        role=User.Role.EMPLOYEE,
    )
    before = _row_counts()
    response = _signup(anon_client, _payload())

    assert response.status_code == 200
    # Non-enumerating outcome shape, no user data.
    assert response.data["data"] == {"outcome": "email_in_use"}
    # Nothing was founded and the existing account is untouched.
    assert _row_counts() == before
    existing = User.objects.get(email="hr@nile-trading.example")
    assert existing.role == User.Role.EMPLOYEE
    assert existing.check_password("existing-user-pass-99")
    tenantless_code.refresh_from_db()
    assert tenantless_code.use_count == 0


# ---------------------------------------------------------------------------
# The pre-H34 body keeps working
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_legacy_three_field_body_still_works_and_keeps_onboarding(
    anon_client, tenantless_code
):
    companies_before = Company.objects.count()
    response = _signup(anon_client, _payload(company=None))

    assert response.status_code == 200
    user = User.objects.get(email="hr@nile-trading.example")
    # A tenantless code still founds a company (H30 §2.5) — without a
    # profile, so the pre-H34 onboarding gate still drives the old screens.
    assert Company.objects.count() == companies_before + 1
    assert user.company.name == "nile-trading.example"  # the email-domain default
    assert not CompanyProfile.objects.filter(company=user.company).exists()
    assert response.data["data"]["needs_company_profile"] is True
    tenantless_code.refresh_from_db()
    assert tenantless_code.use_count == 1
