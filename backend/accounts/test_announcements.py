"""The «الإعلانات الداخلية» server half — model, endpoints and the send log.

Every test asserts the state change it names. The four load-bearing
behaviours are the brief's own:

  (a) HR authors a draft and publishes it;
  (b) an employee the audience covers sees the announcement and an employee it
      does not cover never does;
  (c) the send log says exactly what the server did — one delivery row per
      publish, audience snapshotted, the in-app feed as the only channel, and
      nothing logged for a draft;
  (d) an employee cannot author, publish, or read the log.

Plus the discipline the rest of the API keeps: Idempotency-Key on mutations,
optimistic version on publish, a cross-tenant/inactive recipient refused, and
401 for anonymous callers.

Clients are force-authenticated the way accounts/test_work_schedules.py does it
(the project's own API-test convention), so CSRF never masks a permission bug.
"""
import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import (
    Announcement,
    AnnouncementDelivery,
    Company,
    User,
)
from accounts.tests import anon_client  # noqa: F401 — shared pytest fixture
from tenants.context import default_company

pytestmark = pytest.mark.django_db

BASE = "/api/v1/announcements"
PASSWORD = "correct-horse-battery-strong"


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    """The mutation throttle counts in the cache; keep tests independent."""
    cache.clear()
    yield
    cache.clear()


def make_user(email, role=User.Role.EMPLOYEE, company=None, is_active=True):
    return User.objects.create_user(
        company=company or default_company(),
        email=email,
        password=PASSWORD,
        role=role,
        full_name=email.split("@")[0],
        is_active=is_active,
    )


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    client.cookies["heya_fawda_csrftoken"] = "test-csrf-token"
    return client


def author(client, key="create-1", **overrides):
    payload = {"title": "إعلان تجريبي", "body": "نص الإعلان", "audience": "ALL"}
    payload.update(overrides)
    return client.post(BASE, payload, format="json", HTTP_IDEMPOTENCY_KEY=key)


def publish(client, announcement_id, version, key="publish-1"):
    return client.post(
        f"{BASE}/{announcement_id}/publish",
        {"version": version},
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )


# --- (a) HR authors and publishes ---------------------------------------------

def test_hr_authors_a_draft_then_publishes_it(db):
    hr = make_user("hr@x.test", role=User.Role.HR)
    client = client_for(hr)

    created = author(client, key="create-a")
    assert created.status_code == status.HTTP_201_CREATED, created.data
    draft = created.data["data"]
    assert draft["state"] == "DRAFT"
    assert draft["published_at"] is None
    assert draft["version"] == 1
    assert draft["author_id"] == hr.pk
    assert Announcement.objects.get(pk=draft["id"]).company == default_company()

    sent = publish(client, draft["id"], draft["version"], key="publish-a")
    assert sent.status_code == status.HTTP_200_OK, sent.data
    published = sent.data["data"]
    assert published["state"] == "PUBLISHED"
    assert published["published_at"] is not None
    assert published["version"] == 2
    assert sent.data["delivery"]["channel"] == "in_app_feed"


# --- (b) the audience decides who sees it -------------------------------------

def test_employee_in_audience_sees_it_and_outsider_does_not(db):
    hr = make_user("hr@x.test", role=User.Role.HR)
    insider = make_user("insider@x.test")
    outsider = make_user("outsider@x.test")
    hr_client = client_for(hr)

    created = author(
        hr_client,
        title="للفريق المالي فقط",
        audience="SELECTED",
        recipients=[insider.pk],
        key="create-selected",
    )
    assert created.status_code == status.HTTP_201_CREATED, created.data
    announcement_id = created.data["data"]["id"]
    assert publish(hr_client, announcement_id, created.data["data"]["version"], key="publish-selected").status_code == 200

    inside_feed = client_for(insider).get(BASE).data["data"]
    assert [row["id"] for row in inside_feed] == [announcement_id]
    # The recipient learns nothing about who ELSE was named.
    assert inside_feed[0]["recipients"] == []

    outside_feed = client_for(outsider).get(BASE).data["data"]
    assert outside_feed == []


def test_all_audience_reaches_every_active_employee(db):
    hr = make_user("hr@x.test", role=User.Role.HR)
    first = make_user("first@x.test")
    second = make_user("second@x.test")
    hr_client = client_for(hr)

    created = author(hr_client, audience="ALL", key="create-all")
    announcement_id = created.data["data"]["id"]
    assert publish(hr_client, announcement_id, 1, key="publish-all").status_code == 200

    for employee in (first, second):
        feed = client_for(employee).get(BASE).data["data"]
        assert [row["id"] for row in feed] == [announcement_id]


def test_a_draft_is_never_in_an_employee_feed(db):
    hr = make_user("hr@x.test", role=User.Role.HR)
    employee = make_user("emp@x.test")
    hr_client = client_for(hr)
    created = author(hr_client, audience="ALL", key="create-draft-only")
    assert created.data["data"]["state"] == "DRAFT"

    assert client_for(employee).get(BASE).data["data"] == []
    # HR, by contrast, sees the draft.
    hr_rows = hr_client.get(BASE).data["data"]
    assert [row["id"] for row in hr_rows] == [created.data["data"]["id"]]


# --- (c) the send log records exactly what happened ---------------------------

def test_send_log_records_what_the_server_actually_did(db):
    hr = make_user("hr@x.test", role=User.Role.HR)
    make_user("a@x.test")
    make_user("b@x.test")
    hr_client = client_for(hr)

    created = author(hr_client, title="إعلان عام", audience="ALL", key="create-log")
    announcement_id = created.data["data"]["id"]

    # Nothing is logged for a draft: no publish has happened yet.
    assert AnnouncementDelivery.objects.count() == 0

    sent = publish(hr_client, announcement_id, 1, key="publish-log")
    assert sent.status_code == status.HTTP_200_OK, sent.data

    # Exactly ONE row — no duplicate, no second "channel" invented.
    assert AnnouncementDelivery.objects.count() == 1
    log = hr_client.get(f"{BASE}/log").data["data"]
    assert len(log) == 1
    row = log[0]
    assert row["announcement_id"] == announcement_id
    assert row["announcement_title"] == "إعلان عام"
    assert row["audience"] == "ALL"
    assert row["channel"] == "in_app_feed"
    assert row["sent_by_id"] == hr.pk
    assert row["sent_at"] is not None
    # recipient_count is the resolved audience at publish time (every active
    # user of the company: the two employees AND the HR author).
    assert row["recipient_count"] == User.objects.filter(
        company=default_company(), is_active=True
    ).count()


def test_selected_send_log_counts_only_the_named_recipients(db):
    hr = make_user("hr@x.test", role=User.Role.HR)
    insider = make_user("insider@x.test")
    make_user("outsider@x.test")
    hr_client = client_for(hr)

    created = author(hr_client, audience="SELECTED", recipients=[insider.pk], key="create-count")
    announcement_id = created.data["data"]["id"]
    publish(hr_client, announcement_id, 1, key="publish-count")

    row = hr_client.get(f"{BASE}/log").data["data"][0]
    assert row["audience"] == "SELECTED"
    assert row["recipient_count"] == 1


# --- (d) an employee cannot author, publish, or read the log ------------------

def test_employee_cannot_author_publish_or_read_the_log(db):
    hr = make_user("hr@x.test", role=User.Role.HR)
    employee = make_user("emp@x.test")
    hr_client = client_for(hr)
    emp_client = client_for(employee)

    created = author(hr_client, key="create-for-deny")
    announcement_id = created.data["data"]["id"]

    denied = emp_client.post(
        BASE,
        {"title": "x", "body": "y", "audience": "ALL"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="emp-create",
    )
    assert denied.status_code == status.HTTP_403_FORBIDDEN
    assert denied.data["error"]["code"] == "permission_denied"

    publish_denied = emp_client.post(
        f"{BASE}/{announcement_id}/publish",
        {"version": 1},
        format="json",
        HTTP_IDEMPOTENCY_KEY="emp-publish",
    )
    assert publish_denied.status_code == status.HTTP_403_FORBIDDEN

    assert emp_client.get(f"{BASE}/log").status_code == status.HTTP_403_FORBIDDEN
    # The employee's refusal created no row.
    assert Announcement.objects.count() == 1


# --- discipline: idempotency, version, tenant, auth --------------------------

def test_publish_requires_an_idempotency_key(db):
    hr = make_user("hr@x.test", role=User.Role.HR)
    client = client_for(hr)
    created = author(client, key="create-no-key")
    response = client.post(
        f"{BASE}/{created.data['data']['id']}/publish", {"version": 1}, format="json"
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert response.data["error"]["code"] == "idempotency_key_required"


def test_replaying_the_same_publish_key_does_not_send_twice(db):
    hr = make_user("hr@x.test", role=User.Role.HR)
    client = client_for(hr)
    created = author(client, key="create-replay")
    announcement_id = created.data["data"]["id"]

    first = publish(client, announcement_id, 1, key="same-key")
    second = publish(client, announcement_id, 1, key="same-key")
    assert first.status_code == 200 and second.status_code == 200
    # The replay returns the SAME stored response and sends nothing again.
    assert first.data == second.data
    assert AnnouncementDelivery.objects.filter(announcement_id=announcement_id).count() == 1


def test_stale_version_and_republish_are_refused(db):
    hr = make_user("hr@x.test", role=User.Role.HR)
    client = client_for(hr)
    created = author(client, key="create-version")
    announcement_id = created.data["data"]["id"]

    stale = publish(client, announcement_id, 99, key="stale-key")
    assert stale.status_code == status.HTTP_409_CONFLICT
    assert stale.data["error"]["code"] == "version_conflict"

    assert publish(client, announcement_id, 1, key="ok-key").status_code == 200
    # Already published: a fresh key with the current version is a state conflict.
    again = publish(client, announcement_id, 2, key="again-key")
    assert again.status_code == status.HTTP_409_CONFLICT
    assert again.data["error"]["code"] == "state_conflict"
    assert AnnouncementDelivery.objects.count() == 1


def test_selected_recipient_must_be_an_active_member_of_the_company(db):
    hr = make_user("hr@x.test", role=User.Role.HR)
    client = client_for(hr)
    other = Company.objects.create(slug="other-co", name="Other")
    foreign = make_user("foreign@other.test", company=other)
    inactive = make_user("inactive@x.test", is_active=False)

    foreign_response = author(client, audience="SELECTED", recipients=[foreign.pk], key="foreign-key")
    assert foreign_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert "recipients" in foreign_response.data["error"]["fields"]

    inactive_response = author(client, audience="SELECTED", recipients=[inactive.pk], key="inactive-key")
    assert inactive_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    empty_response = author(client, audience="SELECTED", recipients=[], key="empty-key")
    assert empty_response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert not Announcement.objects.exists()


def test_anonymous_callers_get_401(anon_client):
    assert anon_client.get(BASE).status_code == status.HTTP_401_UNAUTHORIZED
    assert anon_client.get(f"{BASE}/log").status_code == status.HTTP_401_UNAUTHORIZED
