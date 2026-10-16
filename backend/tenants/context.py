"""The single tenant anchor (H30 plan §3.2).

``current_company(user)`` is the ONLY sanctioned way to derive "which company
does this query belong to" from a caller. Every scoped read goes through it
(directly or via ``TenantManager.of``); nothing may take a company from
user input, a URL parameter, or a model payload.
"""

DEFAULT_COMPANY_SLUG = "__default__"


def current_company(user):
    """The caller's company, or None for anonymous — never a guess."""
    if user is None or not getattr(user, "is_authenticated", False):
        return None
    return getattr(user, "company", None)


def default_company():
    """The ``__default__`` company (H30 plan §2.6) — get_or_create.

    The data migration (accounts/migrations/0012) owns the first creation and
    the backfill; this lazy path lets R1-era creation code (sign_up,
    create_superuser) bind the operator/bootstrap flows to the default
    company until R3's two-branch signup replaces them. Idempotent by
    construction, so a missing row heals instead of raising.
    """
    from accounts.models import Company

    company, _created = Company.objects.get_or_create(
        slug=DEFAULT_COMPANY_SLUG,
        defaults={"name": DEFAULT_COMPANY_SLUG},
    )
    return company
