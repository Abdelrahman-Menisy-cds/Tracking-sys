"""H30 plan §2.6 step 7 — the __default__ backfill for holidays (R2).

Same shape as reqs/0010: every pre-tenancy holiday row lands in the
``__default__`` company, idempotently. Rehearsed on a DB WITH rows (see the
R2 report) — an empty DB proves nothing.
"""

from django.db import migrations

_COMPANY_SLUG = "__default__"


def backfill_into_default_company(apps, schema_editor):
    Company = apps.get_model("accounts", "Company")
    company, _created = Company.objects.get_or_create(
        slug=_COMPANY_SLUG,
        defaults={"name": _COMPANY_SLUG},
    )
    PublicHoliday = apps.get_model("holidays", "PublicHoliday")
    PublicHoliday.objects.filter(company__isnull=True).update(company=company)


def detach_from_default_company(apps, schema_editor):
    """Reverse: null the links only — ``__default__`` stays (other apps'
    backfilled rows still reference it; PROTECT would refuse the delete)."""
    PublicHoliday = apps.get_model("holidays", "PublicHoliday")
    PublicHoliday.objects.update(company=None)


class Migration(migrations.Migration):

    dependencies = [
        ("holidays", "0002_company_nullable"),
    ]

    operations = [
        migrations.RunPython(backfill_into_default_company, detach_from_default_company),
    ]
