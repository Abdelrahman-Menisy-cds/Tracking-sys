import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from notifications.models import Notification

User = get_user_model()


@pytest.fixture
def notification_owner(db):
    return User.objects.create_user(email="owner@example.com", password="secure-password")


@pytest.fixture
def other_user(db):
    return User.objects.create_user(email="other@example.com", password="secure-password")


@pytest.fixture
def authenticated_client(notification_owner):
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(notification_owner)
    client.get("/api/v1/auth/csrf")
    return client


def csrf_token(client):
    return client.cookies["heya_fawda_csrftoken"].value


@pytest.mark.django_db
def test_notifications_list_is_scoped_to_current_user(authenticated_client, notification_owner, other_user):
    own_notification = Notification.objects.create(
        recipient=notification_owner, kind="request_updated", title="Own notification"
    )
    Notification.objects.create(recipient=other_user, kind="request_updated", title="Other notification")

    response = authenticated_client.get("/api/v1/notifications")

    assert response.status_code == 200
    assert [notification["id"] for notification in response.data["data"]] == [own_notification.pk]
    assert response.data["meta"] == {"page": 1, "page_size": 20, "count": 1, "total_pages": 1}


@pytest.mark.django_db
def test_notifications_list_enforces_page_size_bound(authenticated_client, notification_owner):
    notifications = [
        Notification.objects.create(recipient=notification_owner, kind="request_updated", title=f"Notification {number}")
        for number in range(25)
    ]

    response = authenticated_client.get("/api/v1/notifications?page=2&page_size=999")

    assert response.status_code == 200
    assert len(response.data["data"]) == 5
    assert response.data["meta"] == {"page": 2, "page_size": 20, "count": 25, "total_pages": 2}
    assert {notification["id"] for notification in response.data["data"]} == {notification.pk for notification in notifications[:5]}


@pytest.mark.django_db
def test_notification_read_state_can_be_marked_and_unmarked(authenticated_client, notification_owner):
    notification = Notification.objects.create(
        recipient=notification_owner, kind="request_updated", title="Needs attention"
    )

    marked_read = authenticated_client.patch(
        f"/api/v1/notifications/{notification.pk}/read-state",
        {"is_read": True},
        format="json",
        HTTP_X_CSRFTOKEN=csrf_token(authenticated_client),
    )

    assert marked_read.status_code == 200
    assert marked_read.data["data"]["is_read"] is True
    notification.refresh_from_db()
    assert notification.read_at is not None

    marked_unread = authenticated_client.patch(
        f"/api/v1/notifications/{notification.pk}/read-state",
        {"is_read": False},
        format="json",
        HTTP_X_CSRFTOKEN=csrf_token(authenticated_client),
    )

    assert marked_unread.status_code == 200
    notification.refresh_from_db()
    assert notification.read_at is None


@pytest.mark.django_db
def test_repeated_mark_read_preserves_original_read_at(authenticated_client, notification_owner):
    original_read_at = timezone.now()
    notification = Notification.objects.create(
        recipient=notification_owner,
        kind="request_updated",
        title="Already read",
        read_at=original_read_at,
    )

    response = authenticated_client.patch(
        f"/api/v1/notifications/{notification.pk}/read-state",
        {"is_read": True},
        format="json",
        HTTP_X_CSRFTOKEN=csrf_token(authenticated_client),
    )

    assert response.status_code == 200
    notification.refresh_from_db()
    assert notification.read_at == original_read_at
    assert response.data["data"]["read_at"] == original_read_at.isoformat().replace("+00:00", "Z")


@pytest.mark.django_db
def test_notification_read_state_is_throttled_after_sixty_mutations(authenticated_client, notification_owner):
    cache.clear()
    notification = Notification.objects.create(
        recipient=notification_owner, kind="request_updated", title="Needs attention"
    )
    token = csrf_token(authenticated_client)

    responses = [
        authenticated_client.patch(
            f"/api/v1/notifications/{notification.pk}/read-state",
            {"is_read": True},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        for _ in range(61)
    ]

    assert [response.status_code for response in responses[:60]] == [200] * 60
    assert responses[60].status_code == 429
    cache.clear()


@pytest.mark.django_db
def test_other_users_notification_cannot_be_updated(authenticated_client, other_user):
    notification = Notification.objects.create(
        recipient=other_user, kind="request_updated", title="Private notification"
    )

    response = authenticated_client.patch(
        f"/api/v1/notifications/{notification.pk}/read-state",
        {"is_read": True},
        format="json",
        HTTP_X_CSRFTOKEN=csrf_token(authenticated_client),
    )

    assert response.status_code == 404
    notification.refresh_from_db()
    assert notification.read_at is None


@pytest.mark.django_db
def test_notification_endpoints_require_authentication():
    client = APIClient(enforce_csrf_checks=True)

    assert client.get("/api/v1/notifications").status_code == 401
    assert client.patch("/api/v1/notifications/1", {"is_read": True}, format="json").status_code == 403


@pytest.mark.django_db
def test_notification_read_state_rejects_other_fields(authenticated_client, notification_owner):
    notification = Notification.objects.create(
        recipient=notification_owner, kind="request_updated", title="Original title"
    )

    response = authenticated_client.patch(
        f"/api/v1/notifications/{notification.pk}/read-state",
        {"is_read": True, "title": "Tampered title"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf_token(authenticated_client),
    )

    assert response.status_code == 422
    assert response.data["error"] == {
        "code": "validation_error",
        "message": "Validation failed.",
        "fields": {"title": ["This field cannot be updated."]},
        "request_id": response["X-Request-ID"],
    }
    notification.refresh_from_db()
    assert notification.title == "Original title"
    assert notification.read_at is None
