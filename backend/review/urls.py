from django.urls import path

from review import views

app_name = "review"

urlpatterns = [
    path("review/requests/queue", views.RequestQueueView.as_view(), name="request-queue"),
    path("review/requests/<uuid:pk>", views.RequestReviewDetailView.as_view(), name="request-detail"),
    path("review/timesheets/queue", views.TimesheetQueueView.as_view(), name="timesheet-queue"),
    path("review/timesheets/<uuid:pk>", views.TimesheetReviewDetailView.as_view(), name="timesheet-detail"),
]
