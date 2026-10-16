"""H30 plan §2.6 step 6 — nullable company FKs on the timesheets tables (R2).

``Timesheet``, ``TimeEntry``, ``TimesheetEvent`` and the three idempotency
records gain a nullable ``company`` FK (backfilled by 0011, hardened by
0012). ``TimezoneConfig`` was already converted by 0008/0009 (R1).
``uniq_timesheet_employee_week_start`` needs NO flip: an employee belongs to
exactly one company, so (employee, week_start) is per-company by
construction.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("timesheets", "0009_timezoneconfig_company_hard"),
    ]

    operations = [
        migrations.AddField(
            model_name="timesheet",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="timeentry",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="timesheetevent",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="timesheetsubmitidempotencyrecord",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="timesheetcreateidempotencyrecord",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="timesheetdecisionidempotencyrecord",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
    ]
