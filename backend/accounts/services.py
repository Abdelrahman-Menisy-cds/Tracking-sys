"""Auth command services (thin, transactional, named per contract).

Story 1.1 implements sign in, sign out, and inactive-account handling on top
of Django's session backend. Login uses Django's authenticate() so inactive
accounts are rejected uniformly by ModelBackend.
"""
from django.contrib.auth import authenticate, login, logout
from django.db import transaction


def sign_in(*, request, email: str, password: str):
    """Authenticate and rotate the session on success.

    Returns (user, None) on success or (None, error_kind) where error_kind
    is the generic 'invalid_credentials' bucket — never a disclosure of
    whether the email exists (AC-01).
    """
    user = authenticate(request=request, email=email.strip().lower(), password=password)
    if user is None:
        return None, "invalid_credentials"
    # Rotate the session key to defeat fixation on login.
    request.session.cycle_key()
    login(request, user)
    return user, None


def sign_out(*, request) -> None:
    """Invalidate the session server-side."""
    logout(request)


@transaction.atomic
def deactivate_user(*, user) -> None:
    """Deactivate an account: no new authentication is possible and a live
    session loses permission to mutate (DRF SessionAuthentication enforces
    user.is_active per request on every authenticated call)."""
    user.is_active = False
    user.save(update_fields=["is_active"])
