"""Shared scope-filter primitives for the Story 4.1 review queues.

Scope first: views pass an ALREADY-SCOPED queryset; these helpers only
narrow with the contract filters and impose the deterministic ordering
(submitted_at/updated submissions first, id ASC tie-break).
"""
from datetime import date as date_cls

from django.db.models import Q


def parse_iso_date(value, field_name):
    """Strict ISO date parsing for query params; raises ValueError.

    Malformed dates are a client validation error (422), never silently
    ignored: ignoring would change the visible scope.
    """
    if not value:
        return None
    try:
        return date_cls.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name}: invalid date, expected YYYY-MM-DD.")


def apply_request_queue_filters(queryset, params):
    """Apply q / status / date_from / date_to to a scoped request queryset."""
    queryset, cleaned, errors = _common(queryset, params)
    if q := cleaned.pop("_q", None):
        queryset = queryset.filter(
            Q(title__icontains=q)
            | Q(details__icontains=q)
            | Q(requester__email__icontains=q)
            | Q(requester__full_name__icontains=q)
        )
    if errors:
        return queryset.none(), cleaned, errors
    if "status" in cleaned:
        queryset = queryset.filter(status=cleaned["status"])
    if "_from" in cleaned or "_to" in cleaned:
        date_from = cleaned.pop("_from", None)
        date_to = cleaned.pop("_to", None)
        if date_from is not None:
            queryset = queryset.filter(submitted_at__date__gte=date_from)
        if date_to is not None:
            queryset = queryset.filter(submitted_at__date__lte=date_to)
    cleaned.pop("_from", None)
    cleaned.pop("_to", None)
    return queryset.order_by("-submitted_at", "id"), cleaned, errors


def apply_timesheet_queue_filters(queryset, params):
    """Apply q / status / date_from / date_to to a scoped timesheet queryset.

    Timesheets have no submitted_at column; the deterministic sort key is
    the latest submission-ish timestamp available: updated_at is the state
    clock for SUBMITTED sheets, so order by -updated_at with id ASC, while
    keeping the param semantics against week_start (date_from/date_to).
    """
    queryset, cleaned, errors = _common(queryset, params)
    if q := cleaned.pop("_q", None):
        queryset = queryset.filter(
            Q(employee__email__icontains=q)
            | Q(employee__full_name__icontains=q)
            | Q(entries__description__icontains=q)
        ).distinct()
    if errors:
        return queryset.none(), cleaned, errors
    if "status" in cleaned:
        queryset = queryset.filter(status=cleaned["status"])
    date_from = cleaned.pop("_from", None)
    date_to = cleaned.pop("_to", None)
    if date_from is not None:
        queryset = queryset.filter(week_start__gte=date_from)
    if date_to is not None:
        queryset = queryset.filter(week_start__lte=date_to)
    return queryset.order_by("-updated_at", "id"), cleaned, errors


def _common(queryset, params):
    cleaned = {}
    errors = []

    q = (params.get("q") or "").strip()
    if q:
        cleaned["_q"] = q
        cleaned["q"] = q

    status_value = (params.get("status") or "").strip()
    if status_value:
        cleaned["status"] = status_value

    try:
        date_from = parse_iso_date(params.get("date_from"), "date_from")
        date_to = parse_iso_date(params.get("date_to"), "date_to")
    except ValueError as exc:
        errors.append(str(exc))
        return queryset.none(), cleaned, errors

    if date_from is not None:
        cleaned["date_from"] = date_from.isoformat()
        cleaned["_from"] = date_from
    if date_to is not None:
        cleaned["date_to"] = date_to.isoformat()
        cleaned["_to"] = date_to
    return queryset, cleaned, errors
