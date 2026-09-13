"""Story 4.3: bounded, scoped report source (single server-derived query).

ALL report outputs — JSON rows, totals, dashboard values, and CSV export —
resolve their rows through THIS module only: scope first (review.scope),
then the same contract filters (review.scope_helpers), then count and
serialization. Deterministic ordering is imposed by the same helpers as the
Story 4.1 review queues (-submitted_at/-updated_at then id ASC), so results
are stable and identical across outputs.

Authorization (policy item 2 / 6 + permission matrix): MANAGER = active
direct reports, HR = organization-wide read. Employees, anonymous, inactive,
and revoked accounts never reach a report: every output raises ScopeDenied
-> 403. Read-only capability only: reports never grant decision/edit
authority and serialize no permission flags.
"""
from django.db.models import Sum

from accounts.models import User
from review import scope as review_scope
from review.scope_helpers import apply_request_queue_filters, apply_timesheet_queue_filters
from reqs.models import EmployeeRequest
from timesheets.models import TimeEntry, TimezoneConfig, Timesheet

MAX_REPORT_ROWS = 10_000

ALLOWED_CATEGORIES = ("requests", "timesheets")
ALLOWED_KINDS = ("rows", "totals", "dashboard", "csv")


class ScopeDenied(Exception):
    """Caller is not an active manager/HR: no report output at all."""


class ReportFilterError(Exception):
    """Invalid report filters -> 422, no output."""

    def __init__(self, errors):
        super().__init__("; ".join(errors))
        self.errors = errors


class RowLimitExceeded(Exception):
    """Matched rows exceed MAX_REPORT_ROWS; CSV export refuses (no partial)."""


def organization_timezone() -> str:
    """Server-authoritative organization timezone (policy item 4)."""
    cfg, _created = TimezoneConfig.objects.get_or_create(pk=1, defaults={"name": "UTC"})
    return cfg.name


def scope_label(user) -> str:
    """Stable scope identifier surfaced in every output's metadata."""
    return (
        "HR_ORGANIZATION"
        if user.role == User.Role.HR
        else "MANAGER_ACTIVE_DIRECT_REPORTS"
    )


def _authorize(user) -> None:
    authed = bool(getattr(user, "is_authenticated", False))
    if not (authed and user.is_active and user.role in (User.Role.MANAGER, User.Role.HR)):
        raise ScopeDenied()


def _validate_filters(category: str, cleaned: dict) -> None:
    status_value = cleaned.get("status")
    valid = list(EmployeeRequest.Status.values) if category == "requests" else list(Timesheet.Status.values)
    if status_value is not None and status_value not in valid:
        raise ReportFilterError([f"status: must be one of {', '.join(valid)}."])


def resolve_report(category: str, user, params):
    """THE single scope+filter source for every report output.

    Raises ScopeDenied (403) or ReportFilterError (422) before any row is
    read. Returns (filtered_queryset, meta). The queryset is already
    deterministically ordered.
    """
    if category not in ALLOWED_CATEGORIES:
        raise ReportFilterError([f"report: unknown category {category!r}."])
    _authorize(user)
    # Server-authoritative org timezone (policy item 4): the SAME value is
    # used for the date-bound conversion below and for the org_timezone
    # metadata, so advertised and applied semantics can never diverge.
    tzone = organization_timezone()
    if category == "requests":
        scoped = review_scope.scope_requests(user)
        filtered, cleaned, errors = apply_request_queue_filters(scoped, params, timezone_name=tzone)
    else:
        scoped = review_scope.scope_timesheets(user)
        filtered, cleaned, errors = apply_timesheet_queue_filters(scoped, params)
    if errors:
        raise ReportFilterError(errors)
    _validate_filters(category, cleaned)
    filters_applied = {
        key: value
        for key, value in cleaned.items()
        if not key.startswith("_") and value not in (None, "")
    }
    return filtered, {
        "report": category,
        "scope": scope_label(user),
        "org_timezone": tzone,
        "date_from": cleaned.get("date_from"),
        "date_to": cleaned.get("date_to"),
        "filters_applied": filters_applied,
        "row_count": filtered.count(),
        "row_limit": MAX_REPORT_ROWS,
    }


def totals_for(category: str, queryset) -> dict:
    """Counts by status over the ALREADY-scoped+filtered queryset."""
    status_field = "status"
    counts = {value: 0 for value in (EmployeeRequest.Status.values if category == "requests" else Timesheet.Status.values)}
    # Streaming aggregate; deterministic since the caller imposes ordering.
    for row in queryset.values_list(status_field, flat=True).iterator():
        counts[row] = counts.get(row, 0) + 1
    return {"total": sum(counts.values()), "counts_by_status": counts}


def dashboard_for(category: str, queryset) -> dict:
    """Dashboard values: totals plus timesheet minute aggregates."""
    data = totals_for(category, queryset)
    if category == "timesheets":
        sheet_ids = list(queryset.values_list("id", flat=True))
        entry_agg = TimeEntry.objects.filter(timesheet_id__in=sheet_ids).aggregate(
            worked=Sum("duration_minutes"),
            breaks=Sum("unpaid_break_minutes"),
        )
        data["total_worked_minutes"] = entry_agg["worked"] or 0
        data["total_unpaid_break_minutes"] = entry_agg["breaks"] or 0
    return data
