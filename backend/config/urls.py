"""config URL configuration. API base is /api/v1/ per contract.

The Django admin is intentionally not wired yet; HR is an application role,
not the Django admin (constitution §3). Break-glass admin can be added later
with explicit approval.
"""
from django.urls import include, path, re_path

from config.api import api_not_found
from config.health import health_live, health_ready

urlpatterns = [
    path("health/live", health_live),
    path("health/ready", health_ready),
    path("api/v1/", include("accounts.urls")),
    path("api/v1/", include("notifications.urls")),
    path("api/v1/", include("reqs.urls")),
    path("api/v1/", include("timesheets.urls")),
    path("api/v1/", include("review.urls")),
    re_path(r"^api/v1(?:/.*)?$", api_not_found),
]
