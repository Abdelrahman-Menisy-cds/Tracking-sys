"""H30 R0 — tenants: the isolation foundation (no behavior change).

The app owns the tenant anchor, the TenantManager, and the TenantMiddleware.
It has NO models by design: the tenancy data lives on each tenant table
(`company` FK); this app is the ONE place whose job is describing how a
request binds to a company and how queries must be scoped to it.
"""
from django.apps import AppConfig


class TenantsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "tenants"
    verbose_name = "tenants"
