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


def _scoped_employee_ids(manager):
    """PKs the manager may READ and DECIDE for (Story H16).

    Owner's rule: a manager's scope is their own department. Two sources are
    unioned and both are bounded by that department whenever the manager has one:

      * every active member of the manager's department, and
      * the manager's active direct reports (the pre-H16 reporting line).

    With no department — every account that predates Story H16, and any manager
    HR has not placed yet — the result is EXACTLY the old one: active direct
    reports only. That keeps the existing scope contract intact while the org
    migrates, and it is why the old name was renamed rather than redefined.

    HR grants (ManagerGrant, active, this manager) then add named employees one
    by one. Per the owner's explicit decision a grant carries BOTH read and
    decide for that employee — and for nobody else.
    """
    from accounts.models import EmployeeProfile, ManagerGrant

    profile = EmployeeProfile.objects.filter(user_id=manager.pk).first()
    department_id = profile.department_id if profile is not None else None

    members = EmployeeProfile.objects.filter(user__is_active=True).exclude(user_id=manager.pk)
    if department_id is None:
        members = members.filter(manager_id=manager.pk)
    else:
        members = members.filter(department_id=department_id)
    ids = set(members.values_list("user_id", flat=True))
    ids.update(
        ManagerGrant.objects.filter(
            manager_id=manager.pk, is_active=True, employee__is_active=True
        ).values_list("employee_id", flat=True)
    )
    return ids


# H35: the people report reuses the SAME scope source as the request and
# timesheet queues — a public alias so reports never grow a parallel one.
scoped_employee_ids = _scoped_employee_ids


def scope_requests(manager):
    """Manager/HR scope queryset; applied before filters/count/pagination.

    Manager: their department (or their direct reports) submitted history, with
    HR grants unioned in (their relevant pending review states included). HR:
    the whole organization (visibility separate from action).
    Anonymous/inactive/other roles: empty queryset.
    """
    if not getattr(manager, "is_authenticated", False):
        return EmployeeRequest.objects.none()
    if not manager.is_active:
        return EmployeeRequest.objects.none()
    if manager.role == User.Role.HR:
        # HR read scope = the organization records of THEIR OWN company
        # (H30 §3): an unscoped queryset here showed every tenant's records,
        # which is the cross-company leak this whole plan exists to remove.
        # Drafts are not yet records.
        return EmployeeRequest.objects.filter(company=manager.company).exclude(
            status=EmployeeRequest.Status.DRAFT
        )
    if manager.role == User.Role.MANAGER:
        scoped_ids = _scoped_employee_ids(manager)
        return EmployeeRequest.objects.filter(
            company=manager.company,
            requester_id__in=scoped_ids,
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
        return Timesheet.objects.filter(company=manager.company)
    if manager.role == User.Role.MANAGER:
        scoped_ids = _scoped_employee_ids(manager)
        return Timesheet.objects.filter(
            company=manager.company,
            employee_id__in=scoped_ids,
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
            request_obj.requester_id in _scoped_employee_ids(user)
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

    HR is a REVIEWER of the SUBMITTED stage, exactly as it is of a request's
    PENDING_HR stage. timesheets.review_services._resolve_scope grants HR the
    "hr" scope on a SUBMITTED sheet and Story 3.3 proves the decision endpoint
    accepts HR's approve/reject/return there, so this flag has to be true in
    the same place. The earlier "HR reads ALWAYS serialize can_decide=false"
    rule was wrong: the review screen offers a decision from this flag alone,
    so it left HR's whole SUBMITTED queue un-actionable while the server kept
    accepting the decision. HR's reopen of an APPROVED/REJECTED sheet is a
    separate endpoint with its own confirmation and is not this affordance.

    Managers mirror the current active direct-report scope (AC 4.1): the
    sheet's employee must be their CURRENT active direct report and the sheet
    must be in a relevant review state.
    """
    if not getattr(user, "is_authenticated", False) or not user.is_active:
        return False
    if sheet.employee_id == user.pk:
        return False  # self-review is never permitted
    if user.role == User.Role.MANAGER:
        if sheet.employee_id not in _scoped_employee_ids(user):
            return False
        return sheet.status in MANAGER_TIMESHEET_HISTORY_STATES
    if user.role == User.Role.HR:
        # HR's act-on state for a timesheet is SUBMITTED
        # (timesheets.review_services._resolve_scope).
        return sheet.status == Timesheet.Status.SUBMITTED
    return False
