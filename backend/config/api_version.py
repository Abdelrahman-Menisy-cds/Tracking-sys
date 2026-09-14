"""Versioned API surface: shared envelope constants and helpers (Story 5.1).

The error envelope shape itself is the approved contract from
architecture-security.md §6 and is exercised by Story 1.x/2.x/3.x/4.x tests;
this module only names it and adds the versioned response helpers so views
return an explicit ``api_version`` without changing any existing payload.
"""
API_VERSION = "v1"
API_VERSION_HEADER = "X-API-Version"


def versioned_payload(payload):
    """Return ``payload`` tagged with the API version under ``meta``.

    Success envelopes in this codebase are either a bare resource object or
    ``{"data": ..., "meta": {...}}``. This helper only touches the ``meta``
    form (lists/pagination); bare-resource responses keep their exact shape.
    """
    if isinstance(payload, dict) and "meta" in payload and isinstance(payload["meta"], dict):
        payload["meta"] = {"api_version": API_VERSION, **payload["meta"]}
    return payload
