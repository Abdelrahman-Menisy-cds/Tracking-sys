from rest_framework.throttling import UserRateThrottle


class MutationRateThrottle(UserRateThrottle):
    scope = "mutation"
