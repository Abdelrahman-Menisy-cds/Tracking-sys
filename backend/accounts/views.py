"""Auth endpoints: login, logout, me — same-origin session flow.

Contract endpoints (architecture-security.md §6):
  POST /api/v1/auth/login
  POST /api/v1/auth/logout
  GET  /api/v1/auth/me

CSRF stays enforced on unsafe methods (no csrf_exempt anywhere).
"""
from django.middleware.csrf import get_token
from rest_framework import status
from rest_framework.throttling import AnonRateThrottle
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.authentication import CsrfEnforcedSessionAuthentication


class LoginRateThrottle(AnonRateThrottle):
    """Limit unauthenticated login attempts to 10 per minute per IP."""

    scope = "login"


from accounts.serializers import CurrentUserSerializer, LoginSerializer
from accounts.services import sign_in, sign_out


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
            # Generic safe response regardless of cause (invalid password,
            # unknown email, or inactive account): no account enumeration.
            return Response(
                {"error": {"code": "invalid_credentials", "message": "Unable to sign in with the provided credentials.", "fields": {}}},
                status=status.HTTP_400_BAD_REQUEST,
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
    def get(self, request):
        return Response({"data": CurrentUserSerializer(request.user).data})
