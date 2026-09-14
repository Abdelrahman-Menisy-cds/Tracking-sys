"""Story 5.3 focused tests: safe locale/appearance preference persistence.

Maps to Story 5.3 acceptance criteria and AC-10:

- GET /api/v1/auth/me is the authoritative bootstrap source for the saved
  locale/appearance enum before personalized UI renders.
- PATCH persists only validated enum values; only server acknowledgement
  marks a save (200 returns the authoritative snapshot).
- A stale-write guard: a PATCH carrying a known stale appearance value must
  not silently overwrite a newer committed selection (version_conflict,
  409) — the client keeps its retryable preview and re-fetches.
- Account isolation: a preference saved by one account is never served to
  another; sign-out clears the session so /auth/me is 401 and the next
  account's /auth/me reflects only their own saved preference.
- The published OpenAPI schema documents the real /auth/me PATCH contract
  (stale_write guard included) — schema must never drift from the view.
"""
import pytest
from django.urls import resolve

from config.schema import build_schema

from accounts.tests import _csrf, anon_client, active_user  # noqa: F401 — shared fixtures/helpers
from config.schema import build_schema


@pytest.fixture
def other_user(db):
    from django.contrib.auth import get_user_model

    return get_user_model().objects.create_user(
        email="othouser@example.com",
        password="another-good-pass",
        full_name="Other User",
    )


def _login(anon_client, email="sabah@example.com", password="correct-horse-battery"):
    token = _csrf(anon_client)
    response = anon_client.post(
        "/api/v1/auth/login",
        {"email": email, "password": password},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200
    return anon_client.cookies["heya_fawda_csrftoken"].value


def _patch(client, payload):
    token = client.cookies["heya_fawda_csrftoken"].value
    return client.patch(
        "/api/v1/auth/me",
        payload,
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )


# ---------------------------------------------------------------------------
# Bootstrap: /auth/me is the authoritative saved-preference source
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_me_get_serves_saved_locale_and_appearance_for_bootstrap(anon_client, active_user):
    """The saved enum must be readable before any personalized UI renders."""
    active_user.appearance = "dark"
    active_user.preferred_locale = "en"
    active_user.save(update_fields=["appearance", "preferred_locale"])

    token = _login(anon_client)
    assert token

    me = anon_client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.data["data"]["appearance"] == "dark"
    assert me.data["data"]["preferred_locale"] == "en"


@pytest.mark.django_db
def test_me_get_defaults_are_system_and_arabic(anon_client, active_user):
    """system is the mandated default appearance; Arabic the default locale."""
    token = _login(anon_client)
    assert token

    me = anon_client.get("/api/v1/auth/me")
    assert me.data["data"]["appearance"] == "system"
    assert me.data["data"]["preferred_locale"] == "ar"


# ---------------------------------------------------------------------------
# Safe persistence: PATCH with stale-write guard
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_patch_persists_preference_and_returns_server_acknowledgement(anon_client, active_user):
    """Only server acknowledgement (200 + authoritative body) marks saved."""
    token = _login(anon_client)
    assert token

    response = _patch(anon_client, {"appearance": "dark", "preferred_locale": "en"})

    assert response.status_code == 200
    assert response.data["data"]["appearance"] == "dark"
    assert response.data["data"]["preferred_locale"] == "en"
    active_user.refresh_from_db()
    assert active_user.appearance == "dark"
    assert active_user.preferred_locale == "en"


@pytest.mark.django_db
def test_patch_appearance_stale_write_is_rejected_with_version_conflict(anon_client, active_user):
    """A PATCH whose appearance no longer matches the saved value must fail
    with 409 version_conflict and must NOT overwrite the newer selection —
    the failure path preserves the client's retryable preview instead of
    clobbering a newer committed choice."""
    active_user.appearance = "dark"
    active_user.save(update_fields=["appearance"])

    token = _login(anon_client)
    assert token

    response = _patch(anon_client, {"appearance": "light", "expected_appearance": "system"})

    assert response.status_code == 409
    assert response.data["error"]["code"] == "version_conflict"
    assert response.data["error"]["fields"] == {"appearance": ["The saved appearance changed. Reload and retry."]}
    assert response.data["error"]["request_id"] == response["X-Request-ID"]
    active_user.refresh_from_db()
    assert active_user.appearance == "dark"


@pytest.mark.django_db
def test_patch_appearance_matching_expected_succeeds(anon_client, active_user):
    """Same-key-same-value replay semantics: expected_appearance matching the
    saved value commits the new selection normally."""
    active_user.appearance = "light"
    active_user.save(update_fields=["appearance"])

    token = _login(anon_client)
    assert token

    response = _patch(anon_client, {"appearance": "dark", "expected_appearance": "light"})

    assert response.status_code == 200
    assert response.data["data"]["appearance"] == "dark"


@pytest.mark.django_db
def test_patch_without_expected_appearance_keeps_last_write_wins(anon_client, active_user):
    """Clients that do not send the guard get the plain allowlist behavior
    (backwards compatible with the Story 1.x contract)."""
    token = _login(anon_client)
    assert token

    response = _patch(anon_client, {"appearance": "light"})

    assert response.status_code == 200
    assert response.data["data"]["appearance"] == "light"


@pytest.mark.django_db
def test_patch_expected_appearance_must_be_valid_enum(anon_client, active_user):
    token = _login(anon_client)
    assert token

    response = _patch(anon_client, {"appearance": "light", "expected_appearance": "neon"})

    assert response.status_code == 422
    assert response.data["error"]["code"] == "validation_error"
    assert "expected_appearance" in response.data["error"]["fields"]
    active_user.refresh_from_db()
    assert active_user.appearance == "system"


# ---------------------------------------------------------------------------
# Account isolation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_preferences_are_account_scoped_across_sign_out(anon_client, active_user, other_user):
    """A preference saved by one account is never served to another; sign-out
    clears personalized state (401) and the next account sees only its own."""
    token = _login(anon_client)
    assert token
    response = _patch(anon_client, {"appearance": "dark", "preferred_locale": "en"})
    assert response.status_code == 200

    fresh = anon_client.cookies["heya_fawda_csrftoken"].value
    out = anon_client.post("/api/v1/auth/logout", HTTP_X_CSRFTOKEN=fresh)
    assert out.status_code == 204
    assert anon_client.get("/api/v1/auth/me").status_code == 401

    # A different account signs in on the same client (shared device).
    token = _login(anon_client, email="othouser@example.com", password="another-good-pass")
    assert token
    me = anon_client.get("/api/v1/auth/me")
    assert me.status_code == 200
    # The previous account's saved preference must not leak.
    assert me.data["data"]["appearance"] == "system"
    assert me.data["data"]["preferred_locale"] == "ar"
    assert me.data["data"]["email"] == "othouser@example.com"


# ---------------------------------------------------------------------------
# Contract truthfulness: schema documents the real PATCH contract
# ---------------------------------------------------------------------------


def test_schema_documents_preferences_patch_contract():
    schema = build_schema()

    patch = schema["paths"]["/api/v1/auth/me"]["patch"]["responses"]
    assert "200" in patch
    assert "409" in patch, "the stale-write guard must be documented"
    request_schema = schema["components"]["schemas"]["CurrentUserUpdateRequest"]["properties"]
    assert set(request_schema["preferred_locale"]["enum"]) == {"ar", "en"}
    assert set(request_schema["appearance"]["enum"]) == {"system", "light", "dark"}
    assert request_schema["expected_appearance"]["enum"] == ["system", "light", "dark"]
    current_user = schema["components"]["schemas"]["CurrentUser"]["properties"]
    assert {"preferred_locale", "appearance"} <= set(current_user)


def test_schema_auth_me_path_resolves_to_me_view():
    from rest_framework.views import APIView

    match = resolve("/api/v1/auth/me")
    view_cls = getattr(match.func, "view_class", None)
    assert view_cls is not None and issubclass(view_cls, APIView)
    assert {"get", "patch"} <= set(view_cls.http_method_names)
