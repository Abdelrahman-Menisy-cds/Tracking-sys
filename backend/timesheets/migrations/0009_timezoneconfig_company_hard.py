"""H30 plan §2.4 / §2.6 — TimezoneConfig.company goes hard (R1).

Runs after the accounts 0012 data migration so the backfilled row can never
be NULL: one timezone config per company, from here on.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("timesheets", "0008_timezoneconfig_company_nullable"),
        ("accounts", "0012_default_company"),
    ]

    operations = [
        migrations.AlterField(
            model_name="timezoneconfig",
            name="company",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="timezone_config",
                to="accounts.company",
            ),
        ),
        # The singleton-era name uniqueness flips per-company with the row
        # itself: two companies may both run "UTC" (the seeded __default__
        # row is "UTC"; R1's per-company reader get_or_creates the same
        # default for any second company). Plan gap found by the R1 test
        # gate (§2.4 named only the id-check removal); same uniqueness class
        # the plan defers to R2 for RequestType.name / employee_number /
        # Department.code.
        migrations.AlterField(
            model_name="timezoneconfig",
            name="name",
            field=models.CharField(default="UTC", max_length=63),
        ),
    ]
