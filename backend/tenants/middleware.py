"""The single tenant anchor + the TenantMiddleware (H30 plan §3.2).

``current_company(user)`` is the ONLY sanctioned way to derive "which
company does this caller belong to"; every scoped read resolves through it
(directly or via tenants.managers.TenantManager.of).

``TenantMiddleware`` is the request-layer safety net: it stamps
``request.company`` and — ONLY for the API surface, and ONLY once the
User.company FK is hard (plan: "the NULL-company denial arms when the FK is
hard", introspected from the live model state so R0 is a pure pass-through
and R1 arms it with no further wiring change) — answers with the standard
404 envelope any API request from an authenticated user with no company.
A row that predates a failed backfill must never browse globally (§3.2).
"""
from django.http import JsonResponse

from config.api import error_payload
from tenants.context import current_company

#: The denial only guards the JSON API; the SPA routes and health probes
#: never carry a tenant notion (there is no user to deny anywhere else).
_API_PREFIX = "/api/"


def company_fk_is_hard():
    """True once accounts.User.company exists with null=False (post-0013)."""
    from django.core.exceptions import FieldDoesNotExist

    from accounts.models import User

    try:
        field = User._meta.get_field("company")
    except FieldDoesNotExist:
        return False  # R0 state: the FK is not in the model yet.
    return not field.null


class TenantMiddleware:
    """Resolve request.company; deny the API on an unanchored request.

    Order in MIDDLEWARE: after AuthenticationMiddleware (so request.user
    exists) and before the DRF view stack runs (so the denial reaches the
    caller instead of a view leaking globally). Registered per §3.2.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)
        request.company = current_company(user)
        if (
            request.company is None
            and company_fk_is_hard()
            and user is not None
            and getattr(user, "is_authenticated", False)
            and request.path_info.startswith(_API_PREFIX)
        ):
            return JsonResponse(
                error_payload(
                    code="not_found",
                    message="Not found.",
                    fields={},
                    request=request,
                ),
                status=404,
            )
        return self.get_response(request)
