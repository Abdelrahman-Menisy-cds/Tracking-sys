from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):

    dependencies = [
        ("notifications", "0001_initial"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="notification",
            options={"ordering": ("-created_at", "-pk")},
        ),
        migrations.AddField(
            model_name="notification",
            name="related_object_type",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
        migrations.AddField(
            model_name="notification",
            name="related_object_id",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="notification",
            name="dedupe_key",
            field=models.CharField(blank=True, db_index=True, default="", max_length=128),
        ),
        migrations.AddConstraint(
            model_name="notification",
            constraint=models.UniqueConstraint(
                condition=~Q(dedupe_key=""),
                fields=("recipient", "dedupe_key"),
                name="uniq_notification_recipient_dedupe_key",
            ),
        ),
    ]
