"""Story H17 tests: the organization company profile (model + API).

Every test asserts the state change it names — remove the behaviour and the
test fails. The singleton contract (one forced row) and the merged-set
required-field gate are the two load-bearing decisions under test.

The anon_client fixture is imported from accounts/tests.py (project
convention). After a sign-in the session rotates, so every unsafe call
re-reads the CURRENT csrf cookie (the test_preferences.py precedent) —
plain client.patch without the token gets the 403 CSRF envelope.
"""
import pytest
from django.contrib.auth import get_user_model

from accounts.models import AuditEvent, Company, CompanyProfile
from accounts.tests import _csrf, anon_client  # noqa: F401 — shared pytest fixture
from django.core.cache import cache
from tenants.context import default_company

User = get_user_model()

BASE = "/api/v1/company"
PASSWORD = "correct-horse-battery-strong"


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    """Login/signup throttles count in the cache keyed by IP; tests.py clears
    it around its own rate-limit tests, test_signup.py does it autouse —
    same posture here so the 10/min login scope can never bleed between."""
    cache.clear()
    yield
    cache.clear()

REQUIRED_FIELDS = {
    "name": "شركة النور",
    "activity": "تجارة",
    "address": "القاهرة",
    "phone": "+20 100 123 4567",
}
OPTIONAL_FIELDS = {
    "email": "info@alnour.example",
    "website": "https://alnour.example",
    "logo_data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
    "commercial_register": "123456",
    "tax_card": "987-654",
    "contact_name": "منسى عبد الرحمن",
    "contact_role": "HR",
    "contact_phone": "01001234567",
}


def _login_as(client, role):
    """Sign a fresh role-typed user in through the real session flow."""
    email = f"{role.lower()}-company@example.com"
    User.objects.create_user(company=default_company(), email=email, password=PASSWORD, role=role)
    token = _csrf(client)
    response = client.post(
        "/api/v1/auth/login",
        {"email": email, "password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200, response.data
    return client


def _patch(client, payload, **extra):
    """PATCH with the current csrf cookie token (session rotated at login)."""
    token = client.cookies["heya_fawda_csrftoken"].value
    return client.patch(BASE, payload, format="json", HTTP_X_CSRFTOKEN=token, **extra)


@pytest.fixture
def hr_client(anon_client):
    return _login_as(anon_client, User.Role.HR)


@pytest.fixture
def employee_client(anon_client):
    return _login_as(anon_client, User.Role.EMPLOYEE)


@pytest.fixture
def manager_client(anon_client):
    return _login_as(anon_client, User.Role.MANAGER)


# ---------------------------------------------------------------------------
# GET with no row stored
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_get_with_no_row_reports_null_profile_and_needs_profile(hr_client):
    response = hr_client.get(BASE)

    assert response.status_code == 200
    assert response.data["data"]["profile"] is None
    assert response.data["data"]["needs_profile"] is True


@pytest.mark.django_db
def test_get_is_denied_to_anonymous_without_profile_disclosure(anon_client):
    response = anon_client.get(BASE)

    assert response.status_code == 401


# ---------------------------------------------------------------------------
# PATCH: completeness gate before anything is stored
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_patch_missing_required_field_is_400_and_stores_nothing(hr_client):
    response = _patch(hr_client, {"name": "شركة نصف مكتملة", "activity": "تجارة"})

    assert response.status_code == 400
    assert response.data["error"]["code"] == "validation_error"
    assert set(response.data["error"]["fields"]) == {"address", "phone"}
    assert response.data["error"]["request_id"] == response["X-Request-ID"]
    assert CompanyProfile.objects.count() == 0


@pytest.mark.django_db
def test_patch_blank_required_field_over_existing_row_is_400(hr_client):
    # Completeness must hold on the merged result, over a previously valid row.
    assert _patch(hr_client, dict(REQUIRED_FIELDS)).status_code == 200

    response = _patch(hr_client, {"phone": ""})

    assert response.status_code == 400
    assert set(response.data["error"]["fields"]) == {"phone"}
    profile = CompanyProfile.objects.get()
    assert profile.address == REQUIRED_FIELDS["address"]  # untouched


# ---------------------------------------------------------------------------
# PATCH: required-only round trip + the /auth/me gate flips
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_patch_required_only_completes_profile_and_flips_both_gates(hr_client):
    me_before = hr_client.get("/api/v1/auth/me")
    assert me_before.data["data"]["needs_company_profile"] is True

    response = _patch(hr_client, dict(REQUIRED_FIELDS))

    assert response.status_code == 200
    profile = response.data["data"]["profile"]
    assert profile["name"] == REQUIRED_FIELDS["name"]
    assert profile["activity"] == REQUIRED_FIELDS["activity"]
    assert profile["address"] == REQUIRED_FIELDS["address"]
    assert profile["phone"] == REQUIRED_FIELDS["phone"]
    assert response.data["data"]["needs_profile"] is False

    stored = CompanyProfile.objects.get()
    assert stored.updated_by.role == User.Role.HR

    me = hr_client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.data["data"]["needs_company_profile"] is False

    follow_up = hr_client.get(BASE)
    assert follow_up.data["data"]["needs_profile"] is False


# ---------------------------------------------------------------------------
# PATCH: every optional field round-trips
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_patch_every_optional_field_round_trips(hr_client):
    assert _patch(hr_client, dict(REQUIRED_FIELDS)).status_code == 200

    response = _patch(hr_client, dict(OPTIONAL_FIELDS))

    assert response.status_code == 200
    profile = response.data["data"]["profile"]
    for field, value in OPTIONAL_FIELDS.items():
        assert profile[field] == value, field

    stored = CompanyProfile.objects.get()
    for field, value in OPTIONAL_FIELDS.items():
        assert getattr(stored, field) == value, field


# ---------------------------------------------------------------------------
# Role enforcement: employee / manager get the standard 403 envelope
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_patch_as_employee_is_403(employee_client):
    response = _patch(employee_client, dict(REQUIRED_FIELDS))

    assert response.status_code == 403
    assert response.data["error"]["code"] == "permission_denied"
    assert CompanyProfile.objects.count() == 0


@pytest.mark.django_db
def test_patch_as_manager_is_403(manager_client):
    response = _patch(manager_client, dict(REQUIRED_FIELDS))

    assert response.status_code == 403
    assert response.data["error"]["code"] == "permission_denied"


@pytest.mark.django_db
def test_get_as_employee_is_403(employee_client):
    response = employee_client.get(BASE)

    assert response.status_code == 403
    assert response.data["error"]["code"] == "permission_denied"


# ---------------------------------------------------------------------------
# Logo validation: envelope + cap (server is the authority)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_logo_must_be_a_data_image_url(hr_client):
    assert _patch(hr_client, dict(REQUIRED_FIELDS)).status_code == 200

    response = _patch(hr_client, {"logo_data_url": "https://example.com/logo.png"})

    assert response.status_code == 400
    assert "logo_data_url" in response.data["error"]["fields"]
    assert not CompanyProfile.objects.get().logo_data_url


@pytest.mark.django_db
def test_logo_over_the_cap_is_rejected(hr_client):
    assert _patch(hr_client, dict(REQUIRED_FIELDS)).status_code == 200

    oversized = "data:image/png;base64," + "A" * 200_000
    response = _patch(hr_client, {"logo_data_url": oversized})

    assert response.status_code == 400
    assert "logo_data_url" in response.data["error"]["fields"]


# ---------------------------------------------------------------------------
# Singleton: two saves, exactly one row
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_two_saves_leave_exactly_one_row(hr_client):
    assert _patch(hr_client, dict(REQUIRED_FIELDS)).status_code == 200
    assert _patch(hr_client, {"phone": "01001234567"}).status_code == 200

    assert CompanyProfile.objects.count() == 1
    assert CompanyProfile.objects.get().phone == "01001234567"


# ---------------------------------------------------------------------------
# Audit trail
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_successful_update_writes_an_audit_event(anon_client, hr_client):
    request_id = anon_client.get("/api/v1/auth/csrf")["X-Request-ID"]

    response = _patch(hr_client, dict(REQUIRED_FIELDS), HTTP_X_REQUEST_ID=request_id)
    assert response.status_code == 200

    event = AuditEvent.objects.get(action="company_profile.updated")
    assert event.actor.role == User.Role.HR
    assert event.after["name"] == REQUIRED_FIELDS["name"]
    assert event.before.get("name") in (None, "")


@pytest.mark.django_db
def test_rejected_update_writes_no_audit_event(hr_client):
    assert _patch(hr_client, {"name": "غير مكتمل"}).status_code == 400  # incomplete

    assert not AuditEvent.objects.filter(action="company_profile.updated").exists()


# ---------------------------------------------------------------------------
# H30 R1 (§2.4 / §8.1): per-company reads replace the pk=1 singleton
# ---------------------------------------------------------------------------


def _company_with_hr(slug, name):
    """A company plus its founding HR (the §2.2 one-user-one-company shape)."""
    company = Company.objects.create(slug=slug, name=name)
    hr = User.objects.create_user(
        email=f"{slug}-hr@example.com", password=PASSWORD, role=User.Role.HR, company=company
    )
    return company, hr


def _login_user(client, email):
    """Sign an existing user in through the real session flow."""
    token = _csrf(client)
    response = client.post(
        "/api/v1/auth/login",
        {"email": email, "password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200, response.data
    return client


@pytest.mark.django_db
def test_profiles_are_scoped_per_company(anon_client):
    """Two companies hold two independent profiles; each HR reads and writes
    only their own company's row (the pk=1 read is gone)."""
    company_a, hr_a = _company_with_hr("a-co", "شركة أ")
    company_b, hr_b = _company_with_hr("b-co", "شركة ب")

    client_a = _login_user(anon_client, hr_a.email)
    assert _patch(client_a, dict(REQUIRED_FIELDS, name="شركة أ")).status_code == 200
    client_b = _login_user(anon_client, hr_b.email)
    assert _patch(client_b, dict(REQUIRED_FIELDS, name="شركة ب")).status_code == 200

    assert CompanyProfile.objects.count() == 2
    assert CompanyProfile.objects.get(company=company_a).name == "شركة أ"
    assert CompanyProfile.objects.get(company=company_b).name == "شركة ب"

    response = _login_user(anon_client, hr_a.email).get(BASE)
    assert response.data["data"]["profile"]["name"] == "شركة أ"
    response = _login_user(anon_client, hr_b.email).get(BASE)
    assert response.data["data"]["profile"]["name"] == "شركة ب"


@pytest.mark.django_db
def test_needs_company_profile_gate_is_per_company(anon_client):
    """The /auth/me onboarding gate is the caller's company's gate: completing
    A's profile must not flip B's."""
    company_a, hr_a = _company_with_hr("a-co", "شركة أ")
    _company_with_hr("b-co", "شركة ب")

    client_a = _login_user(anon_client, hr_a.email)
    assert client_a.get("/api/v1/auth/me").data["data"]["needs_company_profile"] is True
    assert _patch(client_a, dict(REQUIRED_FIELDS)).status_code == 200
    assert client_a.get("/api/v1/auth/me").data["data"]["needs_company_profile"] is False

    client_b = _login_user(anon_client, f"b-co-hr@example.com")
    assert client_b.get("/api/v1/auth/me").data["data"]["needs_company_profile"] is True


@pytest.mark.django_db
def test_timezone_config_reads_are_per_company():
    """organization_timezone resolves the CALLER's company's row (defaulting
    UTC when absent), not a global singleton (H30 §2.4 / §8.1)."""
    from review.reports import organization_timezone
    from timesheets.models import TimezoneConfig

    company_a, hr_a = _company_with_hr("a-co", "شركة أ")
    company_b, hr_b = _company_with_hr("b-co", "شركة ب")

    assert organization_timezone(hr_a) == "UTC"  # absent -> seeded default
    TimezoneConfig.objects.update_or_create(company=company_a, defaults={"name": "Africa/Cairo"})
    assert organization_timezone(hr_a) == "Africa/Cairo"
    # B is untouched by A's config — and creating B's own default UTC row no
    # longer collides with the seeded __default__ "UTC" row (name uniqueness
    # flipped with the singleton).
    assert organization_timezone(hr_b) == "UTC"
    assert TimezoneConfig.objects.filter(company=company_b, name="UTC").exists()
