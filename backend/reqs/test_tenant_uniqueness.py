"""H30 R2 tests (§2.6 step 5 / §8.1): reqs tenant anchoring.

The schema flips proven here:
  * ``RequestType.name`` uniqueness is PER COMPANY (was global unique=True):
    two companies may both define "Leave"; one company may not.
  * The anchored models (EmployeeRequest, RequestEvent, idempotency records)
    mirror their anchor's company at save time — no creation path can leave
    a row tenant-less or land it in the wrong company.
"""

import pytest
from django.db import IntegrityError, transaction

from accounts.models import Company, User
from reqs.models import (
    CancelIdempotencyRecord,
    DecisionIdempotencyRecord,
    EmployeeRequest,
    RequestEvent,
    RequestType,
    SubmissionIdempotencyRecord,
)
from tenants.context import default_company

pytestmark = pytest.mark.django_db


def _user(email, company=None, role=User.Role.EMPLOYEE):
    return User.objects.create_user(
        company=company or default_company(),
        email=email,
        password="pass-12345678",
        role=role,
    )


def _two_companies():
    company_a = default_company()
    company_b = Company.objects.create(slug="b-co", name="Company B")
    return company_a, company_b


def test_request_type_name_unique_per_company():
    company_a, company_b = _two_companies()
    RequestType.objects.create(company=company_a, name="Annual Leave")
    RequestType.objects.create(company=company_b, name="Annual Leave")  # legal now
    assert RequestType.objects.filter(name="Annual Leave").count() == 2


def test_request_type_name_duplicate_within_one_company_rejected():
    company_a, _company_b = _two_companies()
    RequestType.objects.create(company=company_a, name="Equipment")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            RequestType.objects.create(company=company_a, name="Equipment")


def test_request_type_created_without_company_cannot_exist():
    """RequestType has NO in-row anchor: a creator that forgets company is a
    hard IntegrityError (the hard FK), never a silent tenant-less row."""
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            RequestType.objects.create(name="Anchorless")


def test_employee_request_mirrors_requester_company():
    company_b = Company.objects.create(slug="b2-co", name="Company B2")
    requester = _user("req.b@x.test", company=company_b)
    rt = RequestType.objects.create(company=company_b, name="B Leave")

    request = EmployeeRequest.objects.create(
        requester=requester, request_type=rt, title="No company passed"
    )

    assert request.company == company_b


def test_request_event_mirrors_parent_request_company():
    company_a, company_b = _two_companies()
    requester = _user("req.a@x.test", company=company_a)
    rt = RequestType.objects.create(company=company_a, name="A Leave")
    request = EmployeeRequest.objects.create(
        requester=requester, request_type=rt, title="Parent anchored"
    )

    event = RequestEvent.objects.create(
        request=request, actor=requester, action=RequestEvent.Action.CREATED
    )

    assert event.company == company_a


def test_idempotency_records_mirror_user_company():
    company_a, company_b = _two_companies()
    user_b = _user("idem.b@x.test", company=company_b)

    submission = SubmissionIdempotencyRecord.objects.create(
        key_hash="k1", payload_hash="p1", response_snapshot={}, user=user_b
    )
    decision = DecisionIdempotencyRecord.objects.create(
        key_hash="k2", payload_hash="p2", response_snapshot={}, user=user_b
    )
    cancel = CancelIdempotencyRecord.objects.create(
        key_hash="k3", payload_hash="p3", response_snapshot={}, user=user_b
    )

    assert submission.company == company_b
    assert decision.company == company_b
    assert cancel.company == company_b


def test_request_rows_carry_the_default_company_for_legacy_shapes():
    """Documents the migration contract: rows created BEFORE 0010/0011 had no
    company column at all; the backfill attached them to __default__ and the
    hard FK now makes the anchor mandatory (see the R2 rehearsal)."""
    user = _user("legacy.shape@x.test")
    assert user.company == default_company()
    rt = RequestType.objects.create(company=default_company(), name="Legacy")
    request = EmployeeRequest.objects.create(requester=user, request_type=rt, title="t")
    assert request.company == user.company
