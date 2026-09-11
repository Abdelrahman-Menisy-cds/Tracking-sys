from django.urls import path

from reqs import views

app_name = "reqs"

urlpatterns = [
    path("requests", views.RequestListView.as_view(), name="request-list"),
    path("requests/<uuid:pk>", views.RequestDetailView.as_view(), name="request-detail"),
]
