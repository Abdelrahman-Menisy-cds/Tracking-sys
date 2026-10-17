"""Work-schedule command services — Story H39 (HR only).

The schedule and its days are one unit: they are written inside a single
transaction, so a rejected edit never leaves a half-renamed schedule or a
day set that disagrees with it. Activation is exclusive per company — the
service deactivates the previous active under a row lock (the same
``transaction.atomic + select_for_update`` shape the request/timesheet
transition services use; a no-op on SQLite, a real lock on Postgres), so two
concurrent activations can never leave two active rows.
"""
from django.db import transaction

from accounts.models import WorkSchedule, WorkScheduleDay


@transaction.atomic
def create_schedule(*, company, created_by, validated_data):
    """Create the schedule plus its day set in one transaction."""
    days = validated_data.pop("days")
    wanted_active = validated_data.pop("is_active", None)
    if wanted_active is None:
        # The settings card reads the ACTIVE schedule, so the company's first
        # schedule activates itself — an explicit ``is_active`` always wins.
        wanted_active = not WorkSchedule.objects.filter(company=company, is_active=True).exists()
    if wanted_active:
        _deactivate_other_actives(company=company, keep_pk=None)
    schedule = WorkSchedule.objects.create(
        company=company, created_by=created_by, is_active=wanted_active, **validated_data
    )
    _replace_days(schedule, days)
    return schedule


@transaction.atomic
def update_schedule(*, schedule, validated_data):
    """Apply scalar fields; ``days`` (when sent) replaces the whole day set.

    Replacement — not a per-day merge — because the card edits the week as
    one form: a merge would silently keep stale weekdays the editor believes
    it removed.
    """
    days = validated_data.pop("days", None)
    wanted_active = validated_data.pop("is_active", None)
    if wanted_active is True and not schedule.is_active:
        _deactivate_other_actives(company=schedule.company, keep_pk=schedule.pk)
    if wanted_active is not None:
        schedule.is_active = wanted_active
    for field, value in validated_data.items():
        setattr(schedule, field, value)
    schedule.save()
    if days is not None:
        _replace_days(schedule, days)
    return schedule


@transaction.atomic
def deactivate_schedule(*, schedule):
    """Soft delete: the row stays as the version trail the settings card
    shows; only one schedule may claim ``is_active``, and this releases it."""
    schedule.is_active = False
    schedule.save(update_fields=["is_active", "updated_at"])
    return schedule


def _deactivate_other_actives(*, company, keep_pk):
    """Flip every other active row off inside the caller's transaction.

    The lock serializes concurrent activations on Postgres; the partial
    unique index (uniq_workschedule_company_active) is the final guard either
    way.
    """
    siblings = WorkSchedule.objects.select_for_update().filter(company=company, is_active=True)
    if keep_pk is not None:
        siblings = siblings.exclude(pk=keep_pk)
    siblings.update(is_active=False)


def _replace_days(schedule, days):
    schedule.days.all().delete()
    WorkScheduleDay.objects.bulk_create(
        [WorkScheduleDay(schedule=schedule, **day) for day in days]
    )
