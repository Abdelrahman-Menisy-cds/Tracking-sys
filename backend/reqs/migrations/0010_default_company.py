"""H30 plan §2.6 step 5 — the __default__ backfill for reqs (R2).

Every reqs row that predates tenancy lands in the ``__default__`` company,
idempotently (get_or_create; a partial deploy heals instead of raising).
Rehearsed on a DB WITH rows before this batch shipped (see the R2 report) —
an empty DB proves nothing.
"""

from django.db import migrations

_COMPANY_SLUG = "__default__"

_BACKFILL_MODELS = (
    "RequestType",
    "EmployeeRequest",
    "RequestEvent",
    "RequestAttachment",
    "AttachmentIdempotencyRecord",
    "SubmissionIdempotencyRecord",
    "DecisionIdempotencyRecord",
    "CancelIdempotencyRecord",
)


def backfill_into_default_company(apps, schema_editor):
    Company = apps.get_model("accounts", "Company")
    company, _created = Company.objects.get_or_create(
        slug=_COMPANY_SLUG,
        defaults={"name": _COMPANY_SLUG},
    )
    for model_name in _BACKFILL_MODELS:
        model = apps.get_model("reqs", model_name)
        model.objects.filter(company__isnull=True).update(company=company)


def detach_from_default_company(apps, schema_editor):
    """Reverse: null the links only. The ``__default__`` row itself STAYS —
    accounts rows (backfilled by accounts.0012) and other apps' rows still
    reference it, and PROTECT would (correctly) refuse the delete."""
    for model_name in _BACKFILL_MODELS:
        model = apps.get_model("reqs", model_name)
        model.objects.update(company=None)


class Migration(migrations.Migration):

    dependencies = [
        ("reqs", "0009_company_nullable"),
    ]

    operations = [
        migrations.RunPython(backfill_into_default_company, detach_from_default_company),
    ]
