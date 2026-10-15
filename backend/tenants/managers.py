"""Company-scoped default manager (H30 plan §3.2.2).

``TenantManager.of(user_or_company)`` is the ONLY authorized entry point for
reading or mutating a tenant model once enforcement lands; a bare
``Model.objects.filter(...)`` is the mark of a tenant leak and is caught by
tenants/test_scoping_static.py (the allow-list ratchets down to zero as each
R-phase converts its surfaces).
"""
from django.db import models

from tenants.context import current_company


class CompanyMissing(PermissionError):
    """A scoped query needs a company and the caller has none."""


class TenantManager(models.Manager):
    """"Every query through this manager is company-scoped by construction."""

    use_in_migrations = False

    def of(self, user_or_company):
        """Scope to a company.

        Accepts either a company instance (User.gif.company) or an
        authenticated user (anonymous resolves to no company — an empty set,
        matching the middleware's deny-before-view contract).
        """
        from tenants.context import current_company

        user = user_or_company
        try:
            company = user.company
        except AttributeError:
            company = current_company(user)
        if company is None:
            return self.get_queryset().none()
        return self.get_queryset().filter(company=company)

    def company_all(self, company):
        """Scope by an explicit company object (no user context available)."""
        if company is None:
            return self.get_queryset().none()
        return self.get_queryset().filter(company=company)
