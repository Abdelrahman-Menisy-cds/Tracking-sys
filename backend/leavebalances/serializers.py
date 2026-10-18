"""Leave-balance serializers: the adjust payload (server-authoritative allowlist).

Read rows are built in services.build_balance_payload as plain dicts (the shape
mixes two models and a derived count), so only the WRITE contract needs a
serializer here. Like every mutating endpoint in this API, unknown fields are
rejected as protected and the reason is mandatory.
"""
from rest_framework import serializers

#: The one vocabulary of leave types in the app (mirrors the assistant's rule):
#: a RequestType whose name carries «إجازة». services.leave_types uses the same
#: predicate, so read and adjust can never disagree about what a leave type is.
LEAVE_TYPE_NAME_MARKER = "إجازة"

ADJUST_FIELDS = frozenset(
    {"employee_id", "request_type_id", "year", "entitled_days", "carried_over_days", "version", "reason"}
)
REASON_MAX_LENGTH = 500
DAYS_MAX_DIGITS = 6
DAYS_DECIMAL_PLACES = 2


class LeaveBalanceAdjustSerializer(serializers.Serializer):
    """POST /leave-balances/adjust payload (HR only).

    HR sends the new ABSOLUTE entitlement for one (employee, leave type, year)
    — ``entitled_days`` and ``carried_over_days`` — plus the version it last
    saw and a mandatory reason. ``used_days`` is deliberately NOT accepted: it
    is derived from approved requests and can never be set by hand.
    """

    employee_id = serializers.IntegerField()
    request_type_id = serializers.IntegerField()
    year = serializers.IntegerField(min_value=1974, max_value=2100)
    entitled_days = serializers.DecimalField(
        max_digits=DAYS_MAX_DIGITS, decimal_places=DAYS_DECIMAL_PLACES, min_value=0
    )
    carried_over_days = serializers.DecimalField(
        max_digits=DAYS_MAX_DIGITS, decimal_places=DAYS_DECIMAL_PLACES, min_value=0
    )
    # 0 = "no balance row exists yet" (the client mirrors the read row's version).
    version = serializers.IntegerField(min_value=0)
    reason = serializers.CharField(max_length=REASON_MAX_LENGTH, trim_whitespace=True)

    def validate(self, attrs):
        protected = set(self.initial_data) - ADJUST_FIELDS
        if protected:
            raise serializers.ValidationError(
                {field: ["This field is managed by the server."] for field in sorted(protected)}
            )
        if not attrs["reason"].strip():
            raise serializers.ValidationError(
                {"reason": ["An adjustment reason is required."]}
            )
        return attrs
