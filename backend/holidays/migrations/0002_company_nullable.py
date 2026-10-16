"""H30 plan §2.6 step 7 — nullable company FK on PublicHoliday (R2).

The holiday register becomes PER COMPANY: ``company`` is added nullable here
and the GLOBAL natural-key constraint (``uniq_holiday_country_date_name``)
is dropped in the same bytecode — two companies may now hold the same
(country, date, name). The per-company constraint lands with 0004, after the
backfill.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("holidays", "0001_initial"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="publicholiday",
            name="uniq_holiday_country_date_name",
        ),
        migrations.AddField(
            model_name="publicholiday",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
    ]
