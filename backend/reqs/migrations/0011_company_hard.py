"""H30 plan §2.6 step 5 — null -> hard on the reqs company FKs (R2).

Every company column added nullable in 0009 and backfilled in 0010 becomes
null=False, so no request row can ever exist without a tenant anchor.
``RequestType`` gains the per-company name uniqueness here (after the
backfill, so the constraint is built over fully-attached rows): the global
``unique=True`` was dropped in 0009.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("reqs", "0010_default_company"),
    ]

    operations = [
        migrations.AlterField(
            model_name="requesttype",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="employeerequest",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="requestevent",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="requestattachment",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="attachmentidempotencyrecord",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="submissionidempotencyrecord",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="decisionidempotencyrecord",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="cancelidempotencyrecord",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddConstraint(
            model_name="requesttype",
            constraint=models.UniqueConstraint(fields=("company", "name"), name="uniq_requesttype_company_name"),
        ),
    ]
