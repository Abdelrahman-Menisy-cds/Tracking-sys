"""Attendance history + HR snapshot: the derived day, honestly.

The history and snapshot endpoints derive every day from the active
WorkSchedule plus that day's AttendanceEvent rows — nothing is stored. These
tests pin the states the brief names (PRESENT with the right worked minutes,
ABSENT on a scheduled day with no events, REST_DAY, NO_SCHEDULE), the
INCOMPLETE case (a clock-in with no clock-out), pagination, and the scope
rule: history is the caller's own rows only, and the whole-company snapshot
answers a non-HR caller with the shared 404 envelope.
"""

from datetime import date, datetime, time, timezone

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import AttendanceEvent, User, WorkSchedule, WorkScheduleDay
from tenants.context import default_company

pytestmark = pytest.mark.django_db

# 2026-10-19 is a Monday (schedule weekday 1, working); 2026-10-23 a Friday
# (weekday 5, rest).
MONDAY = date(2026, 10, 19)
FRIDAY = date(2026, 10, 23)


def make_user(email, role=User.Role.EMPLOYEE):
    return User.objects.create_user(
        company=default_company(),
        email=email,
        password="pw-1234567890",
        role=role,
        full_name=email.split("@")[0],
    )


def make_schedule(company=None, *, start="09:00", end="17:00", break_minutes=60):
    """A Sun–Thu working week (09:00–17:00, 60-minute break), Fri/Sat rest."""
    schedule = WorkSchedule.objects.create(
        company=company or default_company(),
        name="الدوام الرسمي",
        effective_from=date(2026, 1, 1),
        is_active=True,
    )
    for weekday in range(7):
        working = weekday < 5  # Sunday=0 … Thursday=4
        WorkScheduleDay.objects.create(
            schedule=schedule,
            weekday=weekday,
            is_working_day=working,
            start_time=time.fromisoformat(start) if working else None,
            end_time=time.fromisoformat(end) if working else None,
            break_minutes=break_minutes if working else 0,
        )
    return schedule


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def clock(user, kind, day, hour, minute):
    return AttendanceEvent.objects.create(
        company=user.company,
        user=user,
        kind=kind,
        occurred_at=datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc),
    )


def history(client, **params):
    query = "&".join(f"{key}={value}" for key, value in params.items())
    return client.get(f"/api/v1/attendance/history?{query}")


def day_row(response, day):
    # response.data is the pre-render payload: `date` is still a date object.
    return next(row for row in response.data["data"] if row["date"] == day)


# --- (a) clock-in + clock-out derives PRESENT with the right worked minutes -----


def test_present_day_derives_worked_minutes_minus_break(db):
    employee = make_user("emp@x.test")
    make_schedule()
    clock(employee, "CLOCK_IN", MONDAY, 9, 5)
    clock(employee, "CLOCK_OUT", MONDAY, 17, 5)  # 480-minute span, 60-minute break

    response = history(client_for(employee), **{"from": "2026-10-19", "to": "2026-10-19"})

    assert response.status_code == status.HTTP_200_OK, response.data
    row = day_row(response, MONDAY)
    assert row["state"] == "PRESENT"
    assert row["worked_minutes"] == 420
    assert row["break_minutes"] == 60
    assert (row["first_clock_in"].hour, row["first_clock_in"].minute) == (9, 5)
    assert (row["last_clock_out"].hour, row["last_clock_out"].minute) == (17, 5)


def test_clock_in_without_clock_out_is_incomplete(db):
    employee = make_user("emp@x.test")
    make_schedule()
    clock(employee, "CLOCK_IN", MONDAY, 9, 5)

    response = history(client_for(employee), **{"from": "2026-10-19", "to": "2026-10-19"})

    row = day_row(response, MONDAY)
    assert row["state"] == "INCOMPLETE"
    assert row["worked_minutes"] is None
    assert row["last_clock_out"] is None


# --- (b) a scheduled day with no events derives ABSENT --------------------------


def test_scheduled_day_without_events_is_absent(db):
    employee = make_user("emp@x.test")
    make_schedule()

    response = history(client_for(employee), **{"from": "2026-10-19", "to": "2026-10-19"})

    row = day_row(response, MONDAY)
    assert row["state"] == "ABSENT"
    assert row["first_clock_in"] is None
    assert row["worked_minutes"] is None


# --- (c) a rest day derives REST_DAY -------------------------------------------


def test_rest_day_derives_rest_day(db):
    employee = make_user("emp@x.test")
    make_schedule()

    response = history(client_for(employee), **{"from": "2026-10-23", "to": "2026-10-23"})

    row = day_row(response, FRIDAY)
    assert row["state"] == "REST_DAY"
    assert row["break_minutes"] is None  # a rest day carries no window


# --- (d) no active schedule derives NO_SCHEDULE, never an invented day ----------


def test_no_active_schedule_derives_no_schedule(db):
    employee = make_user("emp@x.test")
    # A schedule exists but is NOT active: the endpoint must not use it.
    schedule = make_schedule()
    WorkSchedule.objects.filter(pk=schedule.pk).update(is_active=False)

    response = history(client_for(employee), **{"from": "2026-10-19", "to": "2026-10-19"})

    row = day_row(response, MONDAY)
    assert row["state"] == "NO_SCHEDULE"
    assert row["worked_minutes"] is None
    assert row["break_minutes"] is None


# --- (e) an employee cannot read another employee's history ---------------------


def test_history_returns_only_the_callers_own_days(db):
    alice = make_user("alice@x.test")
    bob = make_user("bob@x.test")
    make_schedule()
    clock(alice, "CLOCK_IN", MONDAY, 9, 0)
    clock(alice, "CLOCK_OUT", MONDAY, 17, 0)

    # Bob asks for the same day: Alice's events must not appear in his rows.
    response = history(client_for(bob), **{"from": "2026-10-19", "to": "2026-10-19"})

    assert response.status_code == status.HTTP_200_OK, response.data
    row = day_row(response, MONDAY)
    assert row["first_clock_in"] is None
    assert row["state"] == "ABSENT"


def test_non_hr_cannot_read_the_company_snapshot(db):
    make_user("hr@x.test", role=User.Role.HR)
    employee = make_user("emp@x.test")

    response = client_for(employee).get("/api/v1/attendance/snapshot?date=2026-10-19")

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.data["error"]["code"] == "not_found"


def test_anonymous_history_is_401(db):
    assert APIClient().get("/api/v1/attendance/history").status_code == 401
    assert APIClient().get("/api/v1/attendance/snapshot").status_code == 401


# --- range, filter and pagination ----------------------------------------------


def test_default_range_is_the_last_30_days_and_paginates(db):
    employee = make_user("emp@x.test")
    make_schedule()

    response = client_for(employee).get("/api/v1/attendance/history")

    assert response.status_code == status.HTTP_200_OK, response.data
    assert response.data["meta"]["count"] == 30
    assert len(response.data["data"]) == 30
    # Newest first.
    dates = [row["date"] for row in response.data["data"]]
    assert dates == sorted(dates, reverse=True)


def test_status_filter_keeps_only_matching_days(db):
    employee = make_user("emp@x.test")
    make_schedule()

    response = history(
        client_for(employee), **{"from": "2026-10-19", "to": "2026-10-24", "status": "REST_DAY"}
    )

    assert response.status_code == status.HTTP_200_OK, response.data
    assert {row["state"] for row in response.data["data"]} == {"REST_DAY"}
    assert response.data["meta"]["count"] == 2  # Fri 23 + Sat 24


def test_unknown_status_is_422(db):
    employee = make_user("emp@x.test")
    response = history(client_for(employee), **{"from": "2026-10-19", "to": "2026-10-19", "status": "LATE"})
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "status" in response.data["error"]["fields"]


def test_from_after_to_is_422(db):
    employee = make_user("emp@x.test")
    response = history(client_for(employee), **{"from": "2026-10-20", "to": "2026-10-19"})
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "from" in response.data["error"]["fields"]


# --- HR snapshot ---------------------------------------------------------------


def test_hr_snapshot_lists_every_active_employee_with_derived_state(db):
    hr = make_user("hr@x.test", role=User.Role.HR)
    present = make_user("present@x.test")
    absent = make_user("absent@x.test")
    make_user("hrcolleague@x.test", role=User.Role.HR)  # not a subject
    make_schedule()
    clock(present, "CLOCK_IN", MONDAY, 9, 0)
    clock(present, "CLOCK_OUT", MONDAY, 17, 0)

    response = client_for(hr).get("/api/v1/attendance/snapshot?date=2026-10-19")

    assert response.status_code == status.HTTP_200_OK, response.data
    data = response.data["data"]
    assert data["date"] == MONDAY
    assert data["schedule"]["name"] == "الدوام الرسمي"

    states = {row["user"]["email"]: row["state"] for row in data["employees"]}
    assert states == {"present@x.test": "PRESENT", "absent@x.test": "ABSENT"}
    assert data["counts"]["PRESENT"] == 1
    assert data["counts"]["ABSENT"] == 1
    assert data["counts"]["NO_SCHEDULE"] == 0


def test_hr_snapshot_without_active_schedule_reports_no_schedule(db):
    hr = make_user("hr@x.test", role=User.Role.HR)
    make_user("emp@x.test")

    response = client_for(hr).get("/api/v1/attendance/snapshot?date=2026-10-19")

    assert response.status_code == status.HTTP_200_OK, response.data
    data = response.data["data"]
    assert data["schedule"] is None
    assert data["counts"]["NO_SCHEDULE"] == 1
    assert all(row["state"] == "NO_SCHEDULE" for row in data["employees"])
