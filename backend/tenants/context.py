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
