from django.urls import path

from holidays import views

app_name = "holidays"

urlpatterns = [
    path("holidays", views.HolidayListView.as_view(), name="holiday-list"),
    path("holidays/refresh", views.HolidayRefreshView.as_view(), name="holiday-refresh"),
]
