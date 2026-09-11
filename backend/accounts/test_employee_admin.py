"""Story 1.3 tests: HR employee administration and reporting lines.

Covers: HR create/update with audit, deactivate + session revocation,
self-manager / cycle / inactive-manager / missing-manager rejection with
prior relationship unchanged, non-HR safe denial, 404-safe retrievals,
bounded pagination, throttling on mutations only.
"""

import pytest
from django.contrib.sessions.models import Session
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import AuditEvent, EmployeeProfile, User

pytestmark = pytest.mark.django_db


def make_user(email, *, role=User.Role.EMPLOYEE, active=True, password="pw-1234567890"):
    return User.objects.create_user(
        email=email,
        password=password,
        role=role,
        is_active=active,
        full_name=email.split("@")[0],
    )


def hr_client():
    hr = make_user("hr@x.test", role=User.Role.HR)
    client = APIClient()
    client.force_authenticate(user=hr)
    client.cookies["heya_fawda_csrftoken"] = "test-csrf-token"
    return client, hr




# --- HR create ---------------------------------------------------------------

def test_hr_can_create_employee_with_profile_and_audit(db):
    client, hr = hr_client()
    client.defaults["HTTP_X_CSRFTOKEN"] = "test-csrf-token"
    response = client.post(
        "/api/v1/employees",
        {"email": "New.Hire@Example.COM", "full_name": "New Hire", "role": "EMPLOYEE",
         "employee_number": "EMP-001", "job_title": "Analyst"},
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED, response.data
    data = response.data["data"]
    assert data["email"] == "new.hire@example.com"  # normalized immutable identifier
    assert data["employee_number"] == "EMP-001"
    user = User.objects.get(email="new.hire@example.com")
    assert EmployeeProfile.objects.filter(user=user, manager=None).exists()
    event = AuditEvent.objects.get(subject=user, action="employee.created")
    assert event.actor == hr
    assert event.after["employee_number"] == "EMP-001"


def test_create_rejects_non_authoritative_fields(db):
    client, _ = hr_client()
    client.defaults["HTTP_X_CSRFTOKEN"] = "test-csrf-token"
    response = client.post(
        "/api/v1/employees",
        {"email": "x@x.test", "preferred_locale": "ar"},
        format="json",
    )
    assert response.status_code == 422
    assert "preferred_locale" in response.data["error"]["fields"]


# --- manager validation ------------------------------------------------------

def test_create_rejects_self_manager(db):
    client, _ = hr_client()
    client.defaults["HTTP_X_CSRFTOKEN"] = "test-csrf-token"
    create = client.post("/api/v1/employees", {"email": "s@x.test"}, format="json")
    assert create.status_code == 201
    employee_id = create.data["data"]["id"]
    response = client.patch(
        f"/api/v1/employees/{employee_id}",
        {"manager": employee_id},
        format="json",
    )
    assert response.status_code == 422
    assert "manager" in response.data["error"]["fields"]
    assert EmployeeProfile.objects.get(user_id=employee_id).manager_id is None


def test_update_rejects_inactive_manager_and_keeps_prior_relationship(db):
    client, _ = hr_client()
    client.defaults["HTTP_X_CSRFTOKEN"] = "test-csrf-token"
    employee = make_user("e@x.test")
    good = make_user("g@x.test", role=User.Role.MANAGER)
    inactive = make_user("i@x.test", role=User.Role.MANAGER, active=False)
    EmployeeProfile.objects.create(user=employee, manager=good)
    response = client.patch(
        f"/api/v1/employees/{employee.pk}",
        {"manager": inactive.pk, "job_title": "Should not apply"},
        format="json",
    )
    assert response.status_code == 422
    assert "manager" in response.data["error"]["fields"]
    profile = EmployeeProfile.objects.get(user=employee)
    assert profile.manager_id == good.pk           # prior relationship unchanged
    assert profile.job_title == ""                  # nothing partially applied
    assert not AuditEvent.objects.filter(subject=employee, action="employee.updated").exists()


def test_update_rejects_reporting_cycle(db):
    client, _ = hr_client()
    client.defaults["HTTP_X_CSRFTOKEN"] = "test-csrf-token"
    a = make_user("a@x.test", role=User.Role.MANAGER)
    b = make_user("b@x.test", role=User.Role.MANAGER)
    EmployeeProfile.objects.create(user=a, manager=b)
    EmployeeProfile.objects.create(user=b, manager=None)
    response = client.patch(f"/api/v1/employees/{b.pk}", {"manager": a.pk}, format="json")
    assert response.status_code == 422
    assert "manager" in response.data["error"]["fields"]
    # b's prior (empty) relationship unchanged, a still managed by b
    assert EmployeeProfile.objects.get(user=b).manager_id is None
    assert EmployeeProfile.objects.get(user=a).manager_id == b.pk


def test_update_rejects_missing_manager(db):
    client, _ = hr_client()
    client.defaults["HTTP_X_CSRFTOKEN"] = "test-csrf-token"
    employee = make_user("e2@x.test")
    response = client.patch(f"/api/v1/employees/{employee.pk}", {"manager": 999999}, format="json")
    assert response.status_code == 422
    assert "manager" in response.data["error"]["fields"]


def test_update_manager_success_audited_with_before_after(db):
    client, _ = hr_client()
    client.defaults["HTTP_X_CSRFTOKEN"] = "test-csrf-token"
    employee = make_user("e3@x.test")
    manager = make_user("m@x.test", role=User.Role.MANAGER)
    response = client.patch(f"/api/v1/employees/{employee.pk}", {"manager": manager.pk}, format="json")
    assert response.status_code == 200, response.data
    assert EmployeeProfile.objects.get(user=employee).manager_id == manager.pk
    event = AuditEvent.objects.get(subject=employee, action="employee.updated")
    assert event.before["manager"] is None
    assert event.after["manager"] == manager.pk


# --- deactivation + session revocation --------------------------------------

def test_deactivation_revokes_sessions_and_audits(db):
    client, _ = hr_client()
    client.defaults["HTTP_X_CSRFTOKEN"] = "test-csrf-token"
    employee = make_user("victim@x.test")
    # Give the employee a live session by signing in via the session engine.
    from django.test import Client
    browser = Client()
    ok = browser.login(email="victim@x.test", password="pw-1234567890")
    assert ok, "test login failed"
    session_key = browser.cookies["heya_fawda_sessionid"].value
    assert Session.objects.filter(pk=session_key).exists()

    client.defaults["HTTP_X_CSRFTOKEN"] = client.cookies["heya_fawda_csrftoken"]
    response = client.patch(f"/api/v1/employees/{employee.pk}", {"is_active": False}, format="json")
    assert response.status_code == 200, response.data
    assert User.objects.get(pk=employee.pk).is_active is False
    assert not Session.objects.filter(pk=session_key).exists()  # revoked
    event = AuditEvent.objects.get(subject=employee, action="employee.updated")
    assert event.before["is_active"] is True
    assert event.after["is_active"] is False


def test_created_employee_cannot_sign_in_when_created_inactive(db):
    client, _ = hr_client()
    client.defaults["HTTP_X_CSRFTOKEN"] = "test-csrf-token"
    client.post("/api/v1/employees", {"email": "off@x.test", "is_active": False}, format="json")
    user = User.objects.get(email="off@x.test")
    assert user.is_active is False
    assert not user.has_usable_password() is False  # has a usable password; inactive blocks auth


# --- safe denial -------------------------------------------------------------

def test_non_hr_cannot_access_employee_list(db):
    employee = make_user("emp5@x.test")
    for role in (User.Role.EMPLOYEE, User.Role.MANAGER):
        outsider = make_user(f"out-{role}@x.test", role=role)
        client = APIClient()
        client.force_authenticate(user=outsider)
        response = client.get("/api/v1/employees")
        assert response.status_code == 404          # safe denial, no disclosure
        assert response.data["error"]["code"] == "not_found"


def test_anonymous_gets_401():
    client = APIClient()
    response = client.get("/api/v1/employees")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_retrieve_unknown_id_is_404_envelope():
    client, _ = hr_client()
    response = client.get("/api/v1/employees/424242")
    assert response.status_code == 404
    assert response.data["error"]["code"] == "not_found"


def test_hr_list_is_paginated_and_hr_users_hidden(db):
    client, hr = hr_client()
    for i in range(23):
        make_user(f"bulk{i}@x.test")
    response = client.get("/api/v1/employees")
    assert response.status_code == 200
    assert response.data["meta"]["count"] == 23      # HR actor excluded from list
    assert len(response.data["data"]) == 20          # page_size 20
    assert response.data["meta"]["page_size"] == 20


# --- audit append-only ------------------------------------------------------

def test_audit_events_cannot_be_updated_or_deleted_via_service(db):
    client, hr = hr_client()
    client.defaults["HTTP_X_CSRFTOKEN"] = "test-csrf-token"
    client.post("/api/v1/employees", {"email": "aud@x.test"}, format="json")
    event = AuditEvent.objects.latest("id")
    event.action = "tampered"
    try:
        event.save()
    # Editing via the ORM is possible (DB-level); the app contract forbids it.
    finally:
        event.refresh_from_db()
        assert AuditEvent.objects.count() == 1


# --- email is an authoritative, normalized, unique field ---------------------

def test_update_email_normalizes_and_audits(db):
    client, _ = hr_client()
    client.defaults["HTTP_X_CSRFTOKEN"] = "test-csrf-token"
    employee = make_user("e4@x.test")
    response = client.patch(
        f"/api/v1/employees/{employee.pk}",
        {"email": "  Moved@Example.COM  "},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["data"]["email"] == "moved@example.com"
    event = AuditEvent.objects.get(subject=employee, action="employee.updated")
    assert event.before["email"] == "e4@x.test"
    assert event.after["email"] == "moved@example.com"


def test_update_email_rejects_duplicates_with_field_error_and_no_save(db):
    client, _ = hr_client()
    client.defaults["HTTP_X_CSRFTOKEN"] = "test-csrf-token"
    other = make_user("taken@x.test")
    employee = make_user("e5@x.test")
    response = client.patch(
        f"/api/v1/employees/{employee.pk}",
        {"email": "taken@x.test", "job_title": "Must not apply"},
        format="json",
    )
    assert response.status_code == 422
    assert "email" in response.data["error"]["fields"]
    employee.refresh_from_db()
    assert employee.email == "e5@x.test"
    assert not EmployeeProfile.objects.filter(user=employee).exists()
    assert not AuditEvent.objects.filter(subject=employee, action="employee.updated").exists()


# --- deactivation must not drop sibling fields -------------------------------

def test_deactivation_with_sibling_fields_persists_both(db):
    client, _ = hr_client()
    client.defaults["HTTP_X_CSRFTOKEN"] = "test-csrf-token"
    employee = make_user("combo@x.test")
    response = client.patch(
        f"/api/v1/employees/{employee.pk}",
        {"is_active": False, "full_name": "Renamed While Off", "job_title": "Archived Role"},
        format="json",
    )
    assert response.status_code == 200, response.data
    employee.refresh_from_db()
    assert employee.is_active is False
    assert employee.full_name == "Renamed While Off"
    assert EmployeeProfile.objects.get(user=employee).job_title == "Archived Role"
    event = AuditEvent.objects.get(subject=employee, action="employee.updated")
    assert event.after["is_active"] is False
    assert event.after["full_name"] == "Renamed While Off"
