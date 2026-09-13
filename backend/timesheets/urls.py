from django.urls import path

from timesheets import views

app_name = "timesheets"

urlpatterns = [
    path("timesheets", views.TimesheetListCreateView.as_view(), name="timesheet-list"),
    path("timesheets/<uuid:pk>", views.TimesheetDetailView.as_view(), name="timesheet-detail"),
    path("timesheets/<uuid:pk>/submit", views.TimesheetSubmitView.as_view(), name="timesheet-submit"),
    path(
        "timesheets/<uuid:pk>/entries/<str:entry_id>",
        views.TimesheetEntryDetailView.as_view(),
        name="timesheet-entry-detail",
    ),
]
