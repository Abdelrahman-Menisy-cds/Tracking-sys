"""H30 plan §2.6 step 4 — null -> hard on the accounts company FKs (R1).

Every company column added nullable in 0011 and backfilled in 0012 becomes
null=False, so no account row can ever exist without a tenant anchor.
``SubscriptionCode.company`` is deliberately NOT hardened: §2.3/§2.5 keep
operator-issued bootstrap "create company" codes tenantless (NULL company) —
the plan's step-4 "every" cannot override that explicit contract.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0012_default_company"),
    ]

    operations = [
        migrations.AlterField(
            model_name="assistantconfig",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="auditevent",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="department",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="employeeprofile",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="managergrant",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="pendingdeviceflow",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="user",
            name="company",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="users", to="accounts.company"),
        ),
        migrations.AlterField(
            model_name="companyprofile",
            name="company",
            field=models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="profile", to="accounts.company"),
        ),
    ]
