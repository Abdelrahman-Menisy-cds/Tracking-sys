"""H20: seed the request types the app's own screens already assume.

The frontend vocabulary lives verbatim in
frontend/src/mock/data.ts (requestTypes): إجازة اعتيادية، إجازة مرضية،
تصحيح سجل وقت، تصريح خروج أثناء اليوم — mirrored EXACTLY here (no second
vocabulary). The backend model has no bilingual name field, so the Arabic
name is stored (it is what the screens and the assistant match on) and the
English name goes in `description` for reference. `requires_hr_approval`
matches the mock flags.
"""
from django.db import migrations

SEED = [
    {"name": "إجازة اعتيادية", "eng": "Annual leave", "requires_manager_approval": True, "requires_hr_approval": False},
    {"name": "إجازة مرضية", "eng": "Sick leave", "requires_manager_approval": True, "requires_hr_approval": True},
    {"name": "تصحيح سجل وقت", "eng": "Timesheet correction", "requires_manager_approval": True, "requires_hr_approval": True},
    {"name": "تصريح خروج أثناء اليوم", "eng": "Day exit permit", "requires_manager_approval": True, "requires_hr_approval": False},
]


def seed(apps, schema_editor):
    RequestType = apps.get_model("reqs", "RequestType")
    for row in SEED:
        RequestType.objects.get_or_create(
            name=row["name"],
            defaults={
                "description": row["eng"],
                "requires_manager_approval": row["requires_manager_approval"],
                "requires_hr_approval": row["requires_hr_approval"],
                "is_active": True,
            },
        )


def unseed(apps, schema_editor):
    RequestType = apps.get_model("reqs", "RequestType")
    RequestType.objects.filter(name__in=[row["name"] for row in SEED]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("reqs", "0007_alter_requestevent_action_cancelidempotencyrecord"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
