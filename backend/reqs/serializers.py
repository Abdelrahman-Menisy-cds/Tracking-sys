"""Request draft serializers (Story 2.1): server-authoritative field allowlist.

Client-set status / manager / assignee fields are rejected as protected
(422 field errors) without mutation, matching the approved contract.
"""
from rest_framework import serializers

from .models import EmployeeRequest, RequestType


class RequestTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = RequestType
        fields = ["id", "name", "requires_hr_approval"]


class EmployeeRequestSerializer(serializers.ModelSerializer):
    request_type = RequestTypeSerializer(read_only=True)
    status = serializers.CharField(read_only=True)
    version = serializers.IntegerField(read_only=True)

    class Meta:
        model = EmployeeRequest
        fields = [
            "id",
            "request_type",
            "title",
            "details",
            "status",
            "version",
            "created_at",
            "updated_at",
        ]


class DraftCreateSerializer(serializers.Serializer):
    request_type_id = serializers.IntegerField()
    title = serializers.CharField(max_length=255, trim_whitespace=True)
    details = serializers.CharField(required=False, allow_blank=True, max_length=10_000, trim_whitespace=False)

    def validate_request_type_id(self, value):
        try:
            request_type = RequestType.objects.get(pk=value)
        except RequestType.DoesNotExist:
            raise serializers.ValidationError("Unknown request type.")
        if not request_type.is_active:
            raise serializers.ValidationError("This request type is not active.")
        return request_type

    def validate(self, attrs):
        protected = set(self.initial_data) - {"request_type_id", "title", "details"}
        if protected:
            raise serializers.ValidationError(
                {field: ["This field is managed by the server."] for field in sorted(protected)}
            )
        attrs.setdefault("details", "")
        return attrs


class DraftEditSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255, trim_whitespace=True, required=False)
    details = serializers.CharField(required=False, allow_blank=True, max_length=10_000, trim_whitespace=False)

    def validate(self, attrs):
        protected = set(self.initial_data) - {"title", "details"}
        if protected:
            raise serializers.ValidationError(
                {field: ["This field is managed by the server."] for field in sorted(protected)}
            )
        if not attrs:
            raise serializers.ValidationError({"non_field_errors": ["No permitted fields to update."]})
        return attrs


class SubmitRequestSerializer(serializers.Serializer):
    """Submit payload (Story 2.3): the client sends only its known version.

    Routing, reviewer snapshot, and status are server-derived; any other
    field (status/manager/assignee/...) is rejected as protected.
    """

    version = serializers.IntegerField()

    def validate(self, attrs):
        protected = set(self.initial_data) - {"version"}
        if protected:
            raise serializers.ValidationError(
                {field: ["This field is managed by the server."] for field in sorted(protected)}
            )
        return attrs


DECISION_ACTIONS = ("approve", "reject", "return")
COMMENT_MAX_LENGTH = 2000


class DecisionSerializer(serializers.Serializer):
    """Decision payload (Story 2.4): action + comment + known version.

    The reviewer sends action (approve/reject/return), a comment that must be
    non-blank and bounded for reject/return (optional for approve), and the
    version it last saw for optimistic concurrency. Status, assignee, and
    manager-at-submission remain server-managed: any such field in the payload
    is rejected as protected (422).
    """

    action = serializers.ChoiceField(choices=DECISION_ACTIONS)
    comment = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        max_length=COMMENT_MAX_LENGTH,
        trim_whitespace=True,
    )
    version = serializers.IntegerField()

    def validate(self, attrs):
        protected = set(self.initial_data) - {"action", "comment", "version"}
        if protected:
            raise serializers.ValidationError(
                {field: ["This field is managed by the server."] for field in sorted(protected)}
            )
        action = attrs["action"]
        comment = (attrs.get("comment") or "").strip()
        if action in ("reject", "return") and not comment:
            raise serializers.ValidationError(
                {"comment": ["A non-blank comment is required to reject or return a request."]}
            )
        attrs["comment"] = comment
        return attrs


class CancelRequestSerializer(serializers.Serializer):
    """Cancel payload (Story 2.5): explicit confirmation + known version.

    The contract is {confirm: true, version: <int>}: a missing or falsy
    confirm is rejected 422 with no mutation. Any other field
    (status/manager/assignee/...) is rejected as protected.
    """

    confirm = serializers.BooleanField()
    version = serializers.IntegerField()

    def validate(self, attrs):
        protected = set(self.initial_data) - {"confirm", "version"}
        if protected:
            raise serializers.ValidationError(
                {field: ["This field is managed by the server."] for field in sorted(protected)}
            )
        if attrs.get("confirm") is not True:
            raise serializers.ValidationError(
                {"confirm": ["Explicit confirmation (confirm=true) is required to cancel a request."]}
            )
        return attrs
