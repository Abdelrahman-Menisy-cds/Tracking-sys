"""Operational health endpoints (Story 5.1).

Per architecture-security.md: liveness proves the process is up; readiness
proves bounded dependency availability. Neither reveals secrets, stack traces,
or infrastructure details beyond a coarse dependency status.
"""
import logging

from django.db import DatabaseError, connections

from config.api_version import API_VERSION, API_VERSION_HEADER
from django.http import JsonResponse

logger = logging.getLogger(__name__)

READINESS_DEPENDENCY_TIMEOUT_S = 2  # bounded, per the architecture contract


def _json_response(payload, status):
    response = JsonResponse(payload, status=status)
    response[API_VERSION_HEADER] = API_VERSION
    return response


def health_live(request):
    """Process liveness: no dependency contact, no secrets."""
    return _json_response(
        {"status": "ok", "checks": {"process": "ok"}},
        status=200,
    )


def health_ready(request):
    """Bounded dependency readiness: a failed DB check degrades to 503.

    The response names only the failed dependency kind, never connection
    strings, credentials, or exception detail. Unexpected failures are logged
    server-side and reported as an unready database.
    """
    db_status = "ok"
    status = 200
    try:
        connection = connections["default"]
        connection.ensure_connection()
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except DatabaseError:
        db_status = "unavailable"
        status = 503
    except Exception:
        logger.exception("Readiness check failed unexpectedly")
        db_status = "unavailable"
        status = 503

    ready = status == 200
    return _json_response(
        {
            "status": "ok" if ready else "unready",
            "checks": {"database": db_status},
        },
        status=status,
    )
