"""Story H39 tests: work schedules (the model + API, phase 1).

Covers: create-with-days in one transaction, the one-active-per-company
invariant (bootstrap activation, explicit switch, soft delete), day
validation (required times, end after start, duplicate/out-of-range
weekday, rest-day normalization), wholesale day replacement on PATCH,
uniform 404 for non-HR callers (permission-matrix 404 policy — the brief's
403 line was resolved to the approved matrix; see test_non_hr_gets_uniform_404),
401 for anonymous callers, and 404 for unknown ids.
"""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User, WorkSchedule, WorkScheduleDay
from tenants.context import default_company

pytestmark = pytest.mark.django_db

WORK_WEEK_DAYS = [
    {"weekday": wd, "is_working_day": wd < 5, "start_time": "08:00:00" if wd < 5 else None,
     "end_time": "16:00:00" if wd < 5 else None, "break_minutes": 60 if wd < 5 else 0}
    for wd in range(7)
]


def schedule_payload(**overrides):
    payload = {
        "name": "الدوام الرسمي",
        "effective_from": "2026-11-01",
        "days": [dict(day) for day in WORK_WEEK_DAYS],
    }
    payload.update(overrides)
    return payload


def hr_client():
    hr = User.objects.create_user(
        company=default_company(),
        email="hr@x.test",
        password="pw-1234567890",
        role=User.Role.HR,
        full_name="HR",
    )
    client = APIClient()
    client.force_authenticate(user=hr)
    client.cookies["heya_fawda_csrftoken"] = "test-csrf-token"
    return client, hr


def create_schedule(client, **overrides):
    response = client.post("/api/v1/work-schedules", schedule_payload(**overrides), format="json")
    assert response.status_code == status.HTTP_201_CREATED, response.data
    return response.data["data"]


def day_by_weekday(data, weekday):
    return next(day for day in data["days"] if day["weekday"] == weekday)


# --- create + days ------------------------------------------------------------

def test_hr_creates_schedule_with_days(db):
    client, hr = hr_client()
    data = create_schedule(client)
    assert data["name"] == "الدوام الرسمي"
    assert data["effective_from"] == "2026-11-01"
    assert data["is_active"] is True  # the company's first schedule activates itself
    assert len(data["days"]) == 7
    # 0=Sunday … 6=Saturday per the brief (the JS getDay order the SPA sends).
    assert day_by_weekday(data, 0)["is_working_day"] is True
    assert day_by_weekday(data, 5)["is_working_day"] is False
    assert WorkScheduleDay.objects.filter(schedule_id=data["id"]).count() == 7
    schedule = WorkSchedule.objects.get(pk=data["id"])
    assert schedule.created_by == hr
    assert schedule.company == default_company()


def test_second_schedule_without_is_active_does_not_steal_activation(db):
    client, _ = hr_client()
    first = create_schedule(client)
    second = create_schedule(client, name="رمضان")
    assert second["is_active"] is False
    assert WorkSchedule.objects.get(pk=first["id"]).is_active is True
    assert WorkSchedule.objects.filter(is_active=True).count() == 1


def test_explicit_activation_switches_exactly_one_active(db):
    client, _ = hr_client()
    first = create_schedule(client)
    second = create_schedule(client, name="رمضان")
    response = client.patch(
        f"/api/v1/work-schedules/{second['id']}", {"is_active": True}, format="json"
    )
    assert response.status_code == status.HTTP_200_OK, response.data
    assert response.data["data"]["is_active"] is True
    assert WorkSchedule.objects.get(pk=first["id"]).is_active is False
    assert WorkSchedule.objects.filter(is_active=True).count() == 1


def test_create_requires_name_effective_from_and_days(db):
    client, _ = hr_client()
    response = client.post("/api/v1/work-schedules", {}, format="json")
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    fields = response.data["error"]["fields"]
    for field in ("name", "effective_from", "days"):
        assert field in fields
    assert not WorkSchedule.objects.exists()


# --- day validation ------------------------------------------------------------

def test_working_day_requires_start_and_end(db):
    client, _ = hr_client()
    days = schedule_payload()["days"]
    days[0] = {"weekday": 0, "is_working_day": True}
    response = client.post("/api/v1/work-schedules", schedule_payload(days=days), format="json")
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert not WorkSchedule.objects.exists()  # nothing half-built


def test_end_time_must_be_after_start_time(db):
    client, _ = hr_client()
    days = schedule_payload()["days"]
    days[0] = {"weekday": 0, "is_working_day": True, "start_time": "08:00", "end_time": "08:00"}
    response = client.post("/api/v1/work-schedules", schedule_payload(days=days), format="json")
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "end_time" in response.data["error"]["fields"]["days"][0]


def test_rest_day_normalizes_leftover_times(db):
    client, _ = hr_client()
    days = schedule_payload()["days"]
    days[5] = {"weekday": 5, "is_working_day": False, "start_time": "08:00", "end_time": "16:00"}
    data = create_schedule(client, days=days)
    assert day_by_weekday(data, 5)["start_time"] is None
    assert day_by_weekday(data, 5)["end_time"] is None


def test_duplicate_weekday_in_one_request_is_rejected(db):
    client, _ = hr_client()
    days = schedule_payload()["days"]
    days[6] = {"weekday": 0, "is_working_day": False}
    response = client.post("/api/v1/work-schedules", schedule_payload(days=days), format="json")
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "days" in response.data["error"]["fields"]
    assert not WorkSchedule.objects.exists()


def test_weekday_outside_0_to_6_is_rejected(db):
    client, _ = hr_client()
    days = schedule_payload()["days"]
    days[0] = {"weekday": 7, "is_working_day": False}
    response = client.post("/api/v1/work-schedules", schedule_payload(days=days), format="json")
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert not WorkSchedule.objects.exists()


# --- patch / delete ------------------------------------------------------------

def test_patch_replaces_the_day_set_wholesale(db):
    client, _ = hr_client()
    data = create_schedule(client)
    five_day = [dict(day) for day in WORK_WEEK_DAYS if day["weekday"] < 5]
    response = client.patch(
        f"/api/v1/work-schedules/{data['id']}", {"days": five_day}, format="json"
    )
    assert response.status_code == status.HTTP_200_OK, response.data
    assert len(response.data["data"]["days"]) == 5
    assert WorkScheduleDay.objects.filter(schedule_id=data["id"]).count() == 5


def test_patch_rejects_effective_to_before_effective_from(db):
    client, _ = hr_client()
    data = create_schedule(client)
    response = client.patch(
        f"/api/v1/work-schedules/{data['id']}",
        {"effective_to": "2026-10-01"},
        format="json",
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "effective_to" in response.data["error"]["fields"]
    schedule = WorkSchedule.objects.get(pk=data["id"])
    assert schedule.effective_to is None  # prior state unchanged


def test_delete_deactivates_softly_and_keeps_the_row(db):
    client, _ = hr_client()
    data = create_schedule(client)
    response = client.delete(f"/api/v1/work-schedules/{data['id']}")
    assert response.status_code == status.HTTP_200_OK, response.data
    assert response.data["data"]["is_active"] is False
    schedule = WorkSchedule.objects.get(pk=data["id"])  # the row stays
    assert schedule.is_active is False
    listing = client.get("/api/v1/work-schedules")
    assert [row["id"] for row in listing.data["data"]] == [data["id"]]


# --- permission surface ---------------------------------------------------------

def test_non_hr_gets_uniform_404(db):
    """A manager or employee is answered with the same 404 envelope as an
    unknown resource: no disclosure that the schedule surface exists.

    The brief's test bullet said 403 here, but it also named ``IsHR`` and
    department_views parity; IsHR implements the approved permission-matrix
    404 policy ("inaccessible objects disclose no existence"), which is what
    departments/employees/holidays already do. This test pins the matrix.
    """
    hr_client()
    for role in (User.Role.MANAGER, User.Role.EMPLOYEE):
        outsider = User.objects.create_user(
            company=default_company(),
            email=f"out-{role}@x.test",
            password="pw-1234567890",
            role=role,
        )
        client = APIClient()
        client.force_authenticate(user=outsider)
        assert client.get("/api/v1/work-schedules").status_code == 404
        created = client.post("/api/v1/work-schedules", schedule_payload(), format="json")
        assert created.status_code == 404
        assert created.data["error"]["code"] == "not_found"
        assert client.get("/api/v1/work-schedules/1").status_code == 404
    assert not WorkSchedule.objects.exists()


def test_anonymous_gets_401():
    client = APIClient()
    assert client.get("/api/v1/work-schedules").status_code == status.HTTP_401_UNAUTHORIZED
    assert client.post("/api/v1/work-schedules", {}, format="json").status_code == 401


def test_unknown_id_is_404_envelope(db):
    client, _ = hr_client()
    response = client.get("/api/v1/work-schedules/424242")
    assert response.status_code == 404
    assert response.data["error"]["code"] == "not_found"
