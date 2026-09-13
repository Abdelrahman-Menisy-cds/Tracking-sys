from django.urls import path

from notifications import views

app_name = "notifications"

urlpatterns = [
    path("notifications", views.NotificationListView.as_view(), name="notification-list"),
    path(
        "notifications/<int:notification_id>",
        views.NotificationDetailView.as_view(),
        name="notification-detail",
    ),
    path(
        "notifications/<int:notification_id>/read-state",
        views.NotificationReadStateView.as_view(),
        name="notification-read-state",
    ),
]
