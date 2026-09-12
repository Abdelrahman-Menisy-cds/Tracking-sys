"""Decision services (Story 2.4): locked, versioned, append-only transitions.

Authorization is re-checked INSIDE the locked transaction (defense in
depth; the view's only fetch does not scope): requester is never a reviewer
(self-decision denied), manager scope is manager_at_submission == reviewer
AND reviewer active AND role MANAGER AND request in PENDING_MANAGER, HR
scope is role == HR AND request in PENDING_HR. A reviewer outside scope
gets the same 404 as a nonexistent request (404 policy, no existence
disclosure); a scope-eligible reviewer on a non-pending state gets 409.

Every legal transition: transaction.atomic + select_for_update, re-check
status + version (stale -> VersionConflict 409), exactly one transition,
version += 1, append-only RequestEvent + AuditEvent, post-commit
notification to the requester (failure-isolated). Invalid action/state
combos raise DecisionStateError (409) with no mutation and no event.
"""
from django.db import transaction

from accounts.models import AuditEvent
from reqs.decision_notifications import notify_requester_of_decision
from reqs.models import EmployeeRequest, RequestEvent

DECISION_ACTIONS = ("approve", "reject", "return")


class DecisionStateError(Exception):
    """Invalid action/state combination; mapped to 409 state_conflict."""


class VersionConflict(Exception):
    """Raised when the client version is stale against the locked row."""


def _resolve_scope(locked: EmployeeRequest, reviewer) -> str:
    """Return 'manager' / 'hr' when the reviewer may act on this request.

    Raises PermissionError for self-decision. Out-of-scope reviewers get
    LookupError (view maps to 404, permission-matrix 404 policy) — no
    existence disclosure regardless of state. A scope-eligible reviewer
    whose request is in a non-pending state gets DecisionStateError (409
    state_conflict) instead of a scope denial.
    """
    if locked.requester_id == reviewer.pk:
        raise PermissionError("self_decision")
    if locked.status == EmployeeRequest.Status.PENDING_MANAGER:
        if (
            locked.manager_at_submission_id == reviewer.pk
            and reviewer.is_active
            and reviewer.role == "MANAGER"
        ):
            return "manager"
        raise LookupError("out_of_scope")
    if locked.status == EmployeeRequest.Status.PENDING_HR:
        if reviewer.role == "HR":
            return "hr"
        raise LookupError("out_of_scope")
    # Non-pending state: 409 only for a reviewer who could have acted on
    # this request (snapshot manager or HR); everyone else stays 404.
    is_snapshot_manager = (
        locked.manager_at_submission_id == reviewer.pk and reviewer.role == "MANAGER"
    )
    if is_snapshot_manager or reviewer.role == "HR":
        raise DecisionStateError(f"state_{locked.status}")
    raise LookupError("out_of_scope")


_TRANSITIONS = {
    # (scope, action) -> target status; manager approve routes to PENDING_HR
    # when the type requires HR approval, else final APPROVED.
    ("manager", "approve"): {"hr_required": EmployeeRequest.Status.PENDING_HR, "final": EmployeeRequest.Status.APPROVED},
    ("manager", "reject"): {"final": EmployeeRequest.Status.REJECTED},
    ("manager", "return"): {"final": EmployeeRequest.Status.RETURNED},
    ("hr", "approve"): {"final": EmployeeRequest.Status.APPROVED},
    ("hr", "reject"): {"final": EmployeeRequest.Status.REJECTED},
    ("hr", "return"): {"final": EmployeeRequest.Status.RETURNED},
}


_EVENT_ACTION = {"approve": RequestEvent.Action.APPROVED, "reject": RequestEvent.Action.REJECTED, "return": RequestEvent.Action.RETURNED}
_AUDIT_ACTION = {"approve": "request_approved", "reject": "request_rejected", "return": "request_returned"}


def decide_request(*, reviewer, request_obj: EmployeeRequest, action: str, comment: str, version: int):
    """Apply exactly one legal decision transition under lock.

    Caller handles idempotency replay and error mapping. Raises
    VersionConflict (409), DecisionStateError (409), PermissionError
    (self-decision, 403-mapped by the caller contract), or LookupError
    (out-of-scope, 404-mapped).
    """
    if action not in DECISION_ACTIONS:
        raise DecisionStateError(f"unknown action {action}")

    with transaction.atomic():
        locked = EmployeeRequest.objects.select_for_update().get(pk=request_obj.pk)

        scope = _resolve_scope(locked, reviewer)

        # _resolve_scope only grants manager scope in PENDING_MANAGER and HR
        # scope in PENDING_HR; every other state raised before this line.
        transition = _TRANSITIONS[(scope, action)]
        if locked.version != version:
            raise VersionConflict(locked.version)

        from_status = locked.status
        if "hr_required" in transition:
            to_status = (
                EmployeeRequest.Status.PENDING_HR
                if locked.request_type.requires_hr_approval
                else transition["final"]
            )
        else:
            to_status = transition["final"]

        locked.status = to_status
        # PENDING_HR leaves the request unassigned: the HR queue resolves the
        # reviewer at review time (Story 2.3 submit pattern).
        locked.current_assignee = None
        locked.version += 1
        locked.save(update_fields=["status", "current_assignee", "version", "updated_at"])

        RequestEvent.objects.create(
            request=locked,
            actor=reviewer,
            action=_EVENT_ACTION[action],
            from_status=from_status,
            to_status=to_status,
            comment=comment,
        )
        request_id = str(locked.pk)
        AuditEvent.objects.create(
            actor=reviewer,
            subject=locked.requester,
            action=_AUDIT_ACTION[action],
            request_id=request_id,
            before={"status": from_status, "version": version},
            after={"status": to_status, "version": locked.version, "comment": comment[:500]},
        )
        notify_requester_of_decision(request_id, action, comment)

    return locked
