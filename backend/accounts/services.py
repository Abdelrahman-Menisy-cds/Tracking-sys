"""Auth command services (thin, transactional, named per contract).

Story 1.1 implements sign in, sign out, and inactive-account handling on top
of Django's session backend. Login uses Django's authenticate() so inactive
accounts are rejected uniformly by ModelBackend.
"""
from django.contrib.auth import authenticate, login, logout
from django.contrib.sessions.models import Session
from django.db import transaction
from django.utils import timezone

from accounts.models import SubscriptionCode
from django.core.exceptions import ValidationError as _django_validation_error
from tenants.context import default_company


def sign_up(*, request, email: str, code: str, password: str):
    """Create an HR account from a valid subscription code, then sign in.

    Story H14 self-service signup. Outcomes:
      ("active_account", None)  the email already exists — leave it alone
                                (never re-role, never reveal that it does).
      (None, "invalid_code")    wrong or inactive code — generic, the UI
                                renders «الكود غير صحيح».
      (None, "invalid_password") password rejected by the app's validators.
      (user, None)              success: role=HR HR account created and the
                                caller is signed in on the same request.

    The lookup order is fixed: code first, then the account lookup, so any
    failure that might leak account existence only happens AFTER the code
    is proven valid — membership knowledge is what buys you any response
    difference at all, and an existing email is answered exactly like a
    fresh one ("signup_ok" + the wording below) because password input is
    never trusted for that path and no account is modified.
    """
    from django.contrib.auth import get_user_model
    from accounts.models import User

    subscription = SubscriptionCode.check_code(code.strip())
    if subscription is None:
        return None, "invalid_code"

    # Password validators run before the account check; failure shapes are
    # per-field so the UI can render them without help.
    from django.contrib.auth.password_validation import validate_password

    try:
        validate_password(password)
    except _django_validation_error:
        return None, "invalid_password"

    user_model = get_user_model()
    email = email.strip().lower()
    # Row lock so two concurrent signups with the same email serialize and
    # the loser falls into the existing-account branch instead of an
    # IntegrityError.
    with transaction.atomic():
        existing = user_model.objects.select_for_update().filter(email=email).first()
        if existing is not None:
            # Non-enumerating: identical outcome to a fresh signup; role and
            # account are untouched.
            return existing, "active_account"
        user = user_model.objects.create_user(
            email=email,
            password=password,
            role=User.Role.HR,
            is_active=True,
            # H30 plan §2.2 (R1 interim): the operator-code flow admits HR into
            # the one default company; R3's two-branch signup replaces this.
            company=default_company(),
        )
        subscription.record_use()
    # Same session/CSRF rotation path as login (services.sign_in).
    request.session.cycle_key()
    login(request, user)
    return user, None


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
    """Deactivate an account and revoke its active server-side sessions."""
    user.is_active = False
    user.save(update_fields=["is_active"])
    active_sessions = Session.objects.filter(expire_date__gt=timezone.now())
    for session in active_sessions.iterator():
        if session.get_decoded().get("_auth_user_id") == str(user.pk):
            session.delete()
