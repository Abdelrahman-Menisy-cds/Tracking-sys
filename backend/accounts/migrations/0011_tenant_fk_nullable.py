"""H30 plan §2.6 step 2 — nullable company FKs on the accounts tenant tables.

Every accounts table that the plan's §6 inventory makes tenant-scoped gains a
nullable ``company`` FK (backfilled by 0012, hardened by 0013).
``CompanyProfile`` loses its forced-pk singleton check in the same migration
(plan: RemoveConstraint first) and gains a nullable OneToOne instead.

``SubscriptionCode`` is added nullable here and STAYS nullable in 0013:
§2.3/§2.5 keep operator-issued bootstrap "create company" codes tenantless.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0010_company"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="companyprofile",
            name="chk_company_profile_singleton",
        ),
        migrations.AddField(
            model_name="assistantconfig",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="auditevent",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="department",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="managergrant",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="pendingdeviceflow",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
        migrations.AddField(
            model_name="subscriptioncode",
            name="company",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="signup_codes",
                to="accounts.company",
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name="users", to="accounts.company"),
        ),
        migrations.AddField(
            model_name="companyprofile",
            name="company",
            field=models.OneToOneField(null=True, on_delete=django.db.models.deletion.PROTECT, related_name="profile", to="accounts.company"),
        ),
    ]
