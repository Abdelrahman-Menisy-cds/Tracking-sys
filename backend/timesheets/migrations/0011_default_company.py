"""H30 plan §2.6 step 6 — the __default__ backfill for timesheets (R2).

Same shape as reqs/0010 and accounts/0012: every pre-tenancy row lands in
the ``__default__`` company, idempotently. Rehearsed on a DB WITH rows (see
the R2 report) — an empty DB proves nothing.
"""

from django.db import migrations

_COMPANY_SLUG = "__default__"

_BACKFILL_MODELS = (
    "Timesheet",
    "TimeEntry",
    "TimesheetEvent",
    "TimesheetSubmitIdempotencyRecord",
    "TimesheetCreateIdempotencyRecord",
    "TimesheetDecisionIdempotencyRecord",
)


def backfill_into_default_company(apps, schema_editor):
    Company = apps.get_model("accounts", "Company")
    company, _created = Company.objects.get_or_create(
        slug=_COMPANY_SLUG,
        defaults={"name": _COMPANY_SLUG},
    )
    for model_name in _BACKFILL_MODELS:
        model = apps.get_model("timesheets", model_name)
        model.objects.filter(company__isnull=True).update(company=company)


def detach_from_default_company(apps, schema_editor):
    """Reverse: null the links only — ``__default__`` stays (other apps'
    backfilled rows still reference it; PROTECT would refuse the delete)."""
    for model_name in _BACKFILL_MODELS:
        model = apps.get_model("timesheets", model_name)
        model.objects.update(company=None)


class Migration(migrations.Migration):

    dependencies = [
        ("timesheets", "0010_company_nullable"),
    ]

    operations = [
        migrations.RunPython(backfill_into_default_company, detach_from_default_company),
    ]
