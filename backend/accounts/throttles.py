from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle


class MutationRateThrottle(UserRateThrottle):
    scope = "mutation"


class AttachmentUploadRateThrottle(SimpleRateThrottle):
    """Upload scope: 20/hour/user, separate from the 60/min mutation budget.

    A SimpleRateThrottle keyed by user because UserRateThrottle caches the
    rate at import time and cannot support the '20/hour' scope cleanly.
    """

    scope = "attachment_upload"

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return self.cache_format % {"scope": self.scope, "ident": request.user.pk}
        return None
