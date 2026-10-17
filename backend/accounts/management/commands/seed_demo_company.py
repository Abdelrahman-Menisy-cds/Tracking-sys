"""Seed ONE demo company with content to click through (H38).

Why a new command: ``seed_demo_accounts`` only makes three logins and never set
a company, so it cannot work now that ``User.company`` is a hard FK. This one
builds a whole tenant — profile, departments, people, request types, requests,
timesheets and holidays — so every screen and every report has something real
in it. The data is REAL rows of the demo company: nothing here is mock, and
nothing crosses into another company (every row carries ``company=``).

Idempotent: safe to re-run; it reuses what exists and refreshes the passwords.

    python manage.py seed_demo_company
"""
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

DEMO_PASSWORD = "demo1234"
COMPANY_SLUG = "demo-company"
COMPANY_NAME = "شركة الديمو"


class Command(BaseCommand):
    help = "Create/refresh one demo company with departments, people and records."

    def handle(self, *args, **options):
        from accounts.models import (
            Company,
            CompanyProfile,
            Department,
            EmployeeProfile,
        )
        from holidays.models import PublicHoliday
        from reqs.models import EmployeeRequest, RequestType
        from timesheets.models import TimeEntry, Timesheet

        user_model = get_user_model()
        wrote = []

        with transaction.atomic():
            company, _ = Company.objects.get_or_create(
                slug=COMPANY_SLUG, defaults={"name": COMPANY_NAME}
            )

            # A COMPLETE profile, so the onboarding gate does not fire.
            profile, _ = CompanyProfile.objects.get_or_create(company=company)
            for field, value in (
                ("name", COMPANY_NAME),
                ("activity", "تجارة وتوزيع"),
                ("address", "القاهرة - مدينة نصر"),
                ("phone", "01001234567"),
                ("email", "info@demo.local"),
            ):
                if hasattr(profile, field):
                    setattr(profile, field, value)
            profile.save()
            wrote.append("الشركة + بروفايلها")

            departments = []
            for code, name_ar in (("IT", "التقنية"), ("HR", "الموارد البشرية"), ("SALES", "المبيعات")):
                dept, _ = Department.objects.get_or_create(
                    company=company, code=code, defaults={"name_ar": name_ar}
                )
                departments.append(dept)
            wrote.append(f"{len(departments)} أقسام")

            def person(email, full_name, role, dept=None, manager=None, number=None):
                user, _ = user_model.objects.get_or_create(
                    email=email, defaults={"company": company}
                )
                user.company = company
                user.full_name = full_name
                user.role = role
                user.is_active = True
                user.set_password(DEMO_PASSWORD)
                user.save()
                fields = {"company": company, "user": user}
                if dept is not None:
                    fields["department"] = dept
                if manager is not None:
                    fields["manager"] = manager
                if number:
                    fields["employee_number"] = number
                try:
                    EmployeeProfile.objects.update_or_create(user=user, defaults=fields)
                except Exception as exc:  # a field this model version may not have
                    self.stdout.write(f"    (profile fields skipped for {email}: {exc})")
                return user

            hr = person("hr@demo.local", "منى شريف", "HR", departments[1], number="DEMO-HR")
            manager = person("manager@demo.local", "هالة عبد الرحمن", "MANAGER", departments[0], hr, "DEMO-M1")
            employees = [
                person(f"emp{i}@demo.local", name, "EMPLOYEE", departments[i % 3], manager, f"DEMO-E{i}")
                for i, name in enumerate(
                    ("كريم مصطفى", "أحمد سعيد", "نور الدين", "سلمى فؤاد", "طارق منصور", "سارة حمدي"),
                    start=1,
                )
            ]
            wrote.append(f"{2 + len(employees)} موظفين (HR + مدير + {len(employees)})")

            types = []
            for name in ("إجازة اعتيادية", "إذن", "سلفة", "شهادة خبرة"):
                rtype, _ = RequestType.objects.get_or_create(
                    company=company, name=name, defaults={"is_active": True}
                )
                types.append(rtype)
            wrote.append(f"{len(types)} أنواع طلبات")

            statuses = ("DRAFT", "PENDING_MANAGER", "PENDING_HR", "APPROVED", "REJECTED", "RETURNED")
            made_requests = 0
            for i, employee in enumerate(employees):
                for j, status_value in enumerate(statuses[: 2 + (i % 4)]):
                    EmployeeRequest.objects.get_or_create(
                        company=company,
                        requester=employee,
                        request_type=types[(i + j) % len(types)],
                        title=f"طلب {status_value} - {employee.full_name}",
                        defaults={"status": status_value},
                    )
                    made_requests += 1
            wrote.append(f"{made_requests} طلبات (بحالات مختلفة)")

            this_monday = date.today() - timedelta(days=date.today().weekday())
            made_sheets = 0
            for i, employee in enumerate(employees):
                week = this_monday - timedelta(weeks=(i % 3))
                sheet, _ = Timesheet.objects.get_or_create(
                    company=company,
                    employee=employee,
                    week_start=week,
                    defaults={"status": ("SUBMITTED", "APPROVED", "RETURNED")[i % 3]},
                )
                for d in range(5):
                    try:
                        TimeEntry.objects.get_or_create(
                            timesheet=sheet,
                            work_date=week + timedelta(days=d),
                            defaults={"hours": Decimal("8.00"), "company": company},
                        )
                    except Exception:
                        break
                made_sheets += 1
            wrote.append(f"{made_sheets} سجلات وقت + إدخالاتها")

            made_holidays = 0
            for month_day, name in ((1, "رأس السنة"), (7, "عيد الميلاد المجيد"), (10, "عيد القيامة")):
                PublicHoliday.objects.get_or_create(
                    company=company,
                    country_code="EG",
                    year=date.today().year,
                    date=date(date.today().year, month_day, 1),
                    defaults={"name": name},
                )
                made_holidays += 1
            wrote.append(f"{made_holidays} أعياد")

        self.stdout.write("\n  ✓ شركة الديمو جاهزة:")
        for line in wrote:
            self.stdout.write(f"    • {line}")
        self.stdout.write("\n  الدخول:")
        self.stdout.write(f"    hr@demo.local        {DEMO_PASSWORD}   (موارد بشرية)")
        self.stdout.write(f"    manager@demo.local   {DEMO_PASSWORD}   (مدير)")
        self.stdout.write(f"    emp1@demo.local      {DEMO_PASSWORD}   (موظف)")
