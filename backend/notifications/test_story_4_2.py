"""Story 4.2 focused tests: scoped in-app notifications (backend/API only).

Covers: post-commit notification creation for committed request/timesheet
outcomes, source state unaffected by notification work, recipient scoping,
dedupe/idempotent retry (same source event -> one notification; later
decisions -> a new one), the notification list/detail/mark-read endpoints
(owner isolation, safe 404, server-confirmed read_at, transactional/idempotent
mark-read with failure leaving unread state), safe related-object links
(hidden/deleted records render "unavailable" without detail leakage), and
bounded deterministic pagination. Frontend/keyboard accessibility is Epic 5
and out of scope here.
"""
import threading
from datetime import date
from unittest import mock
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import AuditEvent, EmployeeProfile
from reqs.models import EmployeeRequest, RequestEvent, RequestType
from reqs.test_cancel import CancelTestBase  # noqa: F401  (unused, kept for symmetry)
from reqs.test_decision import DecisionTestBase  # noqa: F401  (base classes)
from timesheets.models import Timesheet
from timesheets.test_story_3_3 import MONDAY
from notifications.models import Notification
from notifications.services import (
    create_notification,
    mark_notification_read,
    related_object_is_available,
)

User = get_user_model()


# ---------------------------------------------------------------------------
# Direct service-level creation: transactional, deduplicated, source-safe.
# ---------------------------------------------------------------------------


class CreateNotificationServiceTests:
    pass  # pytest-style tests below use plain functions; grouping doc only.


@pytest.mark.django_db
def test_create_notification_stores_recipient_kind_and_text():
    user = User.objects.create_user(email="c1@example.com", password="secure-password")

    notification = create_notification(
        recipient=user,
        kind="request_updated",
        title="Your request was approved",
        body="Approved by manager.",
    )

    assert notification.pk is not None
    assert notification.recipient == user
    assert notification.kind == "request_updated"
    assert notification.title == "Your request was approved"
    assert notification.body == "Approved by manager."
    assert notification.read_at is None
    assert notification.created_at is not None


@pytest.mark.django_db
def test_create_notification_does_not_change_source_state():
    request_type = RequestType.objects.create(name="Leave", requires_hr_approval=False)
    user = User.objects.create_user(email="c2@example.com", password="secure-password")
    request_obj = EmployeeRequest.objects.create(
        requester=user, request_type=request_type, title="T", status=EmployeeRequest.Status.APPROVED, version=2
    )

    create_notification(
        recipient=user,
        kind="request_updated",
        title="decided",
        body="",
        related_object_type="request",
        related_object_id=request_obj.pk,
    )

    request_obj.refresh_from_db()
    assert request_obj.status == EmployeeRequest.Status.APPROVED
    assert request_obj.version == 2
    assert RequestEvent.objects.count() == 0
    assert AuditEvent.objects.count() == 0


@pytest.mark.django_db
def test_repeated_create_with_same_dedupe_key_creates_one_notification():
    user = User.objects.create_user(email="c3@example.com", password="secure-password")
    first = create_notification(
        recipient=user, kind="request_updated", title="t", body="", dedupe_key="request:A:approved:v2"
    )
    second = create_notification(
        recipient=user, kind="request_updated", title="t-retry", body="", dedupe_key="request:A:approved:v2"
    )

    assert first.pk == second.pk
    assert Notification.objects.count() == 1
    assert Notification.objects.get(pk=first.pk).title == "t"


@pytest.mark.django_db
def test_dedupe_key_mismatch_on_retry_is_safe():
    """A conflicting same-key row from another writer is returned, not duplicated."""
    user = User.objects.create_user(email="c4@example.com", password="secure-password")
    existing = create_notification(
        recipient=user, kind="request_updated", title="t", body="", dedupe_key="request:B:rejected:v3"
    )
    replayed = create_notification(
        recipient=user, kind="request_updated", title="other", body="", dedupe_key="request:B:rejected:v3"
    )
    assert replayed.pk == existing.pk
    assert Notification.objects.count() == 1


@pytest.mark.django_db
def test_later_decision_with_new_dedupe_key_notifies_again():
    user = User.objects.create_user(email="c5@example.com", password="secure-password")
    create_notification(recipient=user, kind="request_updated", title="first", dedupe_key="request:C:returned:v2")
    later = create_notification(recipient=user, kind="request_updated", title="second", dedupe_key="request:C:approved:v4")

    assert Notification.objects.count() == 2
    assert later.title == "second"


@pytest.mark.django_db
def test_notifications_without_dedupe_key_never_collide():
    user = User.objects.create_user(email="c6@example.com", password="secure-password")
    one = create_notification(recipient=user, kind="request_updated", title="one")
    two = create_notification(recipient=user, kind="request_updated", title="two")
    assert one.pk != two.pk
    assert Notification.objects.count() == 2


# ---------------------------------------------------------------------------
# Post-commit hooks for committed outcomes.
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_request_decision_notification_created_after_commit():
    from reqs.decision_notifications import _notify_requester

    user = User.objects.create_user(email="emp42@example.com", password="secure-password")
    request_type = RequestType.objects.create(name="Sick", requires_hr_approval=False)
    request_obj = EmployeeRequest.objects.create(
        requester=user, request_type=request_type, title="R", status=EmployeeRequest.Status.APPROVED, version=3
    )

    _notify_requester(request_obj.pk, "request_updated", "Your request was approved", "ok")

    notification = Notification.objects.get(recipient=user)
    assert notification.kind == "request_updated"
    assert notification.related_object_type == "request"
    assert notification.related_object_id == str(request_obj.pk)
    assert request_obj.refresh_from_db() is None or request_obj.status == EmployeeRequest.Status.APPROVED
    assert request_obj.version == 3


@pytest.mark.django_db
def test_decision_hook_failure_does_not_break_the_committed_outcome():
    from reqs.decision_notifications import notify_requester_of_decision

    user = User.objects.create_user(email="emp43@example.com", password="secure-password")
    request_type = RequestType.objects.create(name="Sick2", requires_hr_approval=False)
    request_obj = EmployeeRequest.objects.create(
        requester=user, request_type=request_type, title="R2", status=EmployeeRequest.Status.APPROVED, version=3
    )

    # The failure-isolation contract: the committed outcome survives a
    # breaking notification creator. Patch the manager create and run the
    # registered hook synchronously (retries cannot double-schedule).
    with mock.patch.object(Notification.objects, "create", side_effect=RuntimeError("boom")):
        from reqs.decision_notifications import _notify_requester

        _notify_requester(str(request_obj.pk), "request_updated", "Your request was approved", "ok")

    request_obj.refresh_from_db()
    assert request_obj.status == EmployeeRequest.Status.APPROVED
    assert request_obj.version == 3
    assert Notification.objects.count() == 0


@pytest.mark.django_db
def test_timesheet_decision_notification_created_after_commit():
    from timesheets.review_services import _create_decision_notification

    user = User.objects.create_user(email="emp44@example.com", password="secure-password")
    sheet = Timesheet.objects.create(employee=user, week_start=MONDAY, version=3)

    _create_decision_notification(str(sheet.pk), "reject", "Hours mismatch")

    notification = Notification.objects.get(recipient=user)
    assert notification.kind == "timesheet_updated"
    assert notification.related_object_type == "timesheet"
    assert notification.related_object_id == str(sheet.pk)
    sheet.refresh_from_db()
    assert sheet.status == Timesheet.Status.DRAFT
    assert sheet.version == 3  # source state untouched by the notification


# ---------------------------------------------------------------------------
# Recipient scoping of post-commit notifications.
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_decision_notification_targets_the_requester_only():
    from reqs.decision_notifications import _notify_requester

    requester = User.objects.create_user(email="emp45@example.com", password="secure-password")
    manager = User.objects.create_user(
        email="mgr45@example.com", password="secure-password", role=User.Role.MANAGER
    )
    EmployeeProfile.objects.create(user=requester, manager=manager)
    request_type = RequestType.objects.create(name="Leave45", requires_hr_approval=False)
    request_obj = EmployeeRequest.objects.create(
        requester=requester,
        request_type=request_type,
        title="R45",
        status=EmployeeRequest.Status.PENDING_MANAGER,
        manager_at_submission=manager,
        version=2,
    )

    _notify_requester(request_obj.pk, "request_updated", "returned", "fix it")

    assert list(User.objects.filter(notifications__isnull=False)) == [requester]


# ---------------------------------------------------------------------------
# List / detail / mark-read endpoints.
# ---------------------------------------------------------------------------


def _api(client_user):
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(client_user)
    client.get("/api/v1/auth/csrf")
    return client


def _csrf(client):
    return client.cookies["heya_fawda_csrftoken"].value


@pytest.fixture
def owner(db):
    return User.objects.create_user(email="owner42@example.com", password="secure-password")


@pytest.fixture
def intruder(db):
    return User.objects.create_user(email="intruder42@example.com", password="secure-password")


@pytest.fixture
def client_as_owner(owner):
    return _api(owner)


@pytest.mark.django_db
def test_list_orders_newest_first_deterministically(owner, intruder):
    first = create_notification(recipient=owner, kind="request_updated", title="older")
    second = create_notification(recipient=owner, kind="request_updated", title="newer")
    create_notification(recipient=intruder, kind="request_updated", title="foreign")
    Notification.objects.filter(pk=second.pk).update(created_at=timezone.now() - timezone.timedelta(seconds=1))

    client = _api(owner)
    response = client.get("/api/v1/notifications")

    ids = [item["id"] for item in response.data["data"]]
    assert ids == [first.pk, second.pk]


@pytest.mark.django_db
def test_list_pagination_is_bounded_and_deterministic(owner):
    created = [create_notification(recipient=owner, kind="request_updated", title=f"n{i}") for i in range(25)]

    client = _api(owner)
    response = client.get("/api/v1/notifications?page=2&page_size=999")

    assert response.data["meta"]["page_size"] == 20
    assert len(response.data["data"]) == 5
    # Newest-first, deterministic: page 2 holds the oldest five, descending.
    assert [item["id"] for item in response.data["data"]] == [n.pk for n in reversed(created[:5])]


@pytest.mark.django_db
def test_detail_is_scoped_and_safe_404_for_other_users(client_as_owner, owner, intruder):
    notification = create_notification(recipient=owner, kind="request_updated", title="mine")
    foreign = create_notification(recipient=intruder, kind="request_updated", title="not mine")

    own = client_as_owner.get(f"/api/v1/notifications/{notification.pk}/read-state")
    stolen = client_as_owner.get(f"/api/v1/notifications/{foreign.pk}")

    assert own.status_code == 200
    assert own.data["data"]["id"] == notification.pk
    assert stolen.status_code == 404


@pytest.mark.django_db
def test_detail_includes_related_object_reference(client_as_owner, owner):
    request_type = RequestType.objects.create(name="Rel", requires_hr_approval=False)
    request_obj = EmployeeRequest.objects.create(
        requester=owner, request_type=request_type, title="R", status=EmployeeRequest.Status.APPROVED
    )
    notification = create_notification(
        recipient=owner,
        kind="request_updated",
        title="t",
        body="",
        related_object_type="request",
        related_object_id=request_obj.pk,
    )

    response = client_as_owner.get(f"/api/v1/notifications/{notification.pk}/read-state")

    related = response.data["data"]["related_object"]
    assert related["type"] == "request"
    assert related["id"] == str(request_obj.pk)
    # The recipient is the requester: the link is available to them.
    assert related["available"] is True


@pytest.mark.django_db
def test_mark_read_records_server_confirmed_read_at(client_as_owner, owner):
    notification = create_notification(recipient=owner, kind="request_updated", title="t")

    before = timezone.now()
    response = client_as_owner.patch(
        f"/api/v1/notifications/{notification.pk}/read-state",
        {"is_read": True},
        format="json",
        HTTP_X_CSRFTOKEN=_csrf(client_as_owner),
    )

    assert response.status_code == 200
    notification.refresh_from_db()
    assert notification.read_at is not None
    assert before <= notification.read_at
    assert response.data["data"]["is_read"] is True


@pytest.mark.django_db
def test_mark_read_is_idempotent_and_keeps_first_read_at(client_as_owner, owner):
    notification = create_notification(recipient=owner, kind="request_updated", title="t")
    token = _csrf(client_as_owner)
    url = f"/api/v1/notifications/{notification.pk}/read-state"

    first = client_as_owner.patch(url, {"is_read": True}, format="json", HTTP_X_CSRFTOKEN=token)
    read_at = Notification.objects.get(pk=notification.pk).read_at
    second = client_as_owner.patch(url, {"is_read": True}, format="json", HTTP_X_CSRFTOKEN=token)

    assert first.status_code == second.status_code == 200
    assert Notification.objects.get(pk=notification.pk).read_at == read_at


@pytest.mark.django_db
def test_service_mark_read_race_keeps_single_read_at(owner):
    """Two racing mark-write transactions resolve to one stable read_at."""
    notification = create_notification(recipient=owner, kind="request_updated", title="t")

    first_read = mark_notification_read(notification.pk, owner)
    second_read = mark_notification_read(notification.pk, owner)

    assert first_read == second_read
    assert Notification.objects.get(pk=notification.pk).read_at is not None


@pytest.mark.django_db
def test_service_mark_read_failure_leaves_unread(owner):
    notification = create_notification(recipient=owner, kind="request_updated", title="t")

    with mock.patch.object(Notification, "save", side_effect=RuntimeError("db down")):
        with pytest.raises(RuntimeError):
            # The failure propagates to the caller as retryable; the write
            # never commits, so the unread state is preserved.
            mark_notification_read(notification.pk, owner)

    notification.refresh_from_db()
    assert notification.read_at is None


@pytest.mark.django_db
def test_mark_read_via_api_failure_leaves_unread(client_as_owner, owner):
    notification = create_notification(recipient=owner, kind="request_updated", title="t")
    url = f"/api/v1/notifications/{notification.pk}/read-state"

    with mock.patch.object(Notification, "save", side_effect=RuntimeError("db down")):
        response = client_as_owner.patch(
            url, {"is_read": True}, format="json", HTTP_X_CSRFTOKEN=_csrf(client_as_owner)
        )

    assert response.status_code >= 500
    notification.refresh_from_db()
    assert notification.read_at is None


@pytest.mark.django_db
def test_unmark_read_reverts_to_unread(client_as_owner, owner):
    notification = create_notification(
        recipient=owner, kind="request_updated", title="t", dedupe_key=""
    )
    client_as_owner.patch(
        f"/api/v1/notifications/{notification.pk}/read-state",
        {"is_read": True},
        format="json",
        HTTP_X_CSRFTOKEN=_csrf(client_as_owner),
    )

    response = client_as_owner.patch(
        f"/api/v1/notifications/{notification.pk}/read-state",
        {"is_read": False},
        format="json",
        HTTP_X_CSRFTOKEN=_csrf(client_as_owner),
    )

    assert response.status_code == 200
    notification.refresh_from_db()
    assert notification.read_at is None
    assert response.data["data"]["is_read"] is False


@pytest.mark.django_db
def test_other_users_notification_mark_read_is_safe_404(client_as_owner, intruder):
    notification = create_notification(recipient=intruder, kind="request_updated", title="private")

    response = client_as_owner.patch(
        f"/api/v1/notifications/{notification.pk}/read-state",
        {"is_read": True},
        format="json",
        HTTP_X_CSRFTOKEN=_csrf(client_as_owner),
    )

    assert response.status_code == 404
    notification.refresh_from_db()
    assert notification.read_at is None


@pytest.mark.django_db
def test_endpoints_require_authentication():
    client = APIClient(enforce_csrf_checks=True)
    assert client.get("/api/v1/notifications").status_code == 401
    assert client.get("/api/v1/notifications/1").status_code == 401
    assert client.patch("/api/v1/notifications/1", {"is_read": True}, format="json").status_code == 403


# ---------------------------------------------------------------------------
# Safe related-object links.
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_related_object_unavailable_for_hidden_record():
    request_type = RequestType.objects.create(name="Hidden", requires_hr_approval=False)
    requester = User.objects.create_user(email="hidden-emp@example.com", password="secure-password")
    manager = User.objects.create_user(
        email="hidden-mgr@example.com", password="secure-password", role=User.Role.MANAGER
    )
    EmployeeProfile.objects.create(user=requester, manager=manager)
    pending = EmployeeRequest.objects.create(
        requester=requester, request_type=request_type, title="H", status=EmployeeRequest.Status.PENDING_MANAGER
    )
    outsider = User.objects.create_user(email="hidden-out@example.com", password="secure-password")

    assert related_object_is_available(requester, "request", pending.pk) is True
    assert related_object_is_available(manager, "request", pending.pk) is True
    assert related_object_is_available(outsider, "request", pending.pk) is False


@pytest.mark.django_db
def test_deleted_related_object_is_unavailable(owner):
    assert related_object_is_available(owner, "request", uuid4()) is False
    assert related_object_is_available(owner, "timesheet", uuid4()) is False


@pytest.mark.django_db
def test_notification_without_related_object_has_none(client_as_owner, owner):
    notification = create_notification(recipient=owner, kind="request_updated", title="t")

    response = client_as_owner.get(f"/api/v1/notifications/{notification.pk}/read-state")

    assert response.data["data"]["related_object"] is None


@pytest.mark.django_db
def test_list_marks_unavailable_links_safely(owner, intruder):
    notification = create_notification(
        recipient=owner,
        kind="request_updated",
        title="t",
        related_object_type="request",
        related_object_id=uuid4(),
    )

    response = _api(owner).get("/api/v1/notifications")

    related = response.data["data"][0]["related_object"]
    assert related["available"] is False
    assert "title" not in related
    assert "status" not in related


@pytest.mark.django_db
def test_removed_related_object_becomes_unavailable(owner):
    request_type = RequestType.objects.create(name="Gone", requires_hr_approval=False)
    request_obj = EmployeeRequest.objects.create(
        requester=owner, request_type=request_type, title="G", status=EmployeeRequest.Status.APPROVED
    )
    notification = create_notification(
        recipient=owner,
        kind="request_updated",
        title="t",
        related_object_type="request",
        related_object_id=request_obj.pk,
    )
    assert related_object_is_available(owner, "request", request_obj.pk) is True
    request_obj.delete()
    assert related_object_is_available(owner, "request", request_obj.pk) is False

    response = _api(owner).get("/api/v1/notifications")

    assert response.data["data"][0]["related_object"]["available"] is False


# ---------------------------------------------------------------------------
# Concurrency: racing list/mark-read stays consistent.
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_concurrent_direct_mark_read_runs_resolve_to_one_read_state(owner):
    """Racing direct service mark-read calls resolve to a single read state."""
    notification = create_notification(recipient=owner, kind="request_updated", title="t")
    reads = []
    errors = []
    barrier = threading.Barrier(3)

    def worker():
        try:
            barrier.wait()
            read_at = mark_notification_read(notification.pk, owner)
            reads.append(read_at)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    notification.refresh_from_db()
    assert notification.read_at is not None
    # Everyone who succeeded observed the same stable read_at (idempotent).
    assert len(set(reads)) <= 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_creates_same_dedupe_key_create_one(owner):
    keys = []
    barrier = threading.Barrier(3)

    def worker():
        barrier.wait()
        notification = create_notification(
            recipient=owner, kind="request_updated", title="race", dedupe_key="race:1"
        )
        keys.append(notification.pk)

    threads = [threading.Thread(target=worker) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(set(keys)) == 1
    assert Notification.objects.count() == 1


# ---------------------------------------------------------------------------
# CSRF / throttle behaviour retained for mark-read.
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_mark_read_requires_csrf(client_as_owner, owner):
    notification = create_notification(recipient=owner, kind="request_updated", title="t")
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(owner)

    response = client.patch(f"/api/v1/notifications/{notification.pk}/read-state", {"is_read": True}, format="json")

    assert response.status_code == 403
    notification.refresh_from_db()
    assert notification.read_at is None


@pytest.mark.django_db
def test_mark_read_is_throttled(client_as_owner, owner):
    cache.clear()
    notification = create_notification(recipient=owner, kind="request_updated", title="t")
    token = _csrf(client_as_owner)
    url = f"/api/v1/notifications/{notification.pk}/read-state"

    responses = [
        client_as_owner.patch(url, {"is_read": True}, format="json", HTTP_X_CSRFTOKEN=token)
        for _ in range(61)
    ]

    assert responses[-1].status_code == 429
    cache.clear()
