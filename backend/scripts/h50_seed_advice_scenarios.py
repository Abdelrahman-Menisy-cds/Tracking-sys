"""Seed the review-advice SCENARIOS: conflicts, coverage, and balance edges.

The owner asked to try the scenarios by hand and see how the assistant answers.
The checks already exist (``_overlap_fact``, ``_coverage_fact``, ``_balance_fact``)
but two of them need DATES — and the seeded requests name none, so both were
skipped and the advice said so honestly («لم تُذكر تواريخ الطلب، فلم يُفحص التعارض»).

This seeds rows that DO name their dates, together with the approved leaves they
must be compared against, so each scenario produces a real verdict:

  1. تعارض       an approved leave for the SAME employee in an overlapping window
  2. تغطية       colleagues' approved leaves inside the same window
  3. رصيد        a request longer than the remaining balance
  4. عطلة        a request whose window contains a public holiday
  5. نظيف        a clean, well-covered request (the control)

Run:
    DJANGO_USE_SQLITE=1 .venv/bin/python manage.py shell \
        -c "exec(open('scripts/h50_seed_advice_scenarios.py').read())"
"""

import json
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone

from accounts.models import EmployeeProfile
from leavebalances.models import LeaveBalance
from reqs.models import EmployeeRequest, RequestType

U = get_user_model()
HR = U.objects.get(email="hr@demo.local")
COMPANY = HR.company

ANNUAL = RequestType.objects.get(company=COMPANY, name="إجازة اعتيادية")
PERMISSION = RequestType.objects.get(company=COMPANY, name="إذن")

# A window far enough out that it cannot collide with the existing demo rows.
# The year must be the CURRENT one: _balance_fact reads the balance for the
# request's SUBMISSION year (submitted.year), not the year in its text — a
# balance seeded for another year is simply not found, and the rule then reports
# «لا يوجد رصيد مُعرّف» instead of the scenario it was meant to exercise.
YEAR = timezone.now().year
BASE = date(YEAR, 11, 9)  # a Monday, well clear of the existing demo rows


def _iso(day):
    return day.isoformat()


def _request(employee, request_type, title, details, status, days_ago=0):
    row = EmployeeRequest.objects.create(
        company=COMPANY,
        requester=employee,
        request_type=request_type,
        title=title,
        details=details,
        status=status,
        submitted_at=timezone.now() - timedelta(hours=days_ago),
        version=1,
    )
    return row


def _balance(employee, entitled):
    LeaveBalance.objects.update_or_create(
        company=COMPANY,
        employee=employee,
        request_type=ANNUAL,
        year=YEAR,
        defaults={"entitled_days": entitled, "carried_over_days": 0},
    )


seeded = []

# ---------------------------------------------------------------------------
# The two employees this scenario set is built around. Each gets a department
# and a balance so coverage and the balance rule both have something to read.
# ---------------------------------------------------------------------------
DEPARTMENT_A = EmployeeProfile.objects.filter(company=COMPANY).exclude(department=None).first().department
FOCUS = []
for email, name in (("scenario.a@demo.local", "سلمى فؤاد"), ("scenario.b@demo.local", "نور الدين")):
    employee, _ = U.objects.get_or_create(
        email=email, defaults={"full_name": name, "company": COMPANY, "role": "EMPLOYEE"}
    )
    EmployeeProfile.objects.update_or_create(
        user=employee, defaults={"company": COMPANY, "department": DEPARTMENT_A}
    )
    _balance(employee, entitled=3)
    FOCUS.append(employee)

# A colleague in the SAME department: their approved leave is what makes the
# coverage rule speak (it counts how much of the team is away at once).
COLLEAGUE, _ = U.objects.get_or_create(
    email="scenario.c@demo.local",
    defaults={"full_name": "زميل القسم", "company": COMPANY, "role": "EMPLOYEE"},
)
EmployeeProfile.objects.update_or_create(
    user=COLLEAGUE, defaults={"company": COMPANY, "department": DEPARTMENT_A}
)
_balance(COLLEAGUE, entitled=21)


def _describe(start, end):
    return f"من {_iso(start)} إلى {_iso(end)}"


# ---------------------------------------------------------------------------
# 1. تعارض: an APPROVED leave for the same employee, then a new request that
#    runs straight through it. The overlap rule compares against exactly this.
# ---------------------------------------------------------------------------
approved_start, approved_end = BASE, BASE + timedelta(days=2)
_request(
    FOCUS[0],
    ANNUAL,
    f"إجازة اعتيادية {_describe(approved_start, approved_end)}",
    f"إجازة معتمدة مسبقًا {_describe(approved_start, approved_end)}",
    EmployeeRequest.Status.APPROVED,
    days_ago=72,
)
overlap = _request(
    FOCUS[0],
    ANNUAL,
    f"إجازة اعتيادية {_describe(BASE + timedelta(days=1), BASE + timedelta(days=3))}",
    f"أطلب إجازة {_describe(BASE + timedelta(days=1), BASE + timedelta(days=3))}",
    EmployeeRequest.Status.PENDING_HR,
    days_ago=4,
)
seeded.append(("تعارض", overlap))

# ---------------------------------------------------------------------------
# 2. تغطية: the colleague is away inside the same window, so the department is
#    short-handed while this request runs.
# ---------------------------------------------------------------------------
colleague_start, colleague_end = BASE + timedelta(days=1), BASE + timedelta(days=5)
_request(
    COLLEAGUE,
    ANNUAL,
    f"إجازة اعتيادية {_describe(colleague_start, colleague_end)}",
    f"إجازة معتمدة {_describe(colleague_start, colleague_end)}",
    EmployeeRequest.Status.APPROVED,
    days_ago=48,
)
coverage = _request(
    FOCUS[1],
    ANNUAL,
    f"إجازة اعتيادية {_describe(BASE, BASE + timedelta(days=2))}",
    f"أطلب إجازة {_describe(BASE, BASE + timedelta(days=2))}",
    EmployeeRequest.Status.PENDING_HR,
    days_ago=3,
)
seeded.append(("تغطية", coverage))

# ---------------------------------------------------------------------------
# 3. رصيد: ten working days against a three-day balance — the rule must refuse
#    to call this covered.
# ---------------------------------------------------------------------------
long_start = BASE + timedelta(days=20)
long_end = long_start + timedelta(days=9)
long_request = _request(
    FOCUS[0],
    ANNUAL,
    f"إجازة اعتيادية {_describe(long_start, long_end)}",
    f"أطلب إجازة {_describe(long_start, long_end)}",
    EmployeeRequest.Status.PENDING_HR,
    days_ago=2,
)
seeded.append(("رصيد", long_request))

# ---------------------------------------------------------------------------
# 4. إذن: not a leave, so the balance rule must stay silent rather than invent
#    an entitlement — the control for the rule's own scoping.
# ---------------------------------------------------------------------------
permission = _request(
    FOCUS[1],
    PERMISSION,
    f"إذن صباحي {_iso(BASE + timedelta(days=30))}",
    f"أطلب إذنًا في {_iso(BASE + timedelta(days=30))}",
    EmployeeRequest.Status.PENDING_HR,
    days_ago=1,
)
seeded.append(("إذن", permission))

# ---------------------------------------------------------------------------
# 5. نظيف: a short request, nobody else away, balance well in hand — the
#    control case the assistant should recommend approving.
# ---------------------------------------------------------------------------
clean_start = BASE + timedelta(days=40)
clean_request = _request(
    FOCUS[1],
    ANNUAL,
    f"إجازة اعتيادية {_iso(clean_start)}",
    f"أطلب إجازة يوم {_iso(clean_start)}",
    EmployeeRequest.Status.PENDING_HR,
)
seeded.append(("نظيف", clean_request))

print("seeded", len(seeded))
print(json.dumps([{"scenario": name, "id": str(row.pk)} for name, row in seeded], ensure_ascii=False))
