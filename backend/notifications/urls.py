from django.urls import path

from notifications import views

app_name = "notifications"

urlpatterns = [
    path("notifications", views.NotificationListView.as_view(), name="notification-list"),
    path("notifications/<int:notification_id>", views.NotificationReadStateView.as_view(), name="notification-read-state"),
]
