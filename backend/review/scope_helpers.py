"""Shared scope-filter primitives for the Story 4.1 review queues.

Scope first: views pass an ALREADY-SCOPED queryset; these helpers only
narrow with the contract filters and impose the deterministic ordering
(submitted_at/updated submissions first, id ASC tie-break).
"""
from datetime import date as date_cls, datetime, timedelta, timezone as dt_timezone

from django.db.models import Q
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def org_local_day_bounds_utc(tz_name, day):
    """Convert an organization-LOCAL calendar day to UTC instants.

    Returns the inclusive (start, end_exclusive) UTC instants covering the
    whole org-local day: [local midnight, next local midnight) converted to
    UTC. Filtering submitted_at with submitted_at__gte=start and
    submitted_at__lt=end selects every timestamp whose ORG-LOCAL date equals
    `day`, regardless of the database/session timezone.

    Raises zoneinfo.ZoneInfoNotFoundError for an unconfigured/invalid IANA
    zone (callers map that to a client-facing validation error). Nonexistent
    local midnights (DST gaps) resolve per fold=0; fixed-offset org zones
    are unaffected.
    """
    tz = ZoneInfo(tz_name)
    start_local = datetime(day.year, day.month, day.day, tzinfo=tz)
    next_day = day + timedelta(days=1)
    end_local = datetime(next_day.year, next_day.month, next_day.day, tzinfo=tz)
    return (
        start_local.astimezone(dt_timezone.utc),
        end_local.astimezone(dt_timezone.utc),
    )


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


def apply_request_queue_filters(queryset, params, timezone_name=None):
    """Apply q / status / date_from / date_to to a scoped request queryset.

    When `timezone_name` is given (report path), date_from/date_to are
    ORGANIZATION-LOCAL calendar days: the server derives each local day's
    bounds in that timezone, converts them to UTC instants, and filters
    submitted_at with those instants (gte start / lt end). Without it (Story
    4.1 review queues) the legacy submitted_at__date behavior is preserved.
    """
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
        if timezone_name:
            queryset, tz_errors = _apply_org_local_date_bounds(queryset, date_from, date_to, timezone_name)
            errors.extend(tz_errors)
        else:
            if date_from is not None:
                queryset = queryset.filter(submitted_at__date__gte=date_from)
            if date_to is not None:
                queryset = queryset.filter(submitted_at__date__lte=date_to)
    cleaned.pop("_from", None)
    cleaned.pop("_to", None)
    return queryset.order_by("-submitted_at", "id"), cleaned, errors


def _apply_org_local_date_bounds(queryset, date_from, date_to, timezone_name):
    """Filter submitted_at by org-local calendar days, converted to UTC.

    Server-derived bounds: date_from selects submitted_at >= org-local
    midnight of date_from (UTC instant); date_to selects submitted_at <
    org-local midnight of date_to + 1 day (UTC instant). Invalid/unconfigured
    IANA zones become filter errors (422), never silent scope changes.
    """
    errors = []
    try:
        if date_from is not None:
            start, _end = org_local_day_bounds_utc(timezone_name, date_from)
            queryset = queryset.filter(submitted_at__gte=start)
        if date_to is not None:
            _start, end = org_local_day_bounds_utc(timezone_name, date_to)
            queryset = queryset.filter(submitted_at__lt=end)
    except (ZoneInfoNotFoundError, ValueError):
        errors.append(
            f"date filters: organization timezone {timezone_name!r} is not a valid IANA zone."
        )
    return queryset, errors


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
