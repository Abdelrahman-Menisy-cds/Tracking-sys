from django.urls import path

from review import report_views
from review import views

app_name = "review"

urlpatterns = [
    path("review/requests/queue", views.RequestQueueView.as_view(), name="request-queue"),
    path("review/requests/<uuid:pk>", views.RequestReviewDetailView.as_view(), name="request-detail"),
    path("review/timesheets/queue", views.TimesheetQueueView.as_view(), name="timesheet-queue"),
    path("review/timesheets/<uuid:pk>", views.TimesheetReviewDetailView.as_view(), name="timesheet-detail"),
    # Story 4.3: bounded scoped CSV reports (manager/HR).
    path("reports/<str:category>/rows", report_views.ReportRowsView.as_view(), name="report-rows"),
    path("reports/<str:category>/totals", report_views.ReportTotalsView.as_view(), name="report-totals"),
    path("reports/<str:category>/dashboard", report_views.ReportDashboardView.as_view(), name="report-dashboard"),
    path("reports/<str:category>/csv", report_views.ReportCsvView.as_view(), name="report-csv"),
]
