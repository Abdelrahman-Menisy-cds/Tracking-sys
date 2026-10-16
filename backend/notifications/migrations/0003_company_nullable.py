"""H30 plan §2.6 step 8 — nullable company FK on Notification (R2).

``company`` is DENORMALIZED from ``recipient`` (plan step 8: "set it there
once" in notifications/services.py::create_notification); it is added
nullable here, backfilled by 0004, hardened by 0005.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("notifications", "0002_notification_related_object_and_dedupe"),
    ]

    operations = [
        migrations.AddField(
            model_name="notification",
            name="company",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to="accounts.company"),
        ),
    ]
