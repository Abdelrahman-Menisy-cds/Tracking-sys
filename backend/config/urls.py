"""config URL configuration. API base is /api/v1/ per contract.

The Django admin is intentionally not wired yet; HR is an application role,
not the Django admin (constitution §3). Break-glass admin can be added later
with explicit approval.
"""
from django.urls import include, path

urlpatterns = [
    path("api/v1/", include("accounts.urls")),
    path("api/v1/", include("notifications.urls")),
]
