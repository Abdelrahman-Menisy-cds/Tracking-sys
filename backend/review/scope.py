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
    """Whether `user` may act on this request per Story 4.1 READ permissions.

    Story 4.1 QA decision: read permissions.can_decide mirrors the CURRENT
    active direct-report scope (AC 4.1), NOT the manager_at_submission
    snapshot used by the command endpoint (reqs.decision_services keeps its
    snapshot policy for decisions — changing a manager affects future
    submissions, not existing snapshots, per approved policy item 1). The
    read flag stays consistent with the scoped queryset: a manager sees a
    PENDING_MANAGER record of an active direct report in their queue and
    shows can_decide=true exactly there. HR read scope is visibility
    separate from action EXCEPT for the explicit, policy-gated HR decision
    capability on PENDING_HR requests (permission matrix: approve/reject/
    return in scope — HR, policy-gated); all other HR reads serialize
    can_decide=false. The decision command endpoint independently
    re-authorizes everything inside its locked transaction.
    """
    if not getattr(user, "is_authenticated", False) or not user.is_active:
        return False
    if request_obj.requester_id == user.pk:
        return False  # self-review is never permitted
    if user.role == User.Role.MANAGER:
        # Current active direct-report scope (AC 4.1), not the snapshot; the
        # only state a manager can act on is PENDING_MANAGER.
        return (
            request_obj.requester_id in _active_direct_report_ids(user)
            and request_obj.status == EmployeeRequest.Status.PENDING_MANAGER
        )
    if user.role == User.Role.HR:
        # Explicit, policy-gated HR decision capability for requests: active
        # HR acts on PENDING_HR (reqs.decision_services._resolve_scope).
        # Every other state is read-only visibility -> can_decide=false.
        return request_obj.status == EmployeeRequest.Status.PENDING_HR
    return False


def can_decide_timesheet(user, sheet) -> bool:
    """Whether `user` may act on this sheet per Story 4.1 READ permissions.

    Story 4.1 QA decision: HR organization read scope is visibility only —
    there is no explicit HR decision capability in the data model, so HR
    reads ALWAYS serialize can_decide=false (finding 1), including on
    SUBMITTED sheets. The timesheet decision/reopen command endpoints
    (timesheets.review_services) keep their own independent authorization.
    Managers mirror the current active direct-report scope (AC 4.1): the
    sheet's employee must be their CURRENT active direct report and the
    sheet must be in a relevant review state. The SUBMITTED act-on gate
    itself stays with review_services; this flag only drives UI affordances.
    """
    if not getattr(user, "is_authenticated", False) or not user.is_active:
        return False
    if sheet.employee_id == user.pk:
        return False  # self-review is never permitted
    if user.role == User.Role.MANAGER:
        if sheet.employee_id not in _active_direct_report_ids(user):
            return False
        return sheet.status in MANAGER_TIMESHEET_HISTORY_STATES
    return False
