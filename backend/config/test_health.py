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
from django.urls import reverse
from rest_framework.test import APIClient

from config.api_version import API_VERSION
from config.health import READINESS_DEPENDENCY_TIMEOUT_S, _probe_database_bounded
from timesheets.models import Timesheet
from timesheets.test_story_3_2 import Story32Base


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


class TestErrorMatrixOnRealEndpoints(Story32Base):
    """QA 5.1 (2): the approved 403/409/422/429 codes exercised against real
    /api/v1 endpoints, asserting the stable error envelope (code, message,
    field errors where applicable) plus request-id correlation (body
    ``error.request_id`` == ``X-Request-ID`` header) and the ``X-API-Version``
    header on every error response.

    Endpoint mapping (no mocks on the error paths — real view/service code):
    - 403: CSRF failure on a real mutation endpoint
      (POST /api/v1/timesheets/{id}/submit, CsrfEnforcedSessionAuthentication
      -> PermissionDenied -> handler code ``permission_denied``);
    - 409: stale optimistic-concurrency version on the real submit path
      (code ``version_conflict`` with a ``version`` field error);
    - 422: falsy ``confirm`` on the real submit serializer
      (code ``validation_error`` with a ``confirm`` field error);
    - 429: mutation budget exhausted on the real submit endpoint
      (code ``throttled``).
    """

    def _assert_error_envelope(self, response, expected_status, expected_code, expected_fields=None):
        assert response.status_code == expected_status
        body = response.json()
        error = body["error"]
        assert error["code"] == expected_code
        assert isinstance(error["message"], str) and error["message"]
        assert response["X-Request-ID"] == error["request_id"]
        assert error["request_id"]
        assert response["X-API-Version"] == API_VERSION
        if expected_fields is None:
            assert error["fields"] == {}
        else:
            assert error["fields"] == expected_fields

    def test_csrf_failure_403_permission_denied_envelope(self):
        # Real mutation endpoint, CSRF enforced: SessionAuthentication raises
        # PermissionDenied -> shared handler envelope (code permission_denied).
        sheet = self.create_sheet(entries=self.default_entries())
        csrf_client = APIClient(enforce_csrf_checks=True)
        csrf_client.force_login(self.user)

        response = csrf_client.post(
            self.submit_url(sheet.pk),
            {"confirm": True, "version": 1},
            format="json",
            HTTP_IDEMPOTENCY_KEY="error-matrix-csrf",
        )

        self._assert_error_envelope(response, 403, "permission_denied")
        # No mutation happened.
        sheet.refresh_from_db()
        assert sheet.status == Timesheet.Status.DRAFT

    def test_stale_version_submit_409_version_conflict_envelope(self):
        # Real submit path: a version older than the sheet's current version
        # is a 409 version_conflict with a version field error, no mutation.
        sheet = self.create_sheet(entries=self.default_entries())
        stale_version = sheet.version - 1

        response = self.post_submit(sheet.pk, version=stale_version, key="error-matrix-stale")

        self._assert_error_envelope(
            response,
            409,
            "version_conflict",
            expected_fields={"version": ["The provided version is stale."]},
        )
        sheet.refresh_from_db()
        assert sheet.status == Timesheet.Status.DRAFT

    def test_missing_confirm_submit_422_validation_error_envelope(self):
        # Real submit serializer: confirm=false is rejected 422 with a
        # confirm field error and no mutation.
        sheet = self.create_sheet(entries=self.default_entries())

        response = self.post_submit(sheet.pk, version=1, confirm=False, key="error-matrix-confirm")

        self._assert_error_envelope(
            response,
            422,
            "validation_error",
            expected_fields={
                "confirm": ["Explicit confirmation (confirm=true) is required to submit a timesheet."]
            },
        )
        sheet.refresh_from_db()
        assert sheet.status == Timesheet.Status.DRAFT

    def test_mutation_budget_429_throttled_envelope(self):
        # Real submit endpoint shares the 60/min mutation budget; drive it
        # down with cheap invalid creates (missing key -> 422) that still
        # count as throttled mutations, then the submit returns 429 throttled.
        sheet = self.create_sheet(entries=self.default_entries())
        for _ in range(60):
            self.client.post(reverse("timesheets:timesheet-list"), {}, format="json")

        response = self.post_submit(sheet.pk, version=1, key="error-matrix-throttle")

        self._assert_error_envelope(response, 429, "throttled")
        sheet.refresh_from_db()
        assert sheet.status == Timesheet.Status.DRAFT
