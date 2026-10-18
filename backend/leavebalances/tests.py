"""Leave-balance tests (أرصدة الإجازات).

The required coverage, each exercised through the real endpoints/services:

  (a) HR reads every employee's balance in the company
  (b) an employee reads only their own balances
  (c) an employee cannot adjust (uniform 404 for a non-HR caller)
  (d) a stale version is refused (409), never silently applied
  (e) the used-days figure matches the APPROVED leave requests

plus: the derived (never stored) used figure, remaining arithmetic, the
append-only adjustment ledger + AuditEvent, idempotent replay, the mandatory
Idempotency-Key and reason, protected-field rejection, foreign-company /
non-leave-type rejection, the honest no-leave-types state, and 401.
"""
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import AuditEvent, Company, EmployeeProfile, User
from leavebalances.models import (
    LeaveBalance,
    LeaveBalanceAdjustment,
    LeaveBalanceIdempotencyRecord,
)
from reqs.decision_services import decide_request
from reqs.models import EmployeeRequest, RequestType
from reqs.services import create_draft
from reqs.submission_services import submit_request
from tenants.context import default_company

pytestmark = pytest.mark.django_db

LIST_URL = "/api/v1/leave-balances"
ADJUST_URL = "/api/v1/leave-balances/adjust"
LEAVE_TYPE = "إجازة اعتيادية"
NON_LEAVE_TYPE = "تصحيح سجل وقت"


def _user(email, role=User.Role.EMPLOYEE, company=None, active=True, full_name=""):
    return User.objects.create_user(
        company=company or default_company(),
        email=email,
        password="pw-1234567890",
        role=role,
        is_active=active,
        full_name=full_name,
    )


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    client.cookies["heya_fawda_csrftoken"] = "test-csrf-token"
    return client


def _leave_type(name=LEAVE_TYPE, company=None):
    # The seed migration (reqs 0008) already creates «إجازة اعتيادية» / «إجازة مرضية»
    # / «تصحيح سجل وقت» for the default company, so reuse them rather than
    # colliding with the per-company unique constraint.
    request_type, _ = RequestType.objects.get_or_create(
        company=company or default_company(),
        name=name,
        defaults={"requires_manager_approval": True, "requires_hr_approval": False},
    )
    return request_type


def _approved_request(requester, request_type, submitted_at, title="إجازة"):
    """An APPROVED request created directly (a fixed submitted year)."""
    return EmployeeRequest.objects.create(
        company=requester.company,
        requester=requester,
        request_type=request_type,
        title=title,
        status=EmployeeRequest.Status.APPROVED,
        submitted_at=submitted_at,
    )


def _approve_via_pipeline(requester, request_type, manager, title="إجازة"):
    """Walk the REAL flow: draft -> submit -> manager approve."""
    draft = create_draft(requester=requester, request_type=request_type, title=title)
    submitted = submit_request(requester=requester, request_obj=draft, version=draft.version)
    return decide_request(
        reviewer=manager,
        request_obj=submitted,
        action="approve",
        comment="",
        version=submitted.version,
        key_hash=uuid4().hex,
        payload_hash=uuid4().hex,
    )


class Fixture:
    """A company with HR, a manager, and two employees under that manager."""

    def __init__(self):
        self.company = default_company()
        self.hr = _user("hr@lb.test", role=User.Role.HR, full_name="HR")
        self.manager = _user("mgr@lb.test", role=User.Role.MANAGER, full_name="Manager")
        self.employee = _user("emp@lb.test", full_name="Employee One")
        self.employee2 = _user("emp2@lb.test", full_name="Employee Two")
        self.outsider = _user("out@lb.test", full_name="Outsider")
        EmployeeProfile.objects.create(
            company=self.company, user=self.employee, manager=self.manager, employee_number="E-001"
        )
        EmployeeProfile.objects.create(
            company=self.company, user=self.employee2, manager=self.manager, employee_number="E-002"
        )
        self.leave = _leave_type()
        self.other_leave = _leave_type(name="إجازة مرضية")
        self.non_leave = _leave_type(name=NON_LEAVE_TYPE)


def _row(payload, employee, request_type):
    for row in payload["data"]["rows"]:
        if row["employee_id"] == str(employee.pk) and row["request_type_id"] == request_type.pk:
            return row
    return None


def _adjust(client, *, employee, request_type, year, entitled, carried, version, reason="تصحيح", key=None):
    return client.post(
        ADJUST_URL,
        {
            "employee_id": str(employee.pk),
            "request_type_id": request_type.pk,
            "year": year,
            "entitled_days": str(entitled),
            "carried_over_days": str(carried),
            "version": version,
            "reason": reason,
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY=key or uuid4().hex,
    )


# --- (a) HR reads everyone ----------------------------------------------------


def test_hr_reads_every_employees_balance(db):
    fx = Fixture()
    client = _client(fx.hr)
    response = client.get(f"{LIST_URL}?year=2026")
    assert response.status_code == status.HTTP_200_OK, response.data
    payload = response.data

    # Every leave type is offered and both employees have a row for each.
    assert payload["data"]["tracked"] is True
    assert {t["name"] for t in payload["data"]["leave_types"]} == {LEAVE_TYPE, "إجازة مرضية"}
    # the non-leave type is NOT a leave type
    assert NON_LEAVE_TYPE not in {t["name"] for t in payload["data"]["leave_types"]}
    for employee in (fx.employee, fx.employee2):
        for leave_type in (fx.leave, fx.other_leave):
            assert _row(payload, employee, leave_type) is not None


# --- (b) an employee reads only their own ------------------------------------


def test_employee_reads_only_their_own_balance(db):
    fx = Fixture()
    client = _client(fx.employee)
    response = client.get(f"{LIST_URL}?year=2026")
    assert response.status_code == status.HTTP_200_OK, response.data
    rows = response.data["data"]["rows"]
    assert rows, "the employee sees their own rows"
    assert {row["employee_id"] for row in rows} == {str(fx.employee.pk)}
    assert all(row["employee_id"] != str(fx.employee2.pk) for row in rows)


def test_manager_reads_only_their_own_too(db):
    # The owner's rule is HR=everyone, everyone else=own — a manager included.
    fx = Fixture()
    response = _client(fx.manager).get(f"{LIST_URL}?year=2026")
    rows = response.data["data"]["rows"]
    assert {row["employee_id"] for row in rows} == {str(fx.manager.pk)}


# --- (c) an employee cannot adjust -------------------------------------------


def test_employee_cannot_adjust(db):
    fx = Fixture()
    response = _adjust(
        _client(fx.employee),
        employee=fx.employee,
        request_type=fx.leave,
        year=2026,
        entitled=21,
        carried=0,
        version=0,
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND, response.data
    assert not LeaveBalance.objects.exists()


def test_manager_cannot_adjust_either(db):
    fx = Fixture()
    response = _adjust(
        _client(fx.manager),
        employee=fx.employee,
        request_type=fx.leave,
        year=2026,
        entitled=21,
        carried=0,
        version=0,
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert not LeaveBalance.objects.exists()


# --- (d) a stale version is refused ------------------------------------------


def test_stale_version_is_refused(db):
    fx = Fixture()
    client = _client(fx.hr)

    created = _adjust(
        client, employee=fx.employee, request_type=fx.leave, year=2026, entitled=21, carried=0, version=0
    )
    assert created.status_code == status.HTTP_200_OK, created.data
    assert created.data["data"]["version"] == 1

    # A second write that still believes version 0 (it did not see the first).
    stale = _adjust(
        client, employee=fx.employee, request_type=fx.leave, year=2026, entitled=30, carried=5, version=0
    )
    assert stale.status_code == status.HTTP_409_CONFLICT, stale.data
    assert stale.data["error"]["code"] == "version_conflict"
    # The stale write did NOT win: the stored values are still the first write's.
    balance = LeaveBalance.objects.get(employee=fx.employee, request_type=fx.leave, year=2026)
    assert balance.entitled_days == Decimal("21")
    assert balance.version == 1

    # The correct version is accepted and bumps the row.
    fresh = _adjust(
        client, employee=fx.employee, request_type=fx.leave, year=2026, entitled=30, carried=5, version=1
    )
    assert fresh.status_code == status.HTTP_200_OK, fresh.data
    balance.refresh_from_db()
    assert balance.entitled_days == Decimal("30")
    assert balance.carried_over_days == Decimal("5")
    assert balance.version == 2


# --- (e) used days match the approved requests -------------------------------


def test_used_days_match_approved_requests(db):
    fx = Fixture()
    # Two approved through the REAL flow, one still a draft, one rejected.
    _approve_via_pipeline(fx.employee, fx.leave, fx.manager, title="عطلة 1")
    _approve_via_pipeline(fx.employee, fx.leave, fx.manager, title="عطلة 2")
    create_draft(requester=fx.employee, request_type=fx.leave, title="مسودة")
    _approved_request(fx.employee, fx.other_leave, datetime(2026, 3, 1, tzinfo=dt_timezone.utc))
    EmployeeRequest.objects.create(
        company=fx.company,
        requester=fx.employee,
        request_type=fx.leave,
        title="مرفوض",
        status=EmployeeRequest.Status.REJECTED,
        submitted_at=datetime(2026, 2, 1, tzinfo=dt_timezone.utc),
    )

    payload = _client(fx.hr).get(f"{LIST_URL}?year=2026").data
    annual = _row(payload, fx.employee, fx.leave)
    sick = _row(payload, fx.employee, fx.other_leave)
    assert annual["used_days"] == 2  # only the two APPROVED annual requests
    assert sick["used_days"] == 1


def test_used_days_respects_the_year(db):
    fx = Fixture()
    _approved_request(fx.employee, fx.leave, datetime(2024, 5, 1, tzinfo=dt_timezone.utc))
    _approved_request(fx.employee, fx.leave, datetime(2026, 5, 1, tzinfo=dt_timezone.utc))

    payload_2026 = _client(fx.hr).get(f"{LIST_URL}?year=2026").data
    payload_2024 = _client(fx.hr).get(f"{LIST_URL}?year=2024").data
    assert _row(payload_2026, fx.employee, fx.leave)["used_days"] == 1
    assert _row(payload_2024, fx.employee, fx.leave)["used_days"] == 1


def test_used_days_is_derived_not_stored(db):
    """Approving a NEW request moves used_days with no balance write at all."""
    fx = Fixture()
    client = _client(fx.hr)
    _adjust(client, employee=fx.employee, request_type=fx.leave, year=2026, entitled=21, carried=0, version=0)
    before = _row(client.get(f"{LIST_URL}?year=2026").data, fx.employee, fx.leave)
    assert before["used_days"] == 0 and before["remaining_days"] == 21.0

    _approve_via_pipeline(fx.employee, fx.leave, fx.manager)

    after = _row(client.get(f"{LIST_URL}?year=2026").data, fx.employee, fx.leave)
    assert after["used_days"] == 1
    assert after["remaining_days"] == 20.0
    # The balance row itself was NOT touched by the approval.
    balance = LeaveBalance.objects.get(employee=fx.employee, request_type=fx.leave, year=2026)
    assert balance.version == 1


def test_remaining_uses_entitlement_plus_carry_over_minus_used(db):
    fx = Fixture()
    client = _client(fx.hr)
    _adjust(client, employee=fx.employee, request_type=fx.leave, year=2026, entitled=21, carried=5, version=0)
    _approved_request(fx.employee, fx.leave, datetime(2026, 6, 1, tzinfo=dt_timezone.utc))
    row = _row(client.get(f"{LIST_URL}?year=2026").data, fx.employee, fx.leave)
    assert row["entitled_days"] == 21.0
    assert row["carried_over_days"] == 5.0
    assert row["used_days"] == 1
    assert row["remaining_days"] == 25.0


# --- adjustment: audit, ledger, idempotency, validation ----------------------


def test_hr_adjust_creates_row_ledger_and_audit(db):
    fx = Fixture()
    response = _adjust(
        _client(fx.hr),
        employee=fx.employee,
        request_type=fx.leave,
        year=2026,
        entitled=21,
        carried=3,
        version=0,
        reason="استحقاق سنوي",
    )
    assert response.status_code == status.HTTP_200_OK, response.data
    row = response.data["data"]
    assert row["employee_id"] == str(fx.employee.pk)
    assert row["is_configured"] is True
    assert row["version"] == 1
    assert row["entitled_days"] == 21.0 and row["carried_over_days"] == 3.0

    balance = LeaveBalance.objects.get(employee=fx.employee, request_type=fx.leave, year=2026)
    assert balance.company == fx.company
    assert balance.updated_by == fx.hr

    ledger = LeaveBalanceAdjustment.objects.get(balance=balance)
    assert ledger.actor == fx.hr
    assert ledger.reason == "استحقاق سنوي"
    assert ledger.entitled_before == Decimal("0") and ledger.entitled_after == Decimal("21")

    assert AuditEvent.objects.filter(
        action="leave_balance_adjusted", actor=fx.hr, subject=fx.employee
    ).exists()
    # The read row carries the ledger as history (Recorded by / reason).
    assert row["history"] and row["history"][0]["actor_name"] == "HR"
    assert row["history"][0]["entitled_delta"] == 21.0


def test_adjust_is_idempotent_on_replay(db):
    fx = Fixture()
    client = _client(fx.hr)
    key = "same-key-1"
    first = _adjust(client, employee=fx.employee, request_type=fx.leave, year=2026, entitled=21, carried=0, version=0, key=key)
    assert first.status_code == status.HTTP_200_OK
    # Same key, same payload: replay the winner's response, no second write.
    replay = _adjust(client, employee=fx.employee, request_type=fx.leave, year=2026, entitled=21, carried=0, version=0, key=key)
    assert replay.status_code == status.HTTP_200_OK
    assert replay.data == first.data
    assert LeaveBalanceAdjustment.objects.count() == 1
    assert LeaveBalanceIdempotencyRecord.objects.count() == 1

    # Same key, different payload: conflict, still one write.
    conflict = _adjust(client, employee=fx.employee, request_type=fx.leave, year=2026, entitled=99, carried=0, version=1, key=key)
    assert conflict.status_code == status.HTTP_409_CONFLICT
    assert conflict.data["error"]["code"] == "idempotency_conflict"
    assert LeaveBalanceAdjustment.objects.count() == 1


def test_adjust_requires_idempotency_key(db):
    fx = Fixture()
    client = _client(fx.hr)
    response = client.post(
        ADJUST_URL,
        {
            "employee_id": str(fx.employee.pk),
            "request_type_id": fx.leave.pk,
            "year": 2026,
            "entitled_days": "21",
            "carried_over_days": "0",
            "version": 0,
            "reason": "x",
        },
        format="json",
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert response.data["error"]["code"] == "idempotency_key_required"
    assert not LeaveBalance.objects.exists()


def test_adjust_requires_a_reason(db):
    fx = Fixture()
    response = _adjust(
        _client(fx.hr), employee=fx.employee, request_type=fx.leave, year=2026, entitled=21, carried=0, version=0, reason="   "
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "reason" in response.data["error"]["fields"]


def test_adjust_rejects_used_days_as_a_protected_field(db):
    fx = Fixture()
    client = _client(fx.hr)
    response = client.post(
        ADJUST_URL,
        {
            "employee_id": str(fx.employee.pk),
            "request_type_id": fx.leave.pk,
            "year": 2026,
            "entitled_days": "21",
            "carried_over_days": "0",
            "version": 0,
            "reason": "x",
            "used_days": 5,  # derived, never set by hand
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY=uuid4().hex,
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "used_days" in response.data["error"]["fields"]


def test_adjust_rejects_negative_days(db):
    fx = Fixture()
    response = _adjust(
        _client(fx.hr), employee=fx.employee, request_type=fx.leave, year=2026, entitled=-1, carried=0, version=0
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


def test_adjust_rejects_foreign_employee_and_non_leave_type(db):
    fx = Fixture()
    client = _client(fx.hr)
    # Another company's employee is not resolvable inside the caller's company.
    other_company = User.objects.create_user(
        company=Company.objects.create(slug="other-co", name="Other Co"),
        email="foreign@lb.test",
        password="pw-1234567890",
    )
    foreign = _adjust(client, employee=other_company, request_type=fx.leave, year=2026, entitled=1, carried=0, version=0)
    assert foreign.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "employee_id" in foreign.data["error"]["fields"]

    # A non-leave request type is not a leave type.
    bad_type = _adjust(client, employee=fx.employee, request_type=fx.non_leave, year=2026, entitled=1, carried=0, version=0)
    assert bad_type.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "request_type_id" in bad_type.data["error"]["fields"]
    assert not LeaveBalance.objects.exists()


# --- honest states ------------------------------------------------------------


def test_read_with_no_leave_types_is_honest(db):
    fx = Fixture()
    RequestType.objects.all().delete()
    payload = _client(fx.hr).get(f"{LIST_URL}?year=2026").data
    assert payload["data"]["tracked"] is False
    assert payload["data"]["rows"] == []
    assert "leave request types" in payload["data"]["note"]


def test_read_reports_unconfigured_rows_without_fabricating(db):
    """No balance row yet: entitled is null (not a fake 0), used is still real."""
    fx = Fixture()
    _approved_request(fx.employee, fx.leave, datetime(2026, 6, 1, tzinfo=dt_timezone.utc))
    row = _row(_client(fx.hr).get(f"{LIST_URL}?year=2026").data, fx.employee, fx.leave)
    assert row["is_configured"] is False
    assert row["entitled_days"] is None and row["remaining_days"] is None
    assert row["used_days"] == 1


def test_invalid_year_is_422(db):
    fx = Fixture()
    response = _client(fx.hr).get(f"{LIST_URL}?year=not-a-year")
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


def test_read_requires_authentication(db):
    response = APIClient().get(f"{LIST_URL}?year=2026")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED
