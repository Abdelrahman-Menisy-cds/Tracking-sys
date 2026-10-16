"""H30 R2 tests (§2.6 step 6): timesheets tenant anchoring.

Timesheet mirrors employee.company; TimeEntry and TimesheetEvent mirror the
parent sheet; the idempotency records mirror the acting user — all at save
time, so no creation path can leave a row tenant-less.
"""

import datetime

import pytest
from django.utils import timezone

from accounts.models import Company, User
from tenants.context import default_company
from timesheets.models import (
    Timesheet,
    TimesheetCreateIdempotencyRecord,
    TimesheetDecisionIdempotencyRecord,
    TimesheetEvent,
    TimesheetSubmitIdempotencyRecord,
)

pytestmark = pytest.mark.django_db


def _monday():
    today = timezone.now().date()
    return today - datetime.timedelta(days=today.weekday())


def _user(email, company=None):
    return User.objects.create_user(
        company=company or default_company(), email=email, password="pass-12345678"
    )


def test_timesheet_mirrors_employee_company():
    company_b = Company.objects.create(slug="ts-b", name="TS B")
    employee = _user("ts.b@x.test", company=company_b)

    sheet = Timesheet.objects.create(employee=employee, week_start=_monday())

    assert sheet.company == company_b


def test_timeentry_and_event_mirror_parent_sheet_company():
    company_b = Company.objects.create(slug="ts-c", name="TS C")
    employee = _user("ts.c@x.test", company=company_b)
    sheet = Timesheet.objects.create(employee=employee, week_start=_monday())

    entry = sheet.entries.create(work_date=_monday(), duration_minutes=60)
    event = TimesheetEvent.objects.create(
        timesheet=sheet, actor=employee, action=TimesheetEvent.Action.CREATED
    )

    assert entry.company == company_b
    assert event.company == company_b


def test_timesheet_idempotency_records_mirror_user_company():
    company_b = Company.objects.create(slug="ts-d", name="TS D")
    user_b = _user("ts.d@x.test", company=company_b)

    submit = TimesheetSubmitIdempotencyRecord.objects.create(
        key_hash="k1", payload_hash="p1", response_snapshot={}, user=user_b
    )
    create = TimesheetCreateIdempotencyRecord.objects.create(
        key_hash="k2", payload_hash="p2", response_snapshot={}, user=user_b
    )
    decision = TimesheetDecisionIdempotencyRecord.objects.create(
        key_hash="k3", payload_hash="p3", response_snapshot={}, user=user_b
    )

    assert submit.company == company_b
    assert create.company == company_b
    assert decision.company == company_b
