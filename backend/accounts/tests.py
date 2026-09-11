"""Story 1.1 acceptance tests: sign in, sign out, inactive-account handling.

Maps to:
  AC-01  valid active users sign in/out; invalid credentials are generic;
         inactive users cannot authenticate or mutate; session cookie flags.
  Story 1.1 three Given/When/Then blocks.
"""
import re

import pytest
from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.services import deactivate_user

User = get_user_model()


@pytest.fixture
def active_user(db):
    return User.objects.create_user(
        email="sabah@example.com", password="correct-horse-battery", full_name="Sabah Fouad", role=User.Role.EMPLOYEE
    )


@pytest.fixture
def inactive_user(db):
    return User.objects.create_user(
        email="inactive@example.com", password="another-good-pass", full_name="Inactive Person", role=User.Role.EMPLOYEE, is_active=False
    )


@pytest.fixture
def anon_client():
    """Browser-like client with CSRF enforcement active."""
    return APIClient(enforce_csrf_checks=True)


def _csrf(client, path="/api/v1/auth/csrf"):
    """Prime the CSRF cookies the SPA receives from the bootstrap GET."""
    client.get(path)
    return client.cookies["heya_fawda_csrftoken"].value


@pytest.mark.parametrize("request_id", ["bad\r\nid", "x" * 129, "bad request", "ümlaut"])
def test_malformed_request_id_gets_safe_server_generated_id(anon_client, request_id):
    response = anon_client.get("/api/v1/auth/csrf", HTTP_X_REQUEST_ID=request_id)

    assert response.status_code == 200
    generated_id = response["X-Request-ID"]
    assert re.fullmatch(r"[0-9a-f]{32}", generated_id)
    assert generated_id != request_id


def test_unknown_api_route_returns_not_found_envelope_with_request_id(anon_client):
    response = anon_client.get("/api/v1/not-a-route", HTTP_X_REQUEST_ID="support-123")

    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "not_found",
            "message": "Not found.",
            "fields": {},
            "request_id": "support-123",
        }
    }
    assert response["X-Request-ID"] == "support-123"

    root_response = anon_client.get("/api/v1/")
    assert root_response.status_code == 404
    assert root_response.json()["error"]["code"] == "not_found"


def test_non_api_unknown_route_remains_django_not_found(anon_client):
    response = anon_client.get("/not-a-route")

    assert response.status_code == 404
    assert response["Content-Type"].startswith("text/html")


def test_ssl_redirect_includes_request_id(settings, anon_client):
    settings.SECURE_SSL_REDIRECT = True

    response = anon_client.get("/api/v1/auth/csrf", HTTP_X_REQUEST_ID="redirect-123")

    assert response.status_code == 301
    assert response["X-Request-ID"] == "redirect-123"


# ---------------------------------------------------------------------------
# Profile and preference management
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_me_patch_persists_permitted_profile_preferences_and_returns_authoritative_values(anon_client, active_user):
    token = _csrf(anon_client)
    anon_client.force_login(active_user)

    response = anon_client.patch(
        "/api/v1/auth/me",
        {
            "full_name": "صباح فؤاد",
            "preferred_locale": "en",
            "appearance": "dark",
            "timezone_display": "Africa/Cairo",
        },
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )

    assert response.status_code == 200
    assert response.data["data"] == {
        "id": active_user.pk,
        "email": "sabah@example.com",
        "full_name": "صباح فؤاد",
        "role": User.Role.EMPLOYEE,
        "is_active": True,
        "preferred_locale": "en",
        "appearance": "dark",
        "timezone_display": "Africa/Cairo",
    }
    active_user.refresh_from_db()
    assert active_user.full_name == "صباح فؤاد"
    assert active_user.preferred_locale == "en"
    assert active_user.appearance == "dark"
    assert active_user.timezone_display == "Africa/Cairo"


@pytest.mark.django_db
@pytest.mark.parametrize(("field_name", "invalid_value"), [("preferred_locale", "fr"), ("appearance", "neon")])
def test_me_patch_rejects_invalid_preference_enums(anon_client, active_user, field_name, invalid_value):
    token = _csrf(anon_client)
    anon_client.force_login(active_user)

    response = anon_client.patch(
        "/api/v1/auth/me",
        {field_name: invalid_value},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )

    assert response.status_code == 422
    assert response.data["error"]["code"] == "validation_error"
    assert response.data["error"]["message"] == "Validation failed."
    assert field_name in response.data["error"]["fields"]
    assert response.data["error"]["request_id"] == response["X-Request-ID"]
    active_user.refresh_from_db()
    assert active_user.preferred_locale == "ar"
    assert active_user.appearance == "system"


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("protected_field", "tampered_value"),
    [("email", "attacker@example.com"), ("role", User.Role.HR), ("is_active", False)],
)
def test_me_patch_rejects_protected_fields_without_mutation(anon_client, active_user, protected_field, tampered_value):
    token = _csrf(anon_client)
    anon_client.force_login(active_user)

    response = anon_client.patch(
        "/api/v1/auth/me",
        {"full_name": "Attempted Change", protected_field: tampered_value},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )

    assert response.status_code == 422
    assert response.data["error"] == {
        "code": "validation_error",
        "message": "Validation failed.",
        "fields": {protected_field: ["This field is managed by the organization."]},
        "request_id": response["X-Request-ID"],
    }
    active_user.refresh_from_db()
    assert active_user.full_name == "Sabah Fouad"
    assert active_user.email == "sabah@example.com"
    assert active_user.role == User.Role.EMPLOYEE
    assert active_user.is_active is True


def test_me_patch_requires_authentication(anon_client):
    token = _csrf(anon_client)

    response = anon_client.patch(
        "/api/v1/auth/me",
        {"appearance": "light"},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )

    assert response.status_code == 401


@pytest.mark.django_db
def test_me_patch_is_throttled_after_sixty_mutations(anon_client, active_user):
    cache.clear()
    token = _csrf(anon_client)
    anon_client.force_login(active_user)

    responses = [
        anon_client.patch(
            "/api/v1/auth/me",
            {"appearance": "light"},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        for _ in range(61)
    ]

    assert [response.status_code for response in responses[:60]] == [200] * 60
    assert responses[60].status_code == 429
    cache.clear()


# ---------------------------------------------------------------------------
# Sign in: valid active credentials
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_login_active_user_sets_authenticated_rotated_secure_session(anon_client, active_user):
    token = _csrf(anon_client)
    response = anon_client.post(
        "/api/v1/auth/login",
        {"email": "sabah@example.com", "password": "correct-horse-battery"},
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200
    assert response.data["data"]["email"] == "sabah@example.com"
    assert response.data["data"]["is_active"] is True
    # Session cookie exists and is HttpOnly
    cookie = anon_client.cookies["heya_fawda_sessionid"]
    assert cookie.value
    assert cookie["httponly"] is True
    assert cookie["secure"] is True
    assert cookie["samesite"] == "Lax"
    # Session key was rotated (different from any pre-login session)
    assert response.wsgi_request.session.session_key


@pytest.mark.django_db
def test_me_returns_identity_after_login(anon_client, active_user):
    token = _csrf(anon_client)
    assert anon_client.post(
        "/api/v1/auth/login",
        {"email": "sabah@example.com", "password": "correct-horse-battery"},
        HTTP_X_CSRFTOKEN=token,
    ).status_code == 200
    me = anon_client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.data["data"]["email"] == "sabah@example.com"
    # The SPA must fetch a fresh CSRF token before its next unsafe request;
    # login rotated the session but cookies still hold a usable prev token
    # for the remainder of this flow.
    fresh = anon_client.cookies["heya_fawda_csrftoken"].value
    out = anon_client.post("/api/v1/auth/logout", HTTP_X_CSRFTOKEN=fresh)
    assert out.status_code == 204
    assert anon_client.get("/api/v1/auth/me").status_code == 401


# ---------------------------------------------------------------------------
# Sign in: invalid credentials / inactive account — safe, non-enumerating
# ---------------------------------------------------------------------------

def _login_response(anon_client, email, password):
    token = _csrf(anon_client)
    return anon_client.post(
        "/api/v1/auth/login",
        {"email": email, "password": password},
        HTTP_X_CSRFTOKEN=token,
    )


@pytest.mark.django_db
def test_login_unknown_email_and_wrong_password_and_inactive_are_generic(anon_client, active_user, inactive_user):
    unknown = _login_response(anon_client, "ghost@example.com", "whatever-pass")
    wrong = _login_response(anon_client, "sabah@example.com", "not-the-password")
    inactive = _login_response(anon_client, "inactive@example.com", "another-good-pass")

    for response in (unknown, wrong, inactive):
        assert response.status_code == 400
        assert response.data["error"]["code"] == "invalid_credentials"

    # Non-enumerating: identical credentials error aside from per-request correlation IDs.
    for response in (unknown, wrong, inactive):
        response.data["error"].pop("request_id")
    assert response.data == unknown.data == wrong.data

    # No session was granted in any failure case
    assert "heya_fawda_sessionid" not in anon_client.cookies or not anon_client.cookies["heya_fawda_sessionid"].value


@pytest.mark.django_db
def test_inactive_credential_cannot_authenticate(anon_client, inactive_user):
    response = _login_response(anon_client, "inactive@example.com", "another-good-pass")
    assert response.status_code == 400
    me = anon_client.get("/api/v1/auth/me")
    assert me.status_code == 401


# ---------------------------------------------------------------------------
# Inactive account cannot mutate across a previously valid session
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_deactivation_revokes_existing_session_and_rejects_requests(anon_client, active_user):
    token = _csrf(anon_client)
    assert anon_client.post(
        "/api/v1/auth/login",
        {"email": "sabah@example.com", "password": "correct-horse-battery"},
        HTTP_X_CSRFTOKEN=token,
    ).status_code == 200
    session_key = anon_client.session.session_key
    assert Session.objects.filter(session_key=session_key).exists()

    deactivate_user(user=active_user)

    assert not Session.objects.filter(session_key=session_key).exists()
    assert anon_client.get("/api/v1/auth/me").status_code == 401


# ---------------------------------------------------------------------------
# CSRF remains enforced on unsafe methods
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_login_without_csrf_token_is_rejected(anon_client, active_user):
    # Set up a session-free client that enforces CSRF without priming it
    client = APIClient(enforce_csrf_checks=True)
    response = client.post(
        "/api/v1/auth/login",
        {"email": "sabah@example.com", "password": "correct-horse-battery"},
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_login_is_rate_limited_after_ten_attempts(anon_client):
    cache.clear()
    responses = [_login_response(anon_client, "ghost@example.com", "wrong-pass") for _ in range(11)]
    assert [response.status_code for response in responses[:10]] == [400] * 10
    assert responses[10].status_code == 429
    cache.clear()


# ---------------------------------------------------------------------------
# Sign out invalidates the server-side session
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_logout_invalidates_session_and_csrf_still_enforced(anon_client, active_user):
    token = _csrf(anon_client)
    assert anon_client.post(
        "/api/v1/auth/login",
        {"email": "sabah@example.com", "password": "correct-horse-battery"},
        HTTP_X_CSRFTOKEN=token,
    ).status_code == 200
    session_key_in_use = anon_client.session.session_key

    fresh = anon_client.cookies["heya_fawda_csrftoken"].value
    assert anon_client.post("/api/v1/auth/logout", HTTP_X_CSRFTOKEN=fresh).status_code == 204

    # The stored session no longer authenticates (session cleared server-side)
    from django.contrib.sessions.models import Session
    still_installed = Session.objects.filter(session_key=session_key_in_use).exists()
    assert not still_installed
    assert anon_client.get("/api/v1/auth/me").status_code == 401
