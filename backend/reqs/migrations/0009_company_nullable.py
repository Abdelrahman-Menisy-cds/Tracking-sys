"""H30 plan §2.6 step 5 — nullable company FKs on the reqs tenant tables (R2).

Every reqs table gains a nullable ``company`` FK (backfilled by 0010,
hardened by 0011). ``RequestType.name`` loses its GLOBAL ``unique=True`` in
the same bytecode: request-type names become per-company (the per-company
UniqueConstraint lands with 0011, after the backfill, so no duplicate-name
row can exist within one company).
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("reqs", "0008_seed_request_types"),
    ]

    operations = [
        migrations.AlterField(
            model_name="requesttype",
            name="name",
            field=models.CharField(max_length=100),
        ),
        migrations.AddField(
            model_name="requesttype",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="employeerequest",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="requestevent",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="requestattachment",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="attachmentidempotencyrecord",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="submissionidempotencyrecord",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="decisionidempotencyrecord",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="cancelidempotencyrecord",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
    ]
