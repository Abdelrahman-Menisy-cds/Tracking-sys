"""H30 plan §2.6 step 7 — null -> hard on PublicHoliday.company (R2).

The natural-key uniqueness returns PER COMPANY here: (company, country_code,
date, name). Two companies legitimately hold the same holiday; within one
company the refresh upsert key stays exactly as honest as before.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("holidays", "0003_default_company"),
    ]

    operations = [
        migrations.AlterField(
            model_name="publicholiday",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddConstraint(
            model_name="publicholiday",
            constraint=models.UniqueConstraint(
                fields=("company", "country_code", "date", "name"),
                name="uniq_holiday_company_country_date_name",
            ),
        ),
    ]
