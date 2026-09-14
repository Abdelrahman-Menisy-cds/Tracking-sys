"""Versioned API surface: shared envelope constants and helpers (Story 5.1).

The error envelope shape itself is the approved contract from
architecture-security.md §6 and is exercised by Story 1.x/2.x/3.x/4.x tests;
this module only names it, adds the versioned response helpers so views
return an explicit ``api_version`` without changing any existing payload,
and provides the middleware that tags every versioned-API response.

QA 5.1 fix: the previous helper only tagged ``meta``-bearing payloads; the
header-based middleware makes version disclosure uniform and backwards
compatible for every response (bare success resources included) without any
body-shape change.
"""
API_VERSION = "v1"
API_VERSION_HEADER = "X-API-Version"

# Path prefixes whose responses must carry the version header: the versioned
# API surface plus the operator-facing health probes.
VERSIONED_PATH_PREFIXES = ("/api/", "/health/")


def versioned_payload(payload):
    """Return ``payload`` tagged with the API version under ``meta``.

    Success envelopes in this codebase are either a bare resource object or
    ``{"data": ..., "meta": {...}}``. This helper only touches the ``meta``
    form (lists/pagination); bare-resource responses keep their exact shape.
    Kept for backwards compatibility; version disclosure now flows through
    :class:`APIVersionMiddleware`.
    """
    if isinstance(payload, dict) and "meta" in payload and isinstance(payload["meta"], dict):
        payload["meta"] = {"api_version": API_VERSION, **payload["meta"]}
    return payload


class APIVersionMiddleware:
    """Stamp the response version header on every versioned-API response.

    Applied after :class:`RequestIDMiddleware` so the version header is
    present on all ``/api/v1/`` success and error responses (including DRF
    error envelopes and the unmatched-route 404) and on the health probes.
    Adds a header only — no request or response body is altered.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith(VERSIONED_PATH_PREFIXES):
            response[API_VERSION_HEADER] = API_VERSION
        return response
