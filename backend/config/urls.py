"""config URL configuration. API base is /api/v1/ per contract.

The Django admin is intentionally not wired yet; HR is an application role,
not the Django admin (constitution §3). Break-glass admin can be added later
with explicit approval.
"""
from django.urls import include, path, re_path

from config import spa
from config.api import api_not_found
from config.health import health_live, health_ready
from config.schema import schema_endpoint

urlpatterns = [
    path("health/live", health_live),
    path("health/ready", health_ready),
    path("api/v1/schema", schema_endpoint),
    path("api/v1/", include("accounts.urls")),
    path("api/v1/", include("notifications.urls")),
    path("api/v1/", include("reqs.urls")),
    path("api/v1/", include("timesheets.urls")),
    path("api/v1/", include("review.urls")),
    path("api/v1/", include("holidays.urls")),
    re_path(r"^api/v1(?:/.*)?$", api_not_found),
    # --- the built SPA, declared LAST so it cannot shadow the API above ---
    # Served from this same origin on purpose: the session cookie and the CSRF
    # token stay first-party, so there is no CORS and no cross-site cookie
    # decision to get wrong. See config/spa.py.
    # Keep the `assets/` prefix: spa_file resolves the path against dist/ itself.
    re_path(r"^(?P<path>assets/.*)$", spa.spa_file),
    re_path(r"^(?P<path>[^/]+\.(?:ico|svg|txt|webmanifest|png|jpg|webp))$", spa.spa_file),
    # No named group on purpose: the shell takes no URL kwargs.
    re_path(r"^(?:.*)$", spa.spa_index),
]
