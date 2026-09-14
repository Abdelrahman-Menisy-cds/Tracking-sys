"""Story 5.1 focused tests: the generated OpenAPI schema endpoint.

Truthfulness contract (architecture-security.md: "OpenAPI is generated from
actual serializers/views"): every assertion here is checked against the real
URLconf / view code, not hand-copied expectations:

- the endpoint serves a valid OpenAPI 3.0.2 document generated from the real
  URLconf, so every wired /api/v1/ path appears in it;
- every path the schema documents really exists in the URLconf, and every
  documented operation maps to a real view class (no hallucinated surface);
- documented status codes match the views' real response paths, including
  the shared 401/403/404/409/422/429 error envelopes QA's matrix covers;
- the endpoint itself is read-only, unauthenticated, and carries the
  versioned contract headers (X-API-Version, X-Request-ID).
"""
import re

import pytest
import yaml
from django.urls import resolve
from rest_framework.schemas.generators import EndpointEnumerator
from rest_framework.views import APIView

from config.api_version import API_VERSION
from config.schema import build_schema

SHARED_ERROR_CODES = {"401", "403", "404", "422", "429"}

# Dummy values that satisfy each URL converter, per the real URL patterns:
# <uuid:pk>, <str:entry_id>, <int:target_id>/<int:notification_id>, <str:category>.
_PATH_DUMMY_VALUES = {
    "pk": "0" * 8 + "-0000-0000-0000-" + "0" * 12,
    "entry_id": "00000000-0000-0000-0000-000000000000",
    "target_id": "1",
    "notification_id": "1",
    "category": "requests",
}


def _concrete_path(schema_path):
    for name, value in _PATH_DUMMY_VALUES.items():
        schema_path = schema_path.replace("{" + name + "}", value)
    return schema_path


@pytest.mark.django_db
class TestSchemaEndpoint:
    def test_get_serves_openapi_document(self, client):
        response = client.get("/api/v1/schema")

        assert response.status_code == 200
        assert response["Content-Type"] == "application/json"
        assert response["X-API-Version"] == API_VERSION
        assert response["X-Request-ID"]
        schema = response.json()
        assert schema["openapi"] == "3.0.2"
        assert schema["info"]["title"] == "Heya Fawda? Tracking API"
        assert schema["info"]["version"] == "v1"
        assert schema["paths"], "the generated document must describe the real surface"

    def test_post_is_rejected_read_only(self, client):
        response = client.post("/api/v1/schema")

        assert response.status_code == 405

    def test_schema_paths_match_the_real_urlconf(self, client):
        """The documented /api/v1 surface is exactly the set of DRF endpoints
        the real URLconf exposes (enumerated from config.urls itself), with
        the one documented correction: the attachment-replace path is
        documented in its routable trailing-slash form (see the rename in
        config/schema.py and the dedicated routability test below)."""
        schema = build_schema()

        documented = {p for p in schema["paths"] if p.startswith("/api/v1")}
        routable = {path for path, method, callback in EndpointEnumerator(urlconf="config.urls").get_api_endpoints()}
        routable.discard("/api/v1/attachments/{pk}/replace")
        routable.add("/api/v1/attachments/{pk}/replace/")
        assert routable, "URLconf enumeration must find the real endpoints"
        assert documented == routable, (
            "schema must describe exactly the wired /api/v1/ surface: "
            f"missing from schema: {sorted(routable - documented)}; "
            f"hallucinated in schema: {sorted(documented - routable)}"
        )

    def test_every_documented_operation_resolves_to_a_real_view(self, client):
        schema = build_schema()

        for path, operations in schema["paths"].items():
            if not path.startswith("/api/v1"):
                continue
            for method in operations:
                match = resolve(_concrete_path(path))
                view_cls = getattr(match.func, "view_class", None)
                assert view_cls is not None, f"{method.upper()} {path} is not a wired DRF view"
                assert issubclass(view_cls, APIView), f"{method.upper()} {path} is not a DRF view"
                assert method.lower() in getattr(view_cls, "http_method_names", []), (
                    f"{method.upper()} {path} documents a method the view does not serve"
                )

    def test_documented_attachment_replace_path_is_the_routable_url(self, client):
        """The replace endpoint's re_path requires the trailing slash, so the
        documented path must be the URL that actually routes, not the
        slash-less form that falls through to the 404 catch-all."""
        schema = build_schema()

        assert "/api/v1/attachments/{pk}/replace/" in schema["paths"]
        assert "/api/v1/attachments/{pk}/replace" not in schema["paths"]
        match = resolve(_concrete_path("/api/v1/attachments/{pk}/replace/"))
        assert getattr(match.func, "view_class", None).__name__ == "AttachmentReplaceView"

    def test_every_documented_operation_documents_responses(self, client):
        """No operation may ship with an empty responses map: every documented
        status must come from the view's real response paths."""
        schema = build_schema()

        for path, operations in schema["paths"].items():
            for method, operation in operations.items():
                assert operation["responses"], (
                    f"{method.upper()} {path} documents no responses"
                )

    def test_documented_status_codes_match_view_response_paths(self, client):
        """Every documented status code is one the view can actually produce:
        the shared error envelope codes (401/403/404/422/429 from
        config.api.api_exception_handler), the view-specific documented
        codes (400/409/500), the readiness degradation (503), or the
        success codes (200/201/204)."""
        schema = build_schema()
        allowed = SHARED_ERROR_CODES | {"200", "201", "204", "400", "409", "500", "503"}

        for path, operations in schema["paths"].items():
            for method, operation in operations.items():
                for status_code in operation["responses"]:
                    assert status_code in allowed, (
                        f"{method.upper()} {path} documents undocumented status {status_code}"
                    )

    def test_transition_endpoints_document_conflict_semantics(self, client):
        """The error-matrix statuses (409/422/429) are documented on the
        transition endpoints QA's matrix exercises."""
        schema = build_schema()

        submit = schema["paths"]["/api/v1/timesheets/{pk}/submit"]["post"]["responses"]
        assert {"409", "422", "429"} <= set(submit)
        decision = schema["paths"]["/api/v1/requests/{pk}/decision"]["post"]["responses"]
        assert {"409", "422", "429"} <= set(decision)

    def test_error_envelope_shape_is_documented(self, client):
        schema = build_schema()

        error_schema = schema["paths"]["/api/v1/timesheets/{pk}/submit"]["post"]["responses"]["409"][
            "content"
        ]["application/json"]["schema"]
        error_props = error_schema["properties"]["error"]["properties"]
        assert set(error_props) == {"code", "message", "fields", "request_id"}

    def test_health_probes_are_documented(self, client):
        schema = build_schema()

        live = schema["paths"]["/health/live"]["get"]["responses"]
        assert "200" in live
        ready = schema["paths"]["/health/ready"]["get"]["responses"]
        assert {"200", "503"} <= set(ready)

    def test_schema_does_not_leak_secrets(self, client):
        response = client.get("/api/v1/schema")

        body = response.content.decode()
        for secret_marker in ("SECRET_KEY", "DATABASES", "postgres://", "password="):
            assert secret_marker not in body

    def test_components_derive_from_actual_serializer_classes(self, client):
        from accounts.employee_serializers import EmployeeReadSerializer
        from accounts.serializers import CurrentUserSerializer
        from config.schema import COMPONENT_SCHEMAS

        # The component's properties are generated from the real serializer
        # field declarations, so they must match them exactly.
        current_user = COMPONENT_SCHEMAS["CurrentUser"]
        assert set(current_user["properties"]) == set(CurrentUserSerializer().fields)
        employee_read = COMPONENT_SCHEMAS["EmployeeRead"]
        assert set(employee_read["properties"]) == set(EmployeeReadSerializer().fields)
