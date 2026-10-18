"""Leave-balance services: the derived used-days figure and the locked adjust.

TWO TRUTHS, ONE DERIVED (the whole point of this module). ``entitled_days`` and
``carried_over_days`` are HR-configured and stored. ``used_days`` is DERIVED
here, never stored, from the APPROVED leave requests that already exist in
``reqs``: the request rows are the consumption record, so a stored counter
would be a second truth that drifts the moment a request is approved, returned,
or cancelled. ``remaining = entitled + carried_over − used`` is recomputed on
every read.

A request carries no per-request duration field (the leave period travels as
free text inside ``title``), so the only truthful consumption figure the data
holds is the NUMBER of approved leave requests of that type in the year. That
is what ``used_days`` reports — a count of approved leave requests, not a sum
of calendar days — and it is stated as such in the payload's ``used_days_note``
so no reader mistakes it for more than it is.
"""
import logging
from decimal import Decimal
from hashlib import sha256

from django.db import IntegrityError, transaction
from django.db.models import Count, Q

from accounts.models import AuditEvent, EmployeeProfile, User
from leavebalances.models import (
    LeaveBalance,
    LeaveBalanceAdjustment,
    LeaveBalanceIdempotencyRecord,
)
from leavebalances.serializers import LEAVE_TYPE_NAME_MARKER
from reqs.models import EmployeeRequest, RequestType

logger = logging.getLogger(__name__)

#: Bounded adjustment history attached to each read row (newest first).
HISTORY_LIMIT = 5

#: The honest, non-negotiable description of what ``used_days`` counts.
USED_DAYS_NOTE = (
    "used_days counts the employee's APPROVED leave requests of this type in "
    "the year; the request carries no duration field, so it is a count of "
    "approved requests, not a sum of calendar days."
)

NO_LEAVE_TYPES_NOTE = (
    "No leave request types are defined for this company yet, so no balance "
    "can be computed. HR must define leave request types (a RequestType whose "
    "name contains «إجازة») first."
)


class VersionConflict(Exception):
    """The client's version is stale against the locked balance row (409)."""

    def __init__(self, current_version: int):
        self.current_version = current_version
        super().__init__(f"version_conflict:{current_version}")


class IdempotencyConflict(Exception):
    """Same idempotency key reused with a different payload (409)."""


class IdempotencyReplay(Exception):
    """A committed record already holds this key; carries the winner's snapshot."""

    def __init__(self, snapshot):
        self.snapshot = snapshot
        super().__init__("idempotency_replay")


def leave_types(company):
    """The company's ACTIVE leave types — a RequestType whose name has «إجازة».

    This is the ONE definition of "leave type" in the app; it mirrors the
    predicate accounts.assistant_tools.read_my_leave_balance already uses, so
    the balance screen and the assistant can never disagree about the subset.
    """
    return RequestType.objects.filter(
        company=company, is_active=True, name__icontains=LEAVE_TYPE_NAME_MARKER
    ).order_by("name")


def scoped_employees(user):
    """Who the caller may read balances for.

    HR reads the whole company (active, non-break-glass accounts). Everyone
    else — employee and manager alike — reads only their own row, which is the
    owner's rule ("an employee reads only their own balances"). No cross-company
    row can ever enter this queryset: it is filtered by the caller's company.
    """
    if user.role == User.Role.HR:
        return (
            User.objects.filter(company=user.company, is_active=True, is_superuser=False)
            .order_by("full_name", "email")
        )
    return User.objects.filter(pk=user.pk)


def used_days_map(*, company, employee_ids, type_ids, year):
    """{(employee_id, request_type_id): approved-request count} for the year.

    The year a leave belongs to is the year it was SUBMITTED (approved requests
    always carry ``submitted_at``); a directly-created approved row without one
    falls back to ``created_at`` so the count is never silently zero.
    """
    if not employee_ids or not type_ids:
        return {}
    approved = (
        EmployeeRequest.objects.filter(
            company=company,
            requester_id__in=employee_ids,
            request_type_id__in=type_ids,
            status=EmployeeRequest.Status.APPROVED,
        )
        .filter(
            Q(submitted_at__year=year)
            | Q(submitted_at__isnull=True, created_at__year=year)
        )
        .values("requester_id", "request_type_id")
        .annotate(total=Count("id"))
    )
    return {(row["requester_id"], row["request_type_id"]): row["total"] for row in approved}


def _days(value):
    """Decimal -> JSON number, or None when unconfigured."""
    return None if value is None else float(value)


def _profile_numbers(employee_ids):
    if not employee_ids:
        return {}
    return {
        profile.user_id: profile.employee_number
        for profile in EmployeeProfile.objects.filter(user_id__in=employee_ids)
    }


def _history_map(balance_ids):
    """{balance_id: [adjustment, ...]} bounded, newest first, one query."""
    if not balance_ids:
        return {}
    grouped = {}
    rows = (
        LeaveBalanceAdjustment.objects.filter(balance_id__in=balance_ids)
        .select_related("actor")
        .order_by("-created_at", "-id")
    )
    for adjustment in rows:
        bucket = grouped.setdefault(adjustment.balance_id, [])
        if len(bucket) < HISTORY_LIMIT:
            bucket.append(adjustment)
    return grouped


def _history_entry(adjustment):
    return {
        "id": str(adjustment.pk),
        "actor_name": adjustment.actor.full_name or adjustment.actor.email,
        "reason": adjustment.reason,
        "entitled_delta": _days(adjustment.entitled_after - adjustment.entitled_before),
        "carried_delta": _days(adjustment.carried_after - adjustment.carried_before),
        "created_at": adjustment.created_at.isoformat(),
    }


def _row(*, employee, employee_number, request_type, year, balance, used, history):
    entitled = balance.entitled_days if balance is not None else None
    carried = balance.carried_over_days if balance is not None else None
    remaining = None
    if balance is not None:
        remaining = balance.entitled_days + balance.carried_over_days - used
    return {
        "employee_id": str(employee.pk),
        "employee_name": employee.full_name or employee.email,
        "employee_email": employee.email,
        "employee_number": employee_number,
        "request_type_id": request_type.pk,
        "request_type_name": request_type.name,
        "year": year,
        "entitled_days": _days(entitled),
        "carried_over_days": _days(carried),
        "used_days": used,
        "remaining_days": _days(remaining),
        "version": balance.version if balance is not None else 0,
        "balance_id": str(balance.pk) if balance is not None else None,
        "is_configured": balance is not None,
        "history": [_history_entry(item) for item in history],
    }


def build_balance_payload(*, user, year):
    """The whole GET /leave-balances body for one caller and one year."""
    company = user.company
    types = list(leave_types(company))
    if not types:
        return {
            "year": year,
            "leave_types": [],
            "rows": [],
            "tracked": False,
            "note": NO_LEAVE_TYPES_NOTE,
        }
    employees = list(scoped_employees(user))
    emp_ids = [emp.pk for emp in employees]
    type_ids = [t.pk for t in types]

    balances = {
        (row.employee_id, row.request_type_id): row
        for row in LeaveBalance.objects.filter(
            company=company, year=year, employee_id__in=emp_ids, request_type_id__in=type_ids
        )
    }
    used = used_days_map(company=company, employee_ids=emp_ids, type_ids=type_ids, year=year)
    numbers = _profile_numbers(emp_ids)
    history = _history_map([b.pk for b in balances.values()])

    rows = []
    for employee in employees:
        for request_type in types:
            balance = balances.get((employee.pk, request_type.pk))
            rows.append(
                _row(
                    employee=employee,
                    employee_number=numbers.get(employee.pk),
                    request_type=request_type,
                    year=year,
                    balance=balance,
                    used=used.get((employee.pk, request_type.pk), 0),
                    history=history.get(balance.pk, []) if balance is not None else [],
                )
            )

    return {
        "year": year,
        "leave_types": [{"id": t.pk, "name": t.name} for t in types],
        "rows": rows,
        "tracked": True,
        "note": None,
        "used_days_note": USED_DAYS_NOTE,
    }


def idempotency_fingerprint(
    *, key, employee_id, request_type_id, year, entitled_days, carried_over_days, version
):
    """Return (key_hash, payload_hash) for the adjust idempotency table."""
    key_hash = sha256(key.encode()).hexdigest()
    payload_hash = sha256(
        f"{employee_id}:{request_type_id}:{year}:{entitled_days}:{carried_over_days}:{version}".encode()
    ).hexdigest()
    return key_hash, payload_hash


def row_for(*, balance, employee, employee_number, request_type, year):
    """Rebuild ONE read row (used by the adjust response snapshot)."""
    used = used_days_map(
        company=balance.company,
        employee_ids=[employee.pk],
        type_ids=[request_type.pk],
        year=year,
    ).get((employee.pk, request_type.pk), 0)
    history = _history_map([balance.pk]).get(balance.pk, [])
    return _row(
        employee=employee,
        employee_number=employee_number,
        request_type=request_type,
        year=year,
        balance=balance,
        used=used,
        history=history,
    )


def adjust_balance(
    *,
    hr_user,
    employee,
    request_type,
    year,
    entitled_days,
    carried_over_days,
    version,
    reason,
    key_hash,
    payload_hash,
):
    """Set one (employee, leave type, year) entitlement under one lock.

    HR only (the view enforces the role; this service re-checks company scope).
    The employee row is the serialization point, so two adjustments for the same
    employee cannot interleave; the idempotency lookup AND insert run inside the
    same locked transaction, mirroring reqs.decision_services. Raises
    VersionConflict (409), IdempotencyConflict (409), or IdempotencyReplay.
    """
    if employee.company_id != hr_user.company_id:
        # Defense in depth: the view resolves the employee inside the caller's
        # company, so this can only fire on a stale object.
        raise LookupError("out_of_scope")

    with transaction.atomic():
        # Serialization point: the employee this balance belongs to.
        User.objects.select_for_update().get(pk=employee.pk)

        # Authorization is re-read inside the lock: an HR deactivated between
        # authentication and this transaction must not write.
        if hr_user.role != User.Role.HR or not hr_user.is_active:
            raise LookupError("out_of_scope")

        existing = LeaveBalanceIdempotencyRecord.objects.filter(
            key_hash=key_hash, user=hr_user
        ).first()
        if existing is not None:
            if existing.payload_hash == payload_hash:
                raise IdempotencyReplay(existing.response_snapshot)
            raise IdempotencyConflict()

        balance = (
            LeaveBalance.objects.select_for_update()
            .filter(
                company=hr_user.company,
                employee=employee,
                request_type=request_type,
                year=year,
            )
            .first()
        )
        current_version = balance.version if balance is not None else 0
        if current_version != version:
            raise VersionConflict(current_version)

        if balance is None:
            balance = LeaveBalance.objects.create(
                company=hr_user.company,
                employee=employee,
                request_type=request_type,
                year=year,
                entitled_days=entitled_days,
                carried_over_days=carried_over_days,
                version=1,
                updated_by=hr_user,
            )
            entitled_before = carried_before = Decimal("0")
        else:
            entitled_before = balance.entitled_days
            carried_before = balance.carried_over_days
            balance.entitled_days = entitled_days
            balance.carried_over_days = carried_over_days
            balance.version += 1
            balance.updated_by = hr_user
            balance.save(
                update_fields=[
                    "entitled_days",
                    "carried_over_days",
                    "version",
                    "updated_by",
                    "updated_at",
                ]
            )

        LeaveBalanceAdjustment.objects.create(
            balance=balance,
            company=hr_user.company,
            actor=hr_user,
            entitled_before=entitled_before,
            entitled_after=entitled_days,
            carried_before=carried_before,
            carried_after=carried_over_days,
            reason=reason,
        )
        AuditEvent.objects.create(
            company=hr_user.company,
            actor=hr_user,
            subject=employee,
            action="leave_balance_adjusted",
            request_id="",
            before={
                "entitled_days": str(entitled_before),
                "carried_over_days": str(carried_before),
                "version": version,
            },
            after={
                "entitled_days": str(entitled_days),
                "carried_over_days": str(carried_over_days),
                "version": balance.version,
                "request_type_id": request_type.pk,
                "year": year,
                "reason": reason[:500],
            },
        )

        snapshot = {
            "data": row_for(
                balance=balance,
                employee=employee,
                employee_number=_profile_numbers([employee.pk]).get(employee.pk),
                request_type=request_type,
                year=year,
            )
        }

        # Idempotency record committed atomically with the write: the DB-level
        # (key_hash, user) constraint arbitrates concurrent same-key writers.
        try:
            with transaction.atomic():
                LeaveBalanceIdempotencyRecord.objects.create(
                    key_hash=key_hash,
                    payload_hash=payload_hash,
                    response_snapshot=snapshot,
                    company=hr_user.company,
                    user=hr_user,
                )
        except IntegrityError:
            winner = LeaveBalanceIdempotencyRecord.objects.filter(
                key_hash=key_hash, user=hr_user
            ).first()
            if winner is None or winner.payload_hash != payload_hash:
                raise IdempotencyConflict() from None
            raise IdempotencyReplay(winner.response_snapshot)

    return snapshot["data"]
