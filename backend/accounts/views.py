"""Auth endpoints: login, logout, me — same-origin session flow.

Contract endpoints (architecture-security.md §6):
  POST /api/v1/auth/login
  POST /api/v1/auth/logout
  GET/PATCH /api/v1/auth/me

CSRF stays enforced on unsafe methods (no csrf_exempt anywhere).
"""
from django.middleware.csrf import get_token
from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from accounts.authentication import CsrfEnforcedSessionAuthentication
from accounts.throttles import MutationRateThrottle
from config.api import error_payload


class LoginRateThrottle(AnonRateThrottle):
    """Limit unauthenticated login attempts to 10 per minute per IP."""

    scope = "login"


class SignupRateThrottle(AnonRateThrottle):
    """Limit unauthenticated signup attempts to 10 per minute per IP (H14)."""

    scope = "signup"


from accounts.serializers import CurrentUserSerializer, CurrentUserUpdateSerializer, LoginSerializer, SignupSerializer
from accounts.services import sign_in, sign_out, sign_up


class CsrfBootstrapView(APIView):
    """GET /api/v1/auth/csrf — issues the CSRF cookie for the SPA bootstrap.

    The SPA fetches this before its first unsafe request and echoes the
    token via X-CSRFToken. Django's CsrfViewMiddleware remains the only
    enforcement point.
    """

    permission_classes = []
    authentication_classes = []

    def get(self, request):
        return Response({"data": {"csrftoken": get_token(request)}})


class LoginView(APIView):
    """Establish a session. Auth failures are generic and non-enumerating."""

    permission_classes = []  # anonymous callers must reach this endpoint
    authentication_classes = []  # anonymous callers; CSRF enforced in post()
    throttle_classes = [LoginRateThrottle]

    def post(self, request):
        # CSRF is enforced here explicitly because this view opts out of the
        # global authenticator to allow anonymous callers. The same
        # CSRFCheck/PermissionDenied path used by SessionAuthentication runs.
        CsrfEnforcedSessionAuthentication().enforce_csrf(request)
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, error = sign_in(
            request=request,
            email=serializer.validated_data["email"],
            password=serializer.validated_data["password"],
        )
        if error is not None:
            return Response(
                error_payload(
                    code="invalid_credentials",
                    message="Unable to sign in with the provided credentials.",
                    fields={},
                    request=request,
                ),
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {
                "data": CurrentUserSerializer(user).data,
                "meta": {"csrftoken": get_token(request)},
            }
        )


class SignupView(APIView):
    """POST /api/v1/auth/signup — self-service HR signup (Story H14).

    Anonymous callers reach this view exactly like LoginView: no
    authentication classes, CSRF enforced explicitly via
    CsrfEnforcedSessionAuthentication.enforce_csrf, throttled by its own
    10/min-anonymous scope.

    success         -> 200 {"data": CurrentUserSerializer, "meta": csrftoken},
                       caller is signed in (sign_in service contract).
    wrong/inactive
    code            -> 400 invalid_code (generic; «الكود غير صحيح»).
    existing email
    +valid code     -> 200 with data {"outcome": "email_in_use"} — account
                       untouched (role preserved), no user data, no
                       enumeration; mirrors login's generic posture.
    weak password   -> 422 validation_error with the app's validator msgs.

    Audit: no AuditEvent is written for self-signup. AuditEvent.actor is a
    required PROTECT FK implying an authenticated responsible actor, and a
    self-service caller IS the resulting user rather than an actor acting
    on someone else; fabricating an actor would be a lie in the audit
    trail. The code's use counter (accounts.SubscriptionCode.use_count /
    last_used_at) is the durable record of this flow.
    """

    permission_classes = []  # anonymous callers must reach this endpoint
    authentication_classes = []  # anonymous callers; CSRF enforced in post()
    throttle_classes = [SignupRateThrottle]

    def post(self, request):
        # CSRF enforced explicitly, same as LoginView (no csrf_exempt).
        CsrfEnforcedSessionAuthentication().enforce_csrf(request)
        serializer = SignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, error = sign_up(
            request=request,
            email=serializer.validated_data["email"],
            code=serializer.validated_data["code"],
            password=serializer.validated_data["password"],
        )
        if error == "invalid_code":
            return Response(
                error_payload(
                    code="invalid_code",
                    message="الكود غير صحيح.",
                    fields={"code": ["الكود غير صحيح."]},
                    request=request,
                ),
                status=status.HTTP_400_BAD_REQUEST,
            )
        if error == "invalid_password":
            return Response(
                error_payload(
                    code="validation_error",
                    message="Validation failed.",
                    fields={"password": ["This password is too weak."]},
                    request=request,
                ),
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        if error == "active_account":
            # Non-enumerating: an existing email is confirmed usable but no
            # account data or role change is offered; the caller signs in
            # through /auth/login with their own credentials.
            return Response(
                {"data": {"outcome": "email_in_use"}, "meta": {"csrftoken": get_token(request)}}
            )
        return Response(
            {
                "data": CurrentUserSerializer(user).data,
                "meta": {"csrftoken": get_token(request)},
            }
        )


class LogoutView(APIView):
    def post(self, request):
        sign_out(request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request):
        return Response({"data": CurrentUserSerializer(request.user).data})

    def patch(self, request):
        serializer = CurrentUserUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = serializer.update(request.user, serializer.validated_data)
        except CurrentUserUpdateSerializer.AppearanceStaleWrite:
            # Story 5.3: a stale selection must not overwrite a newer saved
            # value; the client keeps its retryable preview and re-fetches.
            return Response(
                error_payload(
                    code="version_conflict",
                    message="The saved appearance changed. Reload and try again.",
                    fields={"appearance": ["The saved appearance changed. Reload and retry."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        return Response({"data": CurrentUserSerializer(user).data})
