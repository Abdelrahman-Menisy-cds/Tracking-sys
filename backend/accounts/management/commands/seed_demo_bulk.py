"""Add VOLUME to the demo company so every screen has something to page through.

``seed_demo_company`` builds a small tenant (8 people, 19 requests) — enough to
prove the wiring, thin enough that the tables, filters, pagination and reports
look empty. This adds bulk on top of it and is idempotent: every row is created
through get_or_create on a deterministic key, so re-running tops up rather than
duplicating.

    python manage.py seed_demo_bulk          # default volume
    python manage.py seed_demo_bulk --scale 2

Real rows of the demo company only; every one carries company=.
"""
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

DEMO_PASSWORD = "demo1234"
COMPANY_SLUG = "demo-company"

FIRST_NAMES = (
    "محمد", "أحمد", "محمود", "مصطفى", "كريم", "عمرو", "يوسف", "حسن", "إبراهيم", "خالد",
    "عمر", "طارق", "زياد", "شريف", "وليد", "مينا", "باسم", "سامح", "رامي", "هشام",
)
LAST_NAMES = (
    "عبد الله", "السيد", "محمود", "حسين", "فؤاد", "منصور", "حمدي", "شريف", "عبد الرحمن",
    "سعيد", "مصطفى", "الدين", "فتحي", "رشاد", "كامل", "نجيب", "شاكر", "عوض", "سالم", "فهمي",
)
REQUEST_STATUSES = (
    "DRAFT", "PENDING_MANAGER", "PENDING_HR", "APPROVED", "REJECTED", "RETURNED", "CANCELLED",
)
SHEET_STATUSES = ("DRAFT", "SUBMITTED", "APPROVED", "RETURNED")


class Command(BaseCommand):
    help = "Add volume to the demo company (people, requests, timesheets, holidays)."

    def add_arguments(self, parser):
        parser.add_argument("--scale", type=int, default=1, help="multiplier (default 1)")

    def handle(self, *args, **options):
        from accounts.models import Company, Department, EmployeeProfile
        from holidays.models import PublicHoliday
        from reqs.models import EmployeeRequest, RequestType
        from timesheets.models import TimeEntry, Timesheet

        scale = max(1, options["scale"])
        people_target = 24 * scale
        user_model = get_user_model()

        company = Company.objects.filter(slug=COMPANY_SLUG).first()
        if company is None:
            self.stderr.write("لا توجد شركة ديمو — شغّل seed_demo_company الأول.")
            return

        departments = list(Department.objects.filter(company=company).order_by("id"))
        types = list(RequestType.objects.filter(company=company))
        hr = user_model.objects.filter(company=company, email="hr@demo.local").first()
        manager = user_model.objects.filter(company=company, email="manager@demo.local").first()
        if not (departments and types and hr):
            self.stderr.write("شركة الديمو ناقصة — شغّل seed_demo_company الأول.")
            return

        counts = {"people": 0, "requests": 0, "sheets": 0, "entries": 0, "holidays": 0}

        with transaction.atomic():
            # ---- people -------------------------------------------------
            created_people = []
            for i in range(1, people_target + 1):
                email = f"emp{i}@demo.local"
                full_name = f"{FIRST_NAMES[i % len(FIRST_NAMES)]} {LAST_NAMES[i % len(LAST_NAMES)]}"
                user, made = user_model.objects.get_or_create(
                    email=email, defaults={"company": company}
                )
                if made:
                    counts["people"] += 1
                user.company = company
                user.full_name = full_name
                user.role = "EMPLOYEE"
                user.is_active = True
                user.set_password(DEMO_PASSWORD)
                user.save()
                dept = departments[i % len(departments)]
                fields = {"company": company, "user": user, "department": dept, "employee_number": f"DEMO-E{i}"}
                if manager is not None:
                    fields["manager"] = manager
                try:
                    EmployeeProfile.objects.update_or_create(user=user, defaults=fields)
                except Exception:
                    pass
                created_people.append(user)

            # ---- requests ------------------------------------------------
            for i, employee in enumerate(created_people, start=1):
                for j in range(4 + (i % 4)):
                    status_value = REQUEST_STATUSES[(i + j) % len(REQUEST_STATUSES)]
                    _, made = EmployeeRequest.objects.get_or_create(
                        company=company,
                        requester=employee,
                        request_type=types[(i + j) % len(types)],
                        title=f"طلب {status_value} #{j + 1} - {employee.full_name}",
                        defaults={"status": status_value},
                    )
                    if made:
                        counts["requests"] += 1

            # ---- timesheets + entries (this is also what attendance derives from) ----
            this_monday = date.today() - timedelta(days=date.today().weekday())
            for i, employee in enumerate(created_people, start=1):
                for w in range(4):
                    week = this_monday - timedelta(weeks=w)
                    sheet, made_sheet = Timesheet.objects.get_or_create(
                        company=company,
                        employee=employee,
                        week_start=week,
                        defaults={"status": SHEET_STATUSES[(i + w) % len(SHEET_STATUSES)]},
                    )
                    if made_sheet:
                        counts["sheets"] += 1
                    for d in range(5):
                        _, made = TimeEntry.objects.get_or_create(
                            timesheet=sheet,
                            work_date=week + timedelta(days=d),
                            defaults={
                                "duration_minutes": 480,  # an 8-hour day
                                "unpaid_break_minutes": 60,
                                "description": "يوم عمل كامل",
                                "company": company,
                            },
                        )
                        if made:
                            counts["entries"] += 1

            # ---- holidays: the whole Egyptian year --------------------------
            year = date.today().year
            calendar = (
                (1, 7, "عيد الميلاد المجيد"),
                (1, 25, "عيد الشرطة"),
                (3, 20, "عيد الأم"),
                (4, 25, "عيد تحرير سيناء"),
                (5, 1, "عيد العمال"),
                (6, 30, "عيد ثورة 30 يونيو"),
                (7, 23, "عيد ثورة 23 يوليو"),
                (10, 6, "عيد القوات المسلحة"),
            )
            for month, day, name in calendar:
                _, made = PublicHoliday.objects.get_or_create(
                    company=company,
                    country_code="EG",
                    year=year,
                    date=date(year, month, day),
                    defaults={"name": name},
                )
                if made:
                    counts["holidays"] += 1

        self.stdout.write("\n  ✓ الداتا اتزادت:")
        self.stdout.write(f"    • {counts['people']} موظف جديد")
        self.stdout.write(f"    • {counts['requests']} طلب جديد")
        self.stdout.write(f"    • {counts['sheets']} سجل وقت + {counts['entries']} إدخال")
        self.stdout.write(f"    • {counts['holidays']} عيد")
        self.stdout.write("\n  الإجمالي في شركة الديمو:")
        self.stdout.write(f"    موظفين: {EmployeeProfile.objects.filter(company=company).count()}")
        self.stdout.write(f"    طلبات:  {EmployeeRequest.objects.filter(company=company).count()}")
        self.stdout.write(f"    سجلات:  {Timesheet.objects.filter(company=company).count()}")
