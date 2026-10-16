"""H30 plan §2.6 step 6 — null -> hard on the timesheets company FKs (R2)."""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("timesheets", "0011_default_company"),
    ]

    operations = [
        migrations.AlterField(
            model_name="timesheet",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="timeentry",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="timesheetevent",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="timesheetsubmitidempotencyrecord",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="timesheetcreateidempotencyrecord",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="timesheetdecisionidempotencyrecord",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
    ]
