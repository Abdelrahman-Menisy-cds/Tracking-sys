"""Seed the review-advice SCENARIOS so each rule can be seen working.

The rules are already there — overlap against an approved leave, department
coverage, balance sufficiency — but two of them read DATES, and the demo requests
name none («إجازة شتوية», «طلب إجازة اعتيادية لمدة يومين»). Both checks are then
skipped, and the advice says so honestly: «لم تُفحص التعارضات أو تغطية القسم لعدم
ذكر تواريخ». Nothing is broken; there is simply nothing to compare.

This plants rows that DO name their window, plus the approved leaves they must be
compared against, so every rule speaks:

    تعارض   an approved leave for the SAME employee in an overlapping window
    تغطية   a colleague's approved leave inside the same window
    رصيد    a request longer than the remaining balance
    إذن     a non-leave type, which must NOT be measured against leave balance
    نظيف    a control row the assistant should recommend approving

Run on any environment (including the deployed one):

    python manage.py seed_advice_scenarios
    python manage.py seed_advice_scenarios --hr hr@demo.local --clean

The balance year is the request's SUBMISSION year — ``_balance_fact`` reads
``submitted.year``, not the year in the request's text. A balance seeded for
another year is simply not found and the rule reports «لا يوجد رصيد مُعرّف»
instead of the scenario it was meant to exercise.
"""

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from accounts.models import EmployeeProfile
from leavebalances.models import LeaveBalance
from reqs.models import EmployeeRequest, RequestType

FOCUS_EMAILS = ("scenario.a@demo.local", "scenario.b@demo.local")
COLLEAGUE_EMAIL = "scenario.c@demo.local"


class Command(BaseCommand):
    help = "Seed the review-advice scenarios (conflicts, coverage, balance edges)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--hr",
            default="hr@demo.local",
            help="The account whose company is seeded (default: hr@demo.local).",
        )
        parser.add_argument(
            "--clean",
            action="store_true",
            help="Remove previously seeded scenario rows before planting new ones.",
        )

    def handle(self, *args, **options):
        user_model = get_user_model()
        hr = user_model.objects.filter(email=options["hr"]).first()
        if hr is None:
            raise CommandError(f"No account with email {options['hr']!r}.")
        company = hr.company

        if options["clean"]:
            removed, _ = EmployeeRequest.objects.filter(
                company=company, requester__email__in=FOCUS_EMAILS + (COLLEAGUE_EMAIL,)
            ).delete()
            self.stdout.write(f"cleaned {removed} rows")

        annual = RequestType.objects.filter(company=company, name="إجازة اعتيادية").first()
        permission = RequestType.objects.filter(company=company, name="إذن").first()
        if annual is None or permission is None:
            raise CommandError("The company has no «إجازة اعتيادية» / «إذن» request types.")

        department = (
            EmployeeProfile.objects.filter(company=company)
            .exclude(department=None)
            .values_list("department_id", flat=True)
            .first()
        )

        # The year MUST be the current one: the balance rule reads the balance for
        # the request's submission year.
        year = timezone.now().year
        base = date(year, 11, 9)  # a Monday, clear of the existing demo rows

        def employee(email, name):
            person, _ = user_model.objects.get_or_create(
                email=email, defaults={"full_name": name, "company": company, "role": "EMPLOYEE"}
            )
            EmployeeProfile.objects.update_or_create(
                user=person, defaults={"company": company, "department_id": department}
            )
            return person

        def balance(person, entitled):
            LeaveBalance.objects.update_or_create(
                company=company,
                employee=person,
                request_type=annual,
                year=year,
                defaults={"entitled_days": entitled, "carried_over_days": 0},
            )

        def request(person, request_type, title, details, status, hours_ago=0):
            return EmployeeRequest.objects.create(
                company=company,
                requester=person,
                request_type=request_type,
                title=title,
                details=details,
                status=status,
                submitted_at=timezone.now() - timedelta(hours=hours_ago),
                version=1,
            )

        def window(start, end):
            return f"من {start.isoformat()} إلى {end.isoformat()}"

        focus_a = employee(FOCUS_EMAILS[0], "سلمى فؤاد")
        focus_b = employee(FOCUS_EMAILS[1], "نور الدين")
        colleague = employee(COLLEAGUE_EMAIL, "زميل القسم")
        for person in (focus_a, focus_b, colleague):
            balance(person, 3 if person is not colleague else 21)

        seeded = []

        # 1. تعارض — an approved leave the new request runs straight through.
        approved_start, approved_end = base, base + timedelta(days=2)
        request(
            focus_a,
            annual,
            f"إجازة اعتيادية {window(approved_start, approved_end)}",
            f"إجازة معتمدة مسبقًا {window(approved_start, approved_end)}",
            EmployeeRequest.Status.APPROVED,
            hours_ago=72 * 24,
        )
        seeded.append((
            "تعارض",
            request(
                focus_a,
                annual,
                f"إجازة اعتيادية {window(base + timedelta(days=1), base + timedelta(days=3))}",
                f"أطلب إجازة {window(base + timedelta(days=1), base + timedelta(days=3))}",
                EmployeeRequest.Status.PENDING_HR,
                hours_ago=4 * 24,
            ),
        ))

        # 2. تغطية — a colleague away inside the same window.
        colleague_start, colleague_end = base + timedelta(days=1), base + timedelta(days=5)
        request(
            colleague,
            annual,
            f"إجازة اعتيادية {window(colleague_start, colleague_end)}",
            f"إجازة معتمدة {window(colleague_start, colleague_end)}",
            EmployeeRequest.Status.APPROVED,
            hours_ago=48 * 24,
        )
        seeded.append((
            "تغطية",
            request(
                focus_b,
                annual,
                f"إجازة اعتيادية {window(base, base + timedelta(days=2))}",
                f"أطلب إجازة {window(base, base + timedelta(days=2))}",
                EmployeeRequest.Status.PENDING_HR,
                hours_ago=3 * 24,
            ),
        ))

        # 3. رصيد — ten days against a three-day balance.
        long_start = base + timedelta(days=20)
        seeded.append((
            "رصيد",
            request(
                focus_a,
                annual,
                f"إجازة اعتيادية {window(long_start, long_start + timedelta(days=9))}",
                f"أطلب إجازة {window(long_start, long_start + timedelta(days=9))}",
                EmployeeRequest.Status.PENDING_HR,
                hours_ago=2 * 24,
            ),
        ))

        # 4. إذن — not a leave: the balance rule must stay silent, not invent one.
        seeded.append((
            "إذن",
            request(
                focus_b,
                permission,
                f"إذن صباحي {(base + timedelta(days=30)).isoformat()}",
                f"أطلب إذنًا في {(base + timedelta(days=30)).isoformat()}",
                EmployeeRequest.Status.PENDING_HR,
                hours_ago=24,
            ),
        ))

        # 5. نظيف — short, nobody else away, balance in hand: the control row.
        clean_start = base + timedelta(days=40)
        seeded.append((
            "نظيف",
            request(
                focus_b,
                annual,
                f"إجازة اعتيادية {clean_start.isoformat()}",
                f"أطلب إجازة يوم {clean_start.isoformat()}",
                EmployeeRequest.Status.PENDING_HR,
            ),
        ))

        self.stdout.write(self.style.SUCCESS(f"seeded {len(seeded)} scenarios"))
        for name, row in seeded:
            self.stdout.write(f"  {name}: {row.pk}")
