from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("timesheets", "0004_timesheetsubmitidempotencyrecord")]

    operations = [
        migrations.RemoveConstraint(
            model_name="timeentry", name="uniq_timeentry_sheet_work_date"
        ),
        migrations.RemoveConstraint(
            model_name="timeentry", name="chk_timeentry_duration_non_negative"
        ),
        migrations.RemoveConstraint(
            model_name="timeentry", name="chk_timeentry_break_non_negative"
        ),
        migrations.RemoveConstraint(
            model_name="timeentry", name="chk_timeentry_duration_within_day"
        ),
        migrations.RemoveConstraint(
            model_name="timeentry", name="chk_timeentry_break_within_day"
        ),
    ]
