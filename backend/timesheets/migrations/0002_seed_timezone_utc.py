"""Seed the organization timezone (TimezoneConfig row) for Story 3.1.

The week is Monday-Sunday in the organization timezone. The single TimezoneConfig
row is the server-side authority; UTC is the approved baseline until HR config
UI (a later story) changes it.
"""
from django.db import migrations


def seed_default_timezone(apps, schema_editor):
    TimezoneConfig = apps.get_model("timesheets", "TimezoneConfig")
    TimezoneConfig.objects.get_or_create(name="UTC")


def remove_seed(apps, schema_editor):
    TimezoneConfig = apps.get_model("timesheets", "TimezoneConfig")
    TimezoneConfig.objects.filter(name="UTC").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("timesheets", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_default_timezone, remove_seed),
    ]
