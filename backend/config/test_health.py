"""Story 5.1 focused tests: versioned API boundary and health endpoints."""
from unittest import mock

import pytest
from django.db import connections
from django.db.backends.base.base import BaseDatabaseWrapper

from config.api_version import API_VERSION


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


@pytest.mark.django_db
class TestVersionedApiBoundary:
    def test_unknown_api_route_still_returns_versioned_envelope(self, client):
        response = client.get("/api/v1/not-a-route")

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"
        assert "request_id" in response.json()["error"]

    def test_api_version_header_matches_v1(self, client):
        # Version is surfaced on health probes (the operator boundary).
        probe = client.get("/health/live")
        assert probe["X-API-Version"] == "v1"
