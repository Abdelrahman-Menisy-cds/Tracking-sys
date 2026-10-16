"""Auth command services (thin, transactional, named per contract).

Story 1.1 implements sign in, sign out, and inactive-account handling on top
of Django's session backend. Login uses Django's authenticate() so inactive
accounts are rejected uniformly by ModelBackend.
"""
from django.contrib.auth import authenticate, login, logout
from django.contrib.sessions.models import Session
from django.db import transaction
from django.utils import timezone

from accounts.company_serializers import create_founding_profile, merged_missing_required
from accounts.models import Company, SubscriptionCode
from django.core.exceptions import ValidationError as _django_validation_error


class CompanyDataIncomplete(Exception):
    """Signup's nested company data is missing required profile fields (H34).

    Raised BEFORE any write. ``missing`` lists the CompanyProfile required
    field names so the view can answer the same per-field shape and wording
    the /company PATCH view answers.
    """

    def __init__(self, missing):
        super().__init__(missing)
        self.missing = list(missing)


def _company_name(email: str, company_name: str | None, company_data: dict | None = None) -> str:
    """The new company's display name: the caller's, else the email's domain.

    A tenantless operator code founds a company for whoever redeems it (H30
    §2.5), and the caller may not have named it yet — the domain is the honest
    default, and HR renames it through the company profile afterwards.
    H34: company-screen data outranks the legacy ``company_name`` field —
    the nested profile's name is required (completeness gate) and is what
    the owner typed on the company screen.
    """
    if company_data and (company_data.get("name") or "").strip():
        return company_data["name"].strip()[:200]
    if company_name and company_name.strip():
        return company_name.strip()[:200]
    return (email.split("@")[-1].strip() or email)[:200]


def _company_slug(name: str, email: str) -> str:
    """A unique slug for a new company (H30 §2.1: the stable identifier).

    Built from the email's domain first: a non-latin name (Arabic, say)
    slugifies to nothing, while the domain is what actually identifies the
    organisation signing up. Falls back to the name, then to "company".
    """
    import re

    def slugify(value: str) -> str:
        return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:40]

    base = slugify(email.split("@")[-1]) or slugify(name) or "company"
    slug = base
    suffix = 2
    while Company.objects.filter(slug=slug).exists():
        slug = f"{base}-{suffix}"[:64]
        suffix += 1
    return slug


def sign_up(
    *,
    request,
    email: str,
    code: str,
    password: str,
    company_name: str | None = None,
    company_data: dict | None = None,
):
    """Create an HR account from a valid subscription code, then sign in.

    Story H14 self-service signup; H34 extends it with one-shot company
    registration. Outcomes:
      ("active_account", None)  the email already exists — leave it alone
                                (never re-role, never reveal that it does).
      (None, "invalid_code")    wrong or inactive code — generic, the UI
                                renders «الكود غير صحيح».
      (None, "invalid_password") password rejected by the app's validators.
      (None, "company_not_expected")  the code is bound to a company (join)
                                but company data was supplied (found) — the
                                view answers a clear 400; nothing is written.
      CompanyDataIncomplete     the nested company data is missing required
                                profile fields — raised BEFORE any write.
      (user, None)              success: role=HR HR account created and the
                                caller is signed in on the same request. The
                                account lands in the company the code binds to,
                                or in a NEW company founded for the caller when
                                the code is tenantless (H30 §2.5) — so two
                                self-serve signups never share a tenant.

    With ``company_data`` (the H34 company screen), the founding is one
    transaction: Company + a COMPLETE CompanyProfile (via
    create_founding_profile — the same serializer rules the /company PATCH
    view enforces) + the founding User, so ANY failure rolls all three back
    and an abandoned signup leaves zero rows. The profile arriving complete
    is what makes ``needs_company_profile`` False on the response, so the
    SPA enters the app without the onboarding step.

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

    # H34: a code bound to a company admits the caller into THAT company;
    # founding a new one through it is a contradiction — refused before any
    # write (the view answers the clear 400).
    if company_data is not None and subscription.company is not None:
        return None, "company_not_expected"
    if company_data is not None:
        # Same completeness computation the /company PATCH view gates with;
        # the founding profile must arrive complete or nothing is written.
        missing = merged_missing_required(None, company_data)
        if missing:
            raise CompanyDataIncomplete(missing)

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
        # H30 §2.5: the subscription code IS the company door. A code bound to
        # a company admits the caller into THAT company; a tenantless operator
        # code founds a NEW one, so two signups never share a tenant.
        company = subscription.company
        if company is None:
            name = _company_name(email, company_name, company_data)
            company = Company.objects.create(
                slug=_company_slug(name, email), name=name
            )
        user = user_model.objects.create_user(
            email=email,
            password=password,
            role=User.Role.HR,
            is_active=True,
            company=company,
        )
        if company_data is not None:
            # H34: the founding profile row — complete by the gate above —
            # inside the SAME transaction, so a failure here rolls the
            # company and the account back too.
            create_founding_profile(
                company=company, validated_data=company_data, founder=user
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
