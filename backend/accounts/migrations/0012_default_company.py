"""H30 plan §2.6 step 3 — the __default__ company data migration (R1).

Every row that predates tenancy lands in ONE company (slug "__default__"),
idempotently (§2.7: a partial deploy heals instead of duplicating):

1. get_or_create Company(slug="__default__"); Company.name comes from the
   existing CompanyProfile row, falling back to "__default__".
2. The existing CompanyProfile row attaches to it (the singleton check kept
   the count at <= 1; if constraint-violating rows exist, the FIRST is
   attached and any leftover fails loudly at the 0013 hardening).
3. The existing TimezoneConfig row attaches the same way (its schema step,
   timesheets 0008, is an explicit dependency so the FK target/column exist).
4. Every nullable accounts ``company`` column backfills from __default__.
"""

from django.db import migrations

_COMPANY_SLUG = "__default__"

_COMPANY_BACKFILL_MODELS = (
    "User",
    "Department",
    "EmployeeProfile",
    "ManagerGrant",
    "SubscriptionCode",
    "AuditEvent",
    "AssistantConfig",
    "PendingDeviceFlow",
)


def backfill_into_default_company(apps, schema_editor):
    Company = apps.get_model("accounts", "Company")
    CompanyProfile = apps.get_model("accounts", "CompanyProfile")
    TimezoneConfig = apps.get_model("timesheets", "TimezoneConfig")

    profile = CompanyProfile.objects.order_by("pk").first()
    company, _created = Company.objects.get_or_create(
        slug=_COMPANY_SLUG,
        defaults={"name": (profile.name if profile is not None else _COMPANY_SLUG)},
    )
    if profile is not None and profile.company_id is None:
        profile.company = company
        profile.save(update_fields=["company"])

    tz = TimezoneConfig.objects.order_by("pk").first()
    if tz is not None and tz.company_id is None:
        tz.company = company
        tz.save(update_fields=["company"])

    for model_name in _COMPANY_BACKFILL_MODELS:
        model = apps.get_model("accounts", model_name)
        model.objects.filter(company__isnull=True).update(company=company)


def detach_from_default_company(apps, schema_editor):
    """Reverse of the backfill: null the links, drop the __default__ rows."""
    Company = apps.get_model("accounts", "Company")
    CompanyProfile = apps.get_model("accounts", "CompanyProfile")
    TimezoneConfig = apps.get_model("timesheets", "TimezoneConfig")

    for model_name in _COMPANY_BACKFILL_MODELS:
        model = apps.get_model("accounts", model_name)
        model.objects.update(company=None)
    CompanyProfile.objects.update(company=None)
    TimezoneConfig.objects.update(company=None)
    Company.objects.filter(slug=_COMPANY_SLUG).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0011_tenant_fk_nullable"),
        ("timesheets", "0008_timezoneconfig_company_nullable"),
    ]

    operations = [
        migrations.RunPython(backfill_into_default_company, detach_from_default_company),
    ]
