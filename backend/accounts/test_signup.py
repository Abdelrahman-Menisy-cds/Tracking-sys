"""Story H14 tests: subscription-code self-service HR signup.

Every test asserts the state change it names, not just a status code —
remove the behaviour and the test fails.
"""
import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import SubscriptionCode

User = get_user_model()

VALID_CODE = "H14-test-code-1"
GOOD_PASSWORD = "correct-horse-battery-strong"


@pytest.fixture
def anon_client():
    """Browser-like client with CSRF enforcement active (matches tests.py)."""
    return APIClient(enforce_csrf_checks=True)


@pytest.fixture
def _csrf(anon_client):
    """Prime the CSRF cookies the SPA receives from the bootstrap GET."""
    anon_client.get("/api/v1/auth/csrf")
    return anon_client.cookies["heya_fawda_csrftoken"].value


@pytest.fixture
def active_code(db):
    return SubscriptionCode.objects.create(code=VALID_CODE, label="test")


@pytest.fixture
def inactive_code(db):
    return SubscriptionCode.objects.create(code=VALID_CODE, is_active=False)


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


def _signup(client, token, email, code=VALID_CODE, password=GOOD_PASSWORD):
    return client.post(
        "/api/v1/auth/signup",
        {"email": email, "code": code, "password": password},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )


def _fresh_signup(client, email, code=VALID_CODE, password=GOOD_PASSWORD):
    """Prime a fresh CSRF token then sign up (session rotation on signup
    invalidates the old token cookie pairing, so multi-signup tests must
    re-prime per attempt just like a real browser does)."""
    client.get("/api/v1/auth/csrf")
    token = client.cookies["heya_fawda_csrftoken"].value
    return _signup(client, token, email, code=code, password=password)


@pytest.mark.django_db
def test_valid_code_creates_hr_user_and_returns_signed_in_session(anon_client, _csrf, active_code):
    response = _signup(anon_client, _csrf, "new-hr@example.com")
    assert response.status_code == 200
    assert response.data["data"]["email"] == "new-hr@example.com"
    assert response.data["data"]["role"] == User.Role.HR
    assert response.data["data"]["is_active"] is True
    assert response.data["meta"]["csrftoken"]

    user = User.objects.get(email="new-hr@example.com")
    assert user.role == User.Role.HR
    assert user.is_active is True
    assert user.check_password(GOOD_PASSWORD)  # password really is hashed & valid

    # The session must actually be signed in: /auth/me answers as that user.
    me = anon_client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.data["data"]["id"] == user.pk
    assert me.data["data"]["role"] == User.Role.HR

    # The code's use was recorded.
    active_code.refresh_from_db()
    assert active_code.use_count == 1
    assert active_code.last_used_at is not None


@pytest.mark.django_db
def test_reusable_code_admits_a_second_subscriber(anon_client, active_code):
    assert _fresh_signup(anon_client, "hr-one@example.com").status_code == 200
    assert _fresh_signup(anon_client, "hr-two@example.com").status_code == 200
    active_code.refresh_from_db()
    assert active_code.use_count == 2


@pytest.mark.django_db
def test_wrong_code_is_rejected_and_creates_nothing(anon_client, _csrf, active_code):
    response = _signup(anon_client, _csrf, "new-hr@example.com", code="totally-wrong")
    assert response.status_code == 400
    assert response.data["error"]["code"] == "invalid_code"
    assert not User.objects.filter(email="new-hr@example.com").exists()
    active_code.refresh_from_db()
    assert active_code.use_count == 0
    assert active_code.last_used_at is None


@pytest.mark.django_db
def test_inactive_code_is_rejected_and_creates_nothing(anon_client, _csrf, inactive_code):
    response = _signup(anon_client, _csrf, "new-hr@example.com")
    assert response.status_code == 400
    assert response.data["error"]["code"] == "invalid_code"
    # Same shape and message as a wrong code — no distinction the caller could
    # use to enumerate active codes.
    inactive_code.refresh_from_db()
    assert inactive_code.use_count == 0
    assert not User.objects.filter(email="new-hr@example.com").exists()


@pytest.mark.django_db
def test_existing_email_is_not_rerolled_or_leaked(anon_client, _csrf, active_code):
    existing = User.objects.create_user(
        email="victim@example.com",
        password="existing-user-pass-99",
        full_name="Victim",
        role=User.Role.EMPLOYEE,
    )
    response = _signup(anon_client, _csrf, "victim@example.com", password="brand-new-password-1")
    assert response.status_code == 200
    # Non-enumerating outcome shape, no user data.
    assert response.data["data"] == {"outcome": "email_in_use"}
    assert "email" not in response.data["data"]

    existing.refresh_from_db()
    assert existing.role == User.Role.EMPLOYEE  # never re-roled
    assert existing.check_password("existing-user-pass-99")  # password untouched
    assert not anon_client.get("/api/v1/auth/me").status_code == 200  # not signed in


@pytest.mark.django_db
def test_weak_password_is_rejected_with_validator_messages(anon_client, _csrf, active_code):
    response = _signup(anon_client, _csrf, "new-hr@example.com", password="123")
    assert response.status_code == 422
    assert response.data["error"]["code"] == "validation_error"
    assert response.data["error"]["fields"]["password"], response.data
    assert not User.objects.filter(email="new-hr@example.com").exists()
    active_code.refresh_from_db()
    assert active_code.use_count == 0


@pytest.mark.django_db
def test_signup_without_csrf_token_is_rejected(anon_client, active_code):
    client = APIClient(enforce_csrf_checks=True)  # no primed cookies
    response = client.post(
        "/api/v1/auth/signup",
        {"email": "new-hr@example.com", "code": VALID_CODE, "password": GOOD_PASSWORD},
        format="json",
    )
    assert response.status_code == 403
    assert not User.objects.filter(email="new-hr@example.com").exists()


@pytest.mark.django_db
def test_signup_throttle_class_is_wired(anon_client):
    from accounts import views

    view = views.SignupView()
    request = anon_client.get("/api/v1/auth/csrf").wsgi_request
    request.user = None  # anonymous, like real traffic
    throttles = view.get_throttles()
    assert len(throttles) == 1
    assert throttles[0].scope == "signup"
    assert throttles[0].get_cache_key(request, view) is not None
    rate = getattr(throttles[0], "THROTTLE_RATES", {}).get("signup")
    from django.conf import settings
    assert rate == "10/min"
    assert settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["signup"] == "10/min"


@pytest.mark.django_db
def test_signup_is_rate_limited_after_ten_attempts(anon_client, active_code):
    responses = [_fresh_signup(anon_client, f"victim{i}@example.com") for i in range(11)]
    assert [r.status_code for r in responses[:10]] == [200] * 10
    assert responses[10].status_code == 429


# ---------------------------------------------------------------------------
# H15a: validation errors must reach the client in the client's language.
#
# The root cause was missing LocaleMiddleware: LANGUAGE_CODE="en" plus
# USE_I18N=True translated nothing per-request, so Django's own lazy
# validator messages rendered in English regardless of Accept-Language.
# Project-written Arabic messages («الكود غير صحيح.») were unaffected —
# which is exactly why the wrong-code path looked fine while validation
# did not. The middleware activates the request locale from the
# Accept-Language header; LANGUAGE_CODE stays "en" so no header (or an
# unsupported one) defaults to today's English.
# ---------------------------------------------------------------------------


def test_locale_middleware_is_registered_before_common_middleware():
    """The locale cannot activate unless LocaleMiddleware is installed, and
    Django documents that it must sit after SessionMiddleware and before
    CommonMiddleware; pin the order so a refactor cannot silently drop it."""
    from django.conf import settings

    middleware = list(settings.MIDDLEWARE)
    assert "django.middleware.locale.LocaleMiddleware" in middleware
    session_at = middleware.index("django.contrib.sessions.middleware.SessionMiddleware")
    locale_at = middleware.index("django.middleware.locale.LocaleMiddleware")
    common_at = middleware.index("django.middleware.common.CommonMiddleware")
    assert session_at < locale_at < common_at


def test_language_code_default_stays_english():
    """No global Arabic default: without Accept-Language the API keeps its
    English voice (and its current date/number formats)."""
    from django.conf import settings

    assert settings.LANGUAGE_CODE == "en"


ARABIC_CHARS = set("ضصثقفغعهخحجدشسيبلاتنمكطئءؤرلاىةوزظ")


# Project-owned catalog (backend/locale/ar) + django.contrib.auth's shipped ar
# catalog. Pinned exactly: a silent catalog regression (or an upstream change)
# must fail a test, not re-English the owner's signup screen.
ARABIC_TOO_SHORT = "كلمة المرور قصيرة جداً. يجب أن تحتوي على 8 أحرف على الأقل."
ARABIC_TOO_COMMON = "كلمة المرور هذه شائعة جداً."
ARABIC_NUMERIC_ONLY = "كلمة المرور هذه تتكون من أرقام فقط."


def _assert_arabic(text):
    assert any(ch in ARABIC_CHARS for ch in text), f"not Arabic: {text!r}"


@pytest.mark.django_db
def test_weak_password_messages_arrive_in_arabic_when_requested(anon_client, active_code):
    client = anon_client
    client.get("/api/v1/auth/csrf")
    token = client.cookies["heya_fawda_csrftoken"].value
    response = client.post(
        "/api/v1/auth/signup",
        {"email": "new-hr@example.com", "code": VALID_CODE, "password": "123"},
        format="json",
        HTTP_X_CSRFTOKEN=token,
        HTTP_ACCEPT_LANGUAGE="ar",
    )
    assert response.status_code == 422
    password_errors = response.data["error"]["fields"]["password"]
    assert password_errors, response.data
    assert password_errors == [
        ARABIC_TOO_SHORT,
        ARABIC_TOO_COMMON,
        ARABIC_NUMERIC_ONLY,
    ]


@pytest.mark.django_db
def test_malformed_email_message_arrives_in_arabic_when_requested(anon_client, active_code):
    client = anon_client
    client.get("/api/v1/auth/csrf")
    token = client.cookies["heya_fawda_csrftoken"].value
    response = client.post(
        "/api/v1/auth/signup",
        {"email": "not-an-email", "code": VALID_CODE, "password": GOOD_PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=token,
        HTTP_ACCEPT_LANGUAGE="ar",
    )
    assert response.status_code == 422
    email_errors = response.data["error"]["fields"]["email"]
    assert email_errors, response.data
    _assert_arabic(email_errors[0])


def test_too_short_message_comes_from_the_project_locale_catalog(db):
    """Django 5.2 gap (upstream #36378 wontfix): MinimumLengthValidator's ar
    entry is absent from contrib/auth's shipped catalog, so the owner's exact
    case ('123') would render in English even with LocaleMiddleware active.
    backend/locale/ar (LOCALE_PATHS) carries the project's own sentence; assert
    the mechanism directly — the validator output, with the project path wired."""
    import os
    from django.conf import settings
    from django.contrib.auth.password_validation import MinimumLengthValidator
    from django.utils.translation import activate

    assert settings.LOCALE_PATHS == [settings.BASE_DIR / "locale"], (
        "the project catalog must stay on LOCALE_PATHS (it is the override layer)"
    )
    assert (settings.BASE_DIR / "locale/ar/LC_MESSAGES/django.mo").is_file()

    activate("ar")
    try:
        validator = MinimumLengthValidator(8)
        try:
            validator.validate("123")
        except Exception as exc:  # noqa: BLE001 - exact type asserted below
            assert type(exc).__name__ == "ValidationError", type(exc)
            assert getattr(exc, "messages", None) == [ARABIC_TOO_SHORT], exc.messages
        activate("en")
        try:
            validator.validate("123")
        except Exception as exc:  # noqa: BLE001
            assert getattr(exc, "messages", None) == [
                "This password is too short. It must contain at least 8 characters."
            ], exc.messages
    finally:
        activate(settings.LANGUAGE_CODE)


@pytest.mark.django_db
def test_validation_messages_stay_english_without_accept_language(anon_client, _csrf, active_code):
    """No header -> today's behaviour; the default cannot drift to Arabic."""
    response = anon_client.post(
        "/api/v1/auth/signup",
        {"email": "new-hr@example.com", "code": VALID_CODE, "password": "123"},
        format="json",
        HTTP_X_CSRFTOKEN=_csrf,
    )
    assert response.status_code == 422
    password_errors = response.data["error"]["fields"]["password"]
    assert password_errors, response.data
    assert all(message.startswith("This password") for message in password_errors)


@pytest.mark.django_db
def test_validation_messages_stay_english_for_unsupported_language(anon_client, _csrf, active_code):
    """A language Django cannot translate to falls back to LANGUAGE_CODE."""
    response = anon_client.post(
        "/api/v1/auth/signup",
        {"email": "new-hr@example.com", "code": VALID_CODE, "password": "123"},
        format="json",
        HTTP_X_CSRFTOKEN=_csrf,
        HTTP_ACCEPT_LANGUAGE="zz",
    )
    assert response.status_code == 422
    password_errors = response.data["error"]["fields"]["password"]
    assert password_errors, response.data
    assert all(message.startswith("This password") for message in password_errors)


@pytest.mark.django_db
def test_wrong_code_message_is_arabic_regardless_of_locale(anon_client, active_code):
    """The project-written message was always Arabic; no locale may undo it
    (en and no-header callers keep seeing today's wording unchanged)."""
    for headers in ({}, {"HTTP_ACCEPT_LANGUAGE": "en"}, {"HTTP_ACCEPT_LANGUAGE": "ar"}):
        client_call = anon_client.get(
            "/api/v1/auth/csrf",
        )
        assert client_call.status_code == 200, headers
        token = anon_client.cookies["heya_fawda_csrftoken"].value
        response = anon_client.post(
            "/api/v1/auth/signup",
            {"email": "new-hr@example.com", "code": "not-the-code", "password": GOOD_PASSWORD},
            format="json",
            HTTP_X_CSRFTOKEN=token,
            **headers,
        )
        assert response.status_code == 400, headers
        assert response.data["error"]["code"] == "invalid_code", headers
        assert response.data["error"]["fields"]["code"] == ["الكود غير صحيح."], headers
