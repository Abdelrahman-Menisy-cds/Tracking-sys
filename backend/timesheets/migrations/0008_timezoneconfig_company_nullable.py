"""H30 plan §2.4 / §2.6 — TimezoneConfig becomes per-company (R1).

The singleton check (chk_timezone_config_singleton) is removed and a nullable
``company`` OneToOne to accounts.Company lands; the accounts 0012 data
migration attaches the existing row to __default__, and
0009_timezoneconfig_company_hard closes the nullable window. The migration
lives in timesheets (the model's app) but the plan lands its steps 2/3
linearly alongside the accounts data migration because the FK target must
exist first.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("timesheets", "0007_alter_timesheetevent_action_and_more"),
        ("accounts", "0010_company"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="timezoneconfig",
            name="chk_timezone_config_singleton",
        ),
        migrations.AddField(
            model_name="timezoneconfig",
            name="company",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="timezone_config",
                to="accounts.company",
            ),
        ),
    ]
