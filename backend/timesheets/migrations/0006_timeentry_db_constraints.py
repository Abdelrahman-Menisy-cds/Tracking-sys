"""Restore TimeEntry DB constraints (Story 3.2 QA fix).

Migration 0005 dropped five TimeEntry constraints entirely, leaving the table
integrity-waived: negative durations, > 24h/day values, duplicate
(timesheet, work_date) rows, and out-of-week work_dates could all be
persisted by any non-API writer (imports, scripts, the Django admin, an
assistant path). That contradicts constitution item 5 ("Use database
constraints where possible and service validation where needed").

This migration 0006 restores all five under their original names, identical
to migration 0001's definitions:

- uniq_timeentry_sheet_work_date  -- UniqueConstraint (timesheet, work_date)
- chk_timeentry_duration_non_negative  -- duration_minutes >= 0
- chk_timeentry_break_non_negative     -- unpaid_break_minutes >= 0
- chk_timeentry_duration_within_day    -- duration_minutes <= 1440
- chk_timeentry_break_within_day       -- unpaid_break_minutes <= 1440

Rationale for restoring, not merely re-adding reduced forms: the current
MVP entry model is duration-only with the SAME daily caps the old schema
enforced (services.MAX_DAILY_WORK_MINUTES = 1440, MAX_DAILY_BREAK_MINUTES
= 1440, MAX_WEEKLY_WORK_MINUTES = 168h), so nothing about the current
policy requires weaker DB constraints. Submit-time/revalidation behavior
in services.py and correction_services.py is untouched and remains the
primary enforcement path mapped to 422; the DB is the backstop per
constitution item 5. SQLite re-endorses table structure on insert through
Django's generated WHERE-less CHECK clauses, and every existing test
fixture row that runs through `TimeEntry.objects.create` above satisfies
these (invalid fixture rows there are themselves created with the
constraints present; the tests that need an invalid entry achieve it
through the API/service path, not by violating the DB).

Original DB-level behavior is verified directly by
test_story_3_2.TimeEntryDBIntegrityTests (test-only setup, deliberately
outside APITestCase): those tests create rows through the ORM with valid
field combinations for the positive case and assert IntegrityError on the
violating combinations, so no test requires a weakened production model.
"""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("timesheets", "0005_remove_timeentry_db_constraints"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="timeentry",
            constraint=models.UniqueConstraint(
                fields=("timesheet", "work_date"),
                name="uniq_timeentry_sheet_work_date",
            ),
        ),
        migrations.AddConstraint(
            model_name="timeentry",
            constraint=models.CheckConstraint(
                condition=models.Q(("duration_minutes__gte", 0)),
                name="chk_timeentry_duration_non_negative",
            ),
        ),
        migrations.AddConstraint(
            model_name="timeentry",
            constraint=models.CheckConstraint(
                condition=models.Q(("unpaid_break_minutes__gte", 0)),
                name="chk_timeentry_break_non_negative",
            ),
        ),
        migrations.AddConstraint(
            model_name="timeentry",
            constraint=models.CheckConstraint(
                condition=models.Q(("duration_minutes__lte", 1440)),
                name="chk_timeentry_duration_within_day",
            ),
        ),
        migrations.AddConstraint(
            model_name="timeentry",
            constraint=models.CheckConstraint(
                condition=models.Q(("unpaid_break_minutes__lte", 1440)),
                name="chk_timeentry_break_within_day",
            ),
        ),
    ]
