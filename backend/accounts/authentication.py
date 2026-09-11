"""Authentication classes for the accounts API.

DRF marks APIViews csrf-exempt and leaves CSRF enforcement to
SessionAuthentication — which only enforces it for session-authenticated
requests. The approved contract forbids exempting mutation endpoints, so
this class enforces Django's CSRF check on every unsafe method even when
the caller is anonymous (login POST included).
"""
from rest_framework.authentication import SessionAuthentication


_SAFE_METHODS = frozenset(("GET", "HEAD", "OPTIONS", "TRACE"))


class CsrfEnforcedSessionAuthentication(SessionAuthentication):
    def authenticate(self, request):
        if request.method not in _SAFE_METHODS:
            # Same rejection path SessionAuthentication uses for
            # authenticated requests; raises PermissionDenied (403).
            self.enforce_csrf(request)
        return super().authenticate(request)

    def authenticate_header(self, request):
        # Supplying a WWW-Authenticate scheme prevents DRF from coercing
        # NotAuthenticated (401) responses down to 403 — see DRF
        # APIView.handle_exception. Auth failures must stay 401 per contract;
        # session flows don't require a real challenge header.
        return 'Session realm="heya-fawda"'
