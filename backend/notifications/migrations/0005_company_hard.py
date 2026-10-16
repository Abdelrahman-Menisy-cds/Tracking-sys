"""H30 plan §2.6 step 8 — null -> hard on Notification.company (R2)."""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("notifications", "0004_default_company"),
    ]

    operations = [
        migrations.AlterField(
            model_name="notification",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
    ]
