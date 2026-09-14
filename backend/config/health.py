"""Operational health endpoints (Story 5.1, QA-fixed).

Per architecture-security.md: liveness proves the process is up; readiness
proves bounded dependency availability. Neither reveals secrets, stack traces,
or infrastructure details beyond a coarse dependency status.

QA 5.1 fix: the readiness check previously claimed a 2-second bound but never
enforced one (a hanging DB socket blocked the request indefinitely). The DB
probe now runs inside a daemon thread joined with ``READINESS_DEPENDENCY_TIMEOUT_S``
so the endpoint always answers within the documented bound. All exception
detail stays server-side; the response names only the failed dependency kind.
"""
import logging
import threading
from collections import namedtuple

from django.db import DatabaseError, connections

from config.api_version import API_VERSION, API_VERSION_HEADER
from django.http import JsonResponse

logger = logging.getLogger(__name__)

READINESS_DEPENDENCY_TIMEOUT_S = 2  # bounded, per the architecture contract

# Immutable outcome of the bounded DB probe: (mode, timed_out).
ProbeResult = namedtuple("ProbeResult", ("mode", "timed_out"))


def _probe_database(result_holder, done_event):
    """Run a single SELECT 1 and record the outcome; never raises.

    Executed in a worker thread so the holding thread can time it out. The
    MySQL/SQLite backend set the wait_timeout server-side; psycopg's
    statement_timeout cannot be set without a live connection here, so the
    wall-clock join in :func:`_probe_database_bounded` is the enforced bound.
    """
    mode = "ok"
    try:
        connection = connections["default"]
        connection.ensure_connection()
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except DatabaseError:
        mode = "unavailable"
    except Exception:
        # Unexpected failure (connection refused, DNS, driver bugs): degrade
        # to unready without leaking any detail into the response.
        logger.exception("Readiness database probe failed unexpectedly")
        mode = "unavailable"
    finally:
        result_holder.append(ProbeResult(mode=mode, timed_out=False))
        done_event.set()


def _probe_database_bounded(timeout_s):
    """Run the DB probe with a hard wall-clock bound; return the outcome.

    On timeout the probe thread is abandoned (never killed — threads cannot
    be safely terminated in Python) and the endpoint reports an unready
    database; the orphaned thread eventually finishes or times out on its
    own without affecting future probes.
    """
    result_holder = []
    done_event = threading.Event()
    probe_thread = threading.Thread(
        target=_probe_database,
        args=(result_holder, done_event),
        daemon=True,
        name="readiness-db-probe",
    )
    probe_thread.start()
    finished = probe_thread.join(timeout=timeout_s)
    if not done_event.is_set():
        return ProbeResult(mode="unavailable", timed_out=True)
    probe_thread.join(timeout=0.1)  # bounded settle before reading the holder
    return result_holder[0] if result_holder else ProbeResult(mode="unavailable", timed_out=False)


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

    The check is hard-bounded to ``READINESS_DEPENDENCY_TIMEOUT_S`` seconds
    of wall clock. The response names only the failed dependency kind, never
    connection strings, credentials, or exception detail.
    """
    probe = _probe_database_bounded(READINESS_DEPENDENCY_TIMEOUT_S)
    ready = probe.mode == "ok"
    status_code = 200 if ready else 503
    return _json_response(
        {
            "status": "ok" if ready else "unready",
            "checks": {"database": "ok" if ready else "unavailable"},
        },
        status=status_code,
    )
