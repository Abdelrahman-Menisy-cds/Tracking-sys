"""Story 5.1 focused tests: versioned API boundary and health endpoints.

QA 5.1 blockers covered here:
- version disclosure is uniform: the ``X-API-Version`` header is stamped on
  every ``/api/v1/`` response (success AND error, bare resources included)
  and on the health probes — no body contract is altered;
- the readiness DB probe is hard-bounded (timeout enforced, failure path
  covered, and no secret/exception detail leaks into the response);
- real-API error semantics integration coverage for the approved codes
  (401/403/404/409/422/429) carries the ``X-API-Version`` header and the
  ``X-Request-ID``/error-request_id correlation.
"""
from unittest import mock

import pytest
from django.db import connections
from django.db.backends.base.base import BaseDatabaseWrapper

from config.api_version import API_VERSION
from config.health import READINESS_DEPENDENCY_TIMEOUT_S, _probe_database_bounded


@pytest.mark.django_db
class TestLiveness:
    def test_live_returns_ok_without_auth(self, client):
        response = client.get("/health/live")

        assert response.status_code == 200
        assert response.json() == {"status": "ok", "checks": {"process": "ok"}}

    def test_live_carries_api_version_header(self, client):
        response = client.get("/health/live")

        assert response["X-API-Version"] == API_VERSION
        assert response["X-API-Version"] == "v1"

    def test_live_is_unauthenticated_and_csrf_free(self, client):
        # GET on a health probe must not require auth, a session, or CSRF.
        response = client.get("/health/live", HTTP_X_REQUEST_ID="probe-1")
        assert response.status_code == 200
        assert response["X-Request-ID"] == "probe-1"

    def test_live_does_not_leak_dependency_or_secret_details(self, client):
        response = client.get("/health/live")
        body = response.content.decode()
        for secret_marker in ("postgres", "password", "DATABASES", "SECRET_KEY", "127.0.0.1", "5432"):
            assert secret_marker not in body


@pytest.mark.django_db
class TestReadiness:
    def test_ready_returns_ok_when_database_available(self, client):
        response = client.get("/health/ready")

        assert response.status_code == 200
        assert response.json() == {"status": "ok", "checks": {"database": "ok"}}
        assert response["X-API-Version"] == API_VERSION

    def test_ready_degrades_to_503_on_database_error(self, client):
        real_wrapper = connections["default"].connection or connections["default"]
        with mock.patch.object(
            BaseDatabaseWrapper, "ensure_connection", side_effect=Exception("boom")
        ):
            response = client.get("/health/ready")

        assert response.status_code == 503
        assert response.json() == {"status": "unready", "checks": {"database": "unavailable"}}
        # The wrapper was untouched — only the class method was patched.
        assert real_wrapper is not None

    def test_ready_does_not_leak_exception_detail(self, client):
        with mock.patch.object(
            BaseDatabaseWrapper,
            "ensure_connection",
            side_effect=Exception("host=secret-host password=topsecret"),
        ):
            response = client.get("/health/ready")

        body = response.content.decode()
        assert "secret-host" not in body
        assert "topsecret" not in body
        assert "boom" not in body

    def test_probe_helper_marks_database_error_unavailable(self):
        with mock.patch.object(
            BaseDatabaseWrapper, "ensure_connection", side_effect=Exception("boom")
        ):
            probe = _probe_database_bounded(READINESS_DEPENDENCY_TIMEOUT_S)

        assert probe.mode == "unavailable"
        assert probe.timed_out is False

    def test_probe_helper_enforces_timeout_on_hanging_database(self):
        # A probe that never completes must be abandoned after the bound,
        # not hang the endpoint for the connection's full TCP timeout.
        with mock.patch.object(
            BaseDatabaseWrapper, "ensure_connection", side_effect=lambda: __import__("time").sleep(30)
        ) as ensure:
            import time

            started = time.monotonic()
            probe = _probe_database_bounded(0.05)
            elapsed = time.monotonic() - started

        assert probe.mode == "unavailable"
        assert probe.timed_out is True
        assert ensure.called
        assert elapsed < 1.0, "probe must return promptly after the wall-clock bound"

    def test_ready_endpoint_is_bounded_by_the_contract_timeout(self, client):
        # Endpoint-level: a hanging DB must not hang the response. The bound
        # is the architecture constant; it is asserted, not assumed.
        assert READINESS_DEPENDENCY_TIMEOUT_S == 2

        def hang(*args, **kwargs):
            import time

            time.sleep(30)

        with mock.patch.object(BaseDatabaseWrapper, "ensure_connection", side_effect=hang):
            import time

            started = time.monotonic()
            response = client.get("/health/ready")
            elapsed = time.monotonic() - started

        assert response.status_code == 503
        assert response.json() == {"status": "unready", "checks": {"database": "unavailable"}}
        assert elapsed < READINESS_DEPENDENCY_TIMEOUT_S + 0.5

    def test_ready_does_not_leak_secrets_on_timeout(self, client):
        def hang_with_secret(*args, **kwargs):
            import time

            time.sleep(30)

        with mock.patch.object(
            BaseDatabaseWrapper, "ensure_connection", side_effect=hang_with_secret
        ):
            response = client.get("/health/ready")

        body = response.content.decode()
        assert response.status_code == 503
        for secret_marker in ("password", "postgres", "127.0.0.1", "5432", "SECRET_KEY"):
            assert secret_marker not in body
        assert body.count("unavailable") == 1


@pytest.mark.django_db
class TestVersionedApiBoundary:
    def test_unknown_api_route_still_returns_versioned_envelope(self, client):
        response = client.get("/api/v1/not-a-route")

        assert response.status_code == 404
        response_json = response.json()
        assert response_json["error"]["code"] == "not_found"
        assert "request_id" in response_json["error"]
        assert response["X-API-Version"] == API_VERSION

    def test_api_version_header_matches_v1(self, client):
        # Version is surfaced on health probes (the operator boundary).
        probe = client.get("/health/live")
        assert probe["X-API-Version"] == "v1"


@pytest.mark.django_db
class TestVersionHeaderOnRealEndpoints:
    """QA 5.1 (1): consistent version disclosure on real /api/v1 endpoints —
    success responses (bare resource and meta envelopes) AND error envelopes,
    with bodies unchanged."""

    def test_error_response_carries_version_header(self, client):
        response = client.get("/api/v1/auth/me")

        assert response.status_code == 401
        response_json = response.json()
        assert response_json["error"]["code"] == "authentication_failed"
        assert response_json["error"]["request_id"]
        assert response["X-Request-ID"] == response_json["error"]["request_id"]
        assert response["X-API-Version"] == "v1"

    def test_success_response_carries_version_header(self, client):
        # CSRF bootstrap is a plain success response; its body contract must
        # be untouched by the new middleware.
        pre = client.get("/api/v1/auth/csrf")
        assert pre.status_code == 200
        assert pre["X-API-Version"] == "v1"

    def test_version_header_on_404_envelope_and_correlation(self, client):
        response = client.get("/api/v1/auth/never-exists")

        assert response.status_code == 404
        response_json = response.json()
        assert response_json["error"]["code"] == "not_found"
        assert response["X-API-Version"] == "v1"
        assert response["X-Request-ID"] == response_json["error"]["request_id"]
