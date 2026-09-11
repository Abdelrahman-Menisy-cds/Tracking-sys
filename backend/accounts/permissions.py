"""Permission classes for the accounts API.

Maps DRF's default "credentials absent" denial to 401 so unauthenticated
access matches the contract (401 unauthenticated, 403 authenticated but
forbidden).
"""
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
