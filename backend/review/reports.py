"""Story 4.3 + H35: bounded, scoped report source (single server-derived query).

ALL report outputs — JSON rows, totals, dashboard values, and CSV export —
resolve their rows through THIS module only: scope first (review.scope),
then the same contract filters, then count and serialization. Deterministic
ordering is imposed by the same helpers as the Story 4.1 review queues
(-submitted_at/-updated_at then id ASC) so results are stable and identical
across outputs.

Authorization (policy item 2 / 6 + permission matrix): MANAGER = active
direct reports, HR = organization-wide read. Employees, anonymous, inactive,
and revoked accounts never reach a report: every output raises ScopeDenied
-> 403. Read-only capability only: reports never grant decision/edit
authority and serialize no permission flags.

H35 categories (ALLOWED_CATEGORIES): requests | timesheets | attendance |
people.

attendance — derived from the ONLY server-tracked attendance source, the
timesheet entry history (the same registered convention as
accounts.assistant_tools.read_my_attendance: the backend has NO standalone
attendance app). Rows are per employee-day: PRESENT (duration_minutes > 0)
or INCOMPLETE (an entry exists with 0 worked minutes). ABSENT / LEAVE arrive
with the attendance app (specs/attendance-state-machine.md); until then the
status filter accepts only the derivable vocabulary. The scope is EXACTLY
review.scope.scope_timesheets — manager: their department/reports' review
states (DRAFT sheets are outside a manager's review scope, like every other
manager report); HR: every sheet of their own company, DRAFT included. No
new unscoped entry query exists anywhere in this module, so the H30 leak
stays closed.

people — employee/department counts over EmployeeProfile rows in scope:
HR = every active profile of their own company; manager = the SAME employee
ids the request/timesheet scopes resolve (review.scope.scoped_employee_ids)
plus the manager's own profile, because a department headcount includes its
manager. Dates are validated and echoed in meta but do not narrow: headcount
is current-state (no headcount history is tracked).

Month closing: attendance /totals with from/to covering a month returns the
per-employee day counts and canonical minute totals ready for payroll
(per_employee), alongside the day counts by derived status.

Filters on rows/totals/dashboard/csv: date_from/date_to (legacy names) or
from/to (H35 aliases; same ISO org-local semantics, inclusive), department
(id), employee (id), status (repeatable — repeated params and/or
comma-separated). A department or employee id outside the caller's scope
simply narrows to nothing: the id is resolved INSIDE the already-scoped
queryset, so no error ever discloses whether the id exists elsewhere
(malformed ids are a 422, not an existence oracle). The attendance report
defaults its window to the current org-local week (Monday-Sunday) when no
dates are given; requests/timesheets keep their legacy unbounded default —
their published shape is unchanged.
"""
from datetime import timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db.models import Count, Q, Sum
from django.utils import timezone as dj_timezone

from accounts.models import Department, EmployeeProfile, User
from reqs.models import EmployeeRequest
from review import scope as review_scope
from review.scope import scoped_employee_ids
from review.scope_helpers import (
    apply_request_queue_filters,
    apply_timesheet_queue_filters,
    parse_iso_date,
)
from timesheets.models import TimeEntry, TimezoneConfig, Timesheet

MAX_REPORT_ROWS = 10_000

ALLOWED_CATEGORIES = ("requests", "timesheets", "attendance", "people")
ALLOWED_KINDS = ("rows", "totals", "dashboard", "csv")

#: Attendance statuses derivable from the timesheet entry history today.
ATTENDANCE_PRESENT = "PRESENT"
ATTENDANCE_INCOMPLETE = "INCOMPLETE"
ATTENDANCE_STATUSES = (ATTENDANCE_PRESENT, ATTENDANCE_INCOMPLETE)

#: Valid `status` values per category. `people` has no status vocabulary:
#: ANY status value there is a client error (422), never a silent ignore.
_STATUS_VOCABULARIES = {
    "requests": EmployeeRequest.Status.values,
    "timesheets": Timesheet.Status.values,
    "attendance": ATTENDANCE_STATUSES,
}


class ScopeDenied(Exception):
    """Caller is not an active manager/HR: no report output at all."""


class ReportFilterError(Exception):
    """Invalid report filters -> 422, no output."""

    def __init__(self, errors):
        super().__init__("; ".join(errors))
        self.errors = errors


class RowLimitExceeded(Exception):
    """Matched rows exceed MAX_REPORT_ROWS; CSV export refuses (no partial)."""


def organization_timezone(user) -> str:
    """Server-authoritative organization timezone for the caller's company
    (policy item 4; per-company since H30 §2.4)."""
    cfg, _created = TimezoneConfig.objects.get_or_create(
        company=user.company, defaults={"name": "UTC"}
    )
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


def attendance_day_status(duration_minutes) -> str:
    """The one derived attendance status rule (rows, totals and CSV share it)."""
    return ATTENDANCE_PRESENT if duration_minutes > 0 else ATTENDANCE_INCOMPLETE


def _normalized_params(params):
    """Mutable copy with the H35 `from`/`to` aliases folded into the legacy
    date_from/date_to names (legacy names win when both are given)."""
    merged = params.copy()
    for legacy, alias in (("date_from", "from"), ("date_to", "to")):
        if not (merged.get(legacy) or "").strip() and (merged.get(alias) or "").strip():
            merged[legacy] = merged[alias]
    return merged


def _first_value(params, key) -> str:
    """Last scalar value for `key` (QueryDict and plain dict alike)."""
    if hasattr(params, "getlist"):
        values = params.getlist(key)
        return str(values[-1]) if values else ""
    return str(params.get(key) or "")


def _drop_key(params, key) -> None:
    """Remove `key` from a mutable params copy, discarding pop's raw value."""
    try:
        params.pop(key, None)
    except (AttributeError, TypeError):  # immutable mapping — nothing to drop
        pass


def _status_values(params) -> list:
    """Repeatable `status`: repeated query params and/or comma-separated.

    Single-value behavior is IDENTICAL to the legacy single filter (a one
    element list filters as status__in=[value]); the value is popped off the
    merged params so the queue helpers never see it twice.
    """
    if hasattr(params, "getlist"):
        raw = params.getlist("status")
    else:
        raw = [params.get("status") or ""]
    values = []
    for chunk in raw:
        for part in str(chunk or "").split(","):
            part = part.strip()
            if part and part not in values:
                values.append(part)
    return values


def _parse_int_id(raw, field, errors):
    """Parse a department/employee id; malformed -> 422, never an existence
    oracle. Out-of-scope but well-formed ids narrow to nothing later (the
    queryset is already scoped)."""
    if not raw:
        return None
    try:
        value = int(str(raw))
    except (TypeError, ValueError):
        errors.append(f"{field}: invalid id, expected an integer.")
        return None
    if value < 1:
        errors.append(f"{field}: invalid id, expected a positive integer.")
        return None
    return value


def _parse_window(merged, errors, default_week_tz=None):
    """Parse date_from/date_to (aliases already folded). Returns
    (date_from, date_to, cleaned_dates). With default_week_tz and no dates at
    all, the window defaults to the current org-local Monday..Sunday week."""
    try:
        date_from = parse_iso_date(merged.get("date_from"), "date_from")
        date_to = parse_iso_date(merged.get("date_to"), "date_to")
    except ValueError as exc:
        errors.append(str(exc))
        return None, None, {}
    cleaned = {}
    if date_from is not None:
        cleaned["date_from"] = date_from.isoformat()
    if date_to is not None:
        cleaned["date_to"] = date_to.isoformat()
    if date_from is None and date_to is None and default_week_tz is not None:
        week_from, week_to = _current_org_week(default_week_tz, errors)
        if week_from is not None and week_to is not None:
            date_from, date_to = week_from, week_to
            cleaned["date_from"] = date_from.isoformat()
            cleaned["date_to"] = date_to.isoformat()
    return date_from, date_to, cleaned


def _current_org_week(tz_name, errors):
    """Org-local Monday..Sunday containing today (the timesheet week
    convention: weeks are Monday-Sunday in the organization timezone)."""
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        errors.append(
            f"date filters: organization timezone {tz_name!r} is not a valid IANA zone."
        )
        return None, None
    today = dj_timezone.localtime(dj_timezone.now(), tz).date()
    monday = today - timedelta(days=today.weekday())
    return monday, monday + timedelta(days=6)


def _attendance_queryset(user, merged, department_id, employee_id, status_values, tzone):
    """Entries of the ALREADY-SCOPED timesheets (review.scope.scope_timesheets).

    Manager: entries on their department/reports' review-state sheets (DRAFT
    sheets are outside the manager's review scope, same as every other
    manager report). HR: entries on every sheet of their own company, DRAFT
    included. work_date is an organization-local calendar date by
    construction, so the inclusive window is a plain date comparison.
    """
    errors = []
    entries = TimeEntry.objects.filter(timesheet__in=review_scope.scope_timesheets(user))
    date_from, date_to, cleaned = _parse_window(merged, errors, default_week_tz=tzone)
    if date_from is not None:
        entries = entries.filter(work_date__gte=date_from)
    if date_to is not None:
        entries = entries.filter(work_date__lte=date_to)
    if department_id is not None:
        entries = entries.filter(timesheet__employee__employee_profile__department_id=department_id)
    if employee_id is not None:
        entries = entries.filter(timesheet__employee_id=employee_id)
    if status_values:
        clause = Q()
        for value in status_values:
            clause |= (
                Q(duration_minutes__gt=0)
                if value == ATTENDANCE_PRESENT
                else Q(duration_minutes=0)
            )
        entries = entries.filter(clause)
    entries = entries.select_related("timesheet", "timesheet__employee").order_by(
        "timesheet__employee_id", "work_date", "id"
    )
    return entries, cleaned, errors


def _people_queryset(user, department_id, employee_id, merged):
    """EmployeeProfile rows in the caller's scope (the people source).

    HR: every active profile of their own company. Manager: the SAME ids the
    request/timesheet scopes resolve (review.scope.scoped_employee_ids) plus
    the manager's own profile — a department headcount includes its manager.
    The explicit company filter is belt-and-braces: scoped ids are
    same-company by construction and the department/employee ids below are
    resolved INSIDE this queryset, so a cross-company id narrows to nothing.
    """
    errors = []
    if user.role == User.Role.HR:
        profiles = EmployeeProfile.objects.filter(company=user.company, user__is_active=True)
    else:
        ids = scoped_employee_ids(user)
        ids.add(user.pk)
        profiles = EmployeeProfile.objects.filter(
            company=user.company, user__is_active=True, user_id__in=ids
        )
    _date_from, _date_to, cleaned = _parse_window(merged, errors)
    if department_id is not None:
        profiles = profiles.filter(department_id=department_id)
    if employee_id is not None:
        profiles = profiles.filter(user_id=employee_id)
    profiles = profiles.select_related("user", "department", "department__manager").order_by("id")
    return profiles, cleaned, errors


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
    tzone = organization_timezone(user)
    merged = _normalized_params(params)
    status_values = _status_values(merged)
    _drop_key(merged, "status")
    department_raw = _first_value(params, "department").strip()
    employee_raw = _first_value(params, "employee").strip()
    _drop_key(merged, "department")
    _drop_key(merged, "employee")

    errors = []
    if category == "people":
        if status_values:
            errors.append("status: the people report has no status vocabulary.")
            status_values = []
    else:
        valid = _STATUS_VOCABULARIES[category]
        invalid = [value for value in status_values if value not in valid]
        if invalid:
            errors.append(
                f"status: must be one of {', '.join(valid)} (invalid: {', '.join(invalid)})."
            )
            status_values = []
    department_id = _parse_int_id(department_raw, "department", errors)
    employee_id = _parse_int_id(employee_raw, "employee", errors)

    cleaned = {}
    if category == "requests":
        scoped = review_scope.scope_requests(user)
        filtered, cleaned, helper_errors = apply_request_queue_filters(scoped, merged, timezone_name=tzone)
        errors.extend(helper_errors)
        if department_id is not None:
            filtered = filtered.filter(requester__employee_profile__department_id=department_id)
        if employee_id is not None:
            filtered = filtered.filter(requester_id=employee_id)
        if status_values:
            filtered = filtered.filter(status__in=status_values)
    elif category == "timesheets":
        scoped = review_scope.scope_timesheets(user)
        filtered, cleaned, helper_errors = apply_timesheet_queue_filters(scoped, merged)
        errors.extend(helper_errors)
        if department_id is not None:
            filtered = filtered.filter(employee__employee_profile__department_id=department_id)
        if employee_id is not None:
            filtered = filtered.filter(employee_id=employee_id)
        if status_values:
            filtered = filtered.filter(status__in=status_values)
    elif category == "attendance":
        filtered, att_cleaned, att_errors = _attendance_queryset(
            user, merged, department_id, employee_id, status_values, tzone
        )
        cleaned.update(att_cleaned)
        errors.extend(att_errors)
    else:  # people
        filtered, ppl_cleaned, ppl_errors = _people_queryset(user, department_id, employee_id, merged)
        cleaned.update(ppl_cleaned)
        errors.extend(ppl_errors)

    if errors:
        raise ReportFilterError(errors)
    filters_applied = {
        key: value
        for key, value in cleaned.items()
        if not key.startswith("_") and value not in (None, "")
    }
    if status_values:
        filters_applied["status"] = status_values
    if department_raw:
        filters_applied["department"] = department_raw
    if employee_raw:
        filters_applied["employee"] = employee_raw
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
    """Totals over the ALREADY-scoped+filtered queryset, per category."""
    if category == "attendance":
        return attendance_totals(queryset)
    if category == "people":
        return people_totals(queryset)
    counts = {value: 0 for value in _STATUS_VOCABULARIES[category]}
    # Streaming aggregate; deterministic since the caller imposes ordering.
    for row in queryset.values_list("status", flat=True).iterator():
        counts[row] = counts.get(row, 0) + 1
    return {"total": sum(counts.values()), "counts_by_status": counts}


def attendance_totals(queryset) -> dict:
    """Day counts by derived status plus the per-employee month closing.

    With from/to covering a month this IS the month closing: per-employee
    present/incomplete day counts and worked/unpaid-break minute totals,
    ready for payroll. Minutes are canonical integers (no rounding).
    """
    counts = {value: 0 for value in ATTENDANCE_STATUSES}
    for entry in queryset.iterator():
        counts[attendance_day_status(entry.duration_minutes)] += 1
    per_employee = (
        queryset.values(
            "timesheet__employee_id",
            "timesheet__employee__full_name",
            "timesheet__employee__email",
        )
        .annotate(
            present_days=Count("id", filter=Q(duration_minutes__gt=0)),
            incomplete_days=Count("id", filter=Q(duration_minutes=0)),
            total_worked_minutes=Sum("duration_minutes"),
            total_unpaid_break_minutes=Sum("unpaid_break_minutes"),
        )
        .order_by("timesheet__employee__full_name", "timesheet__employee_id")
    )
    rows = [
        {
            "employee_id": str(row["timesheet__employee_id"]),
            "employee_name": row["timesheet__employee__full_name"],
            "employee_email": row["timesheet__employee__email"],
            "present_days": row["present_days"],
            "incomplete_days": row["incomplete_days"],
            "total_worked_minutes": row["total_worked_minutes"] or 0,
            "total_unpaid_break_minutes": row["total_unpaid_break_minutes"] or 0,
        }
        for row in per_employee
    ]
    return {"total": sum(counts.values()), "counts_by_status": counts, "per_employee": rows}


def people_totals(queryset) -> dict:
    """Active employees, departments, and managers inside the caller's scope."""
    total = queryset.count()
    department_ids = set(queryset.exclude(department=None).values_list("department_id", flat=True))
    manager_ids = set(queryset.exclude(manager=None).values_list("manager_id", flat=True))
    manager_ids.update(
        Department.objects.filter(pk__in=department_ids, manager__isnull=False).values_list(
            "manager_id", flat=True
        )
    )
    return {"total": total, "departments": len(department_ids), "managers": len(manager_ids)}


def dashboard_for(category: str, queryset) -> dict:
    """Dashboard values: totals plus timesheet minute aggregates."""
    if category in ("attendance", "people"):
        return totals_for(category, queryset)
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
