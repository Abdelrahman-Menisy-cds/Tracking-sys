"""Permission classes for the accounts API.

Maps DRF's default "credentials absent" denial to 401 so unauthenticated
access matches the contract (401 unauthenticated, 403 authenticated but
forbidden).
"""
from django.http import Http404
from rest_framework.exceptions import NotAuthenticated
from rest_framework.permissions import IsAuthenticated


class IsAuthenticated401(IsAuthenticated):
    """IsAuthenticated, but missing credentials raise 401, not 403."""

    def has_permission(self, request, view) -> bool:
        if bool(request.user and request.user.is_authenticated):
            return True
        # NotAuthenticated renders as 401 with an empty WWW-Authenticate
        # recommended for session flows (DRF does not add one).
        raise NotAuthenticated()


class IsHR(IsAuthenticated401):
    """Explicit employee-management capability: the HR application role.

    Not superuser status (constitution §3 / policy item 6). Access is
    capability-gated per endpoint; existence is never disclosed to other
    roles, so an authenticated non-HR caller gets the same 404 envelope
    as a nonexistent resource (permission-matrix.md 404 policy).
    """

    def has_permission(self, request, view) -> bool:
        if not super().has_permission(request, view):
            return False
        if request.user.role != "HR":
            # Same envelope as an unknown employee: no existence disclosure.
            raise Http404("Not found.")
        return True
