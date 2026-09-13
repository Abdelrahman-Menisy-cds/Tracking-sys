"""Export throttle: 5/hour/user (policy item 8) for report CSV exports."""
from rest_framework.throttling import SimpleRateThrottle


class ExportRateThrottle(SimpleRateThrottle):
    """CSV export budget separate from mutations: 5 exports/hour/user."""

    scope = "report_export"

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return self.cache_format % {"scope": self.scope, "ident": request.user.pk}
        return None
