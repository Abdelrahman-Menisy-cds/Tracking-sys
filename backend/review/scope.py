"""Scoped review queues and read-only details (Story 4.1).

READ-ONLY scope resolution, applied before filtering, count, pagination,
serialization, and any event/attachment exposure. No mutation and no
throttle: GET endpoints deliberately never mutate and are unthrottled.

Manager scope = active principal whose EmployeeProfile lists them as the
CURRENT direct manager (active direct reports) and the relevant pending
review states (PENDING_MANAGER for requests, SUBMITTED for timesheets) plus
the broader history of those reports.

Details are SCOPED FIRST (the queryset is the scope), so an out-of-scope id
is simply absent from the scope and returns the same safe 404 as a
nonexistent id — no existence disclosure (permission-matrix 404 policy).

HR read scope (permission matrix row "Review organization requests/
timesheets: visibility separate from action"): an ACTIVE HR sees the whole
organization regardless of state, but with permissions.can_decide=false
unless the record is in a state they may act on. Read capability alone
never grants command rights; the existing POST command endpoints
independently re-check active principal, role, capability, reporting
scope, snapshot, state, self-review, version, idempotency, and reason. GET endpoints never mutate and are
never throttled.
"""
from accounts.models import User
from reqs.models import EmployeeRequest
from timesheets.models import Timesheet

# Relevant pending review states for a manager's scoped history mirror.
MANAGER_REQUEST_HISTORY_STATES = (
    EmployeeRequest.Status.PENDING_MANAGER,
    EmployeeRequest.Status.PENDING_HR,
    EmployeeRequest.Status.APPROVED,
    EmployeeRequest.Status.REJECTED,
    EmployeeRequest.Status.RETURNED,
)
MANAGER_TIMESHEET_HISTORY_STATES = (
    Timesheet.Status.SUBMITTED,
    Timesheet.Status.APPROVED,
    Timesheet.Status.REJECTED,
    Timesheet.Status.RETURNED,
)


def _active_direct_report_ids(manager):
    """PKs of the manager's CURRENT active direct reports (profile-derived).

    The reporting line lives on EmployeeProfile.manager (server
    authority), not on any request snapshot; only ACTIVE employees count.
    """
    from accounts.models import EmployeeProfile

    return list(
        EmployeeProfile.objects.filter(manager_id=manager.pk, user__is_active=True)
        .values_list("user_id", flat=True)
    )


def scope_requests(manager):
    """Manager/HR scope queryset; applied before filters/count/pagination.

    Manager: active direct reports' submitted history (their relevant
    pending review states included). HR: the whole organization (visibility
    separate from action). Anonymous/inactive/other roles: empty queryset.
    """
    if not getattr(manager, "is_authenticated", False):
        return EmployeeRequest.objects.none()
    if not manager.is_active:
        return EmployeeRequest.objects.none()
    if manager.role == User.Role.HR:
        # HR read scope = organization records; drafts are not yet records.
        return EmployeeRequest.objects.exclude(status=EmployeeRequest.Status.DRAFT)
    if manager.role == User.Role.MANAGER:
        report_ids = _active_direct_report_ids(manager)
        return EmployeeRequest.objects.filter(
            requester_id__in=report_ids,
            status__in=MANAGER_REQUEST_HISTORY_STATES,
        )
    return EmployeeRequest.objects.none()


def scope_timesheets(manager):
    """Manager/HR scope queryset for timesheets (same scope rules)."""
    if not getattr(manager, "is_authenticated", False):
        return Timesheet.objects.none()
    if not manager.is_active:
        return Timesheet.objects.none()
    if manager.role == User.Role.HR:
        return Timesheet.objects.all()
    if manager.role == User.Role.MANAGER:
        report_ids = _active_direct_report_ids(manager)
        return Timesheet.objects.filter(
            employee_id__in=report_ids,
            status__in=MANAGER_TIMESHEET_HISTORY_STATES,
        )
    return Timesheet.objects.none()


def can_decide_request(user, request_obj) -> bool:
    """Whether `user` may act on this request in its CURRENT state.

    Based on _resolve_scope (the act-on rules used to authorize a decision
    in reqs.decision_services): snapshot manager of PENDING_MANAGER, active
    HR of PENDING_HR. Read scope and decision capability stay separate: an
    HR sees organization records but shows can_decide=false outside the
    act-on states.
    """
    from reqs.decision_services import _resolve_scope  # single source of truth

    try:
        _resolve_scope(request_obj, user)
    except Exception:  # noqa: BLE001 - any denial is a no
        return False
    return True


def can_decide_timesheet(user, sheet) -> bool:
    """Whether `user` may act on this sheet (manager-of or active HR, SUBMITTED)."""
    from timesheets.review_services import _authorize_reviewer

    try:
        _authorize_reviewer(sheet, user)
    except (PermissionError, LookupError):
        return False
    return True
