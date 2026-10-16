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

        Accepts a company instance, or an authenticated user (whose
        ``company`` is the anchor). Anonymous, ``None``, or otherwise
        company-less callers resolve to an EMPTY set — fail-closed, matching
        the middleware's deny-before-view contract.

        The company instance is branched on by TYPE, not by duck-typing a
        ``.company`` attribute: a ``Company`` has no ``.company`` of its own,
        so the attribute probe used to fall through to
        ``current_company(company)``, find no ``is_authenticated``, and
        silently answer an empty queryset for the caller's OWN company.
        """
        from accounts.models import Company

        if isinstance(user_or_company, Company):
            return self.company_all(user_or_company)
        company = getattr(user_or_company, "company", None)
        if company is None:
            return self.get_queryset().none()
        return self.get_queryset().filter(company=company)

    def company_all(self, company):
        """Scope by an explicit company object (no user context available)."""
        if company is None:
            return self.get_queryset().none()
        return self.get_queryset().filter(company=company)
