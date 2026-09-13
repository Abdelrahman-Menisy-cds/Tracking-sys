from rest_framework import serializers

from notifications.models import Notification


class RelatedObjectLinkSerializer(serializers.Serializer):
    """Safe related-object link for the recipient (Story 4.2 AC).

    Only stable, non-leaking fields: type/id plus the per-request
    availability flag. No status, title, or any hidden-record detail: an
    unavailable related object renders as available=false and nothing more.
    """

    type = serializers.SerializerMethodField()
    id = serializers.SerializerMethodField()
    available = serializers.SerializerMethodField()

    def get_type(self, notification):
        return notification.related_object_type

    def get_id(self, notification):
        return notification.related_object_id

    def get_available(self, notification):
        request = self.context.get("request")
        user = getattr(request, "user", request)
        if user is None or not getattr(user, "is_authenticated", False):
            return False
        from notifications.services import related_object_is_available

        return related_object_is_available(
            user, notification.related_object_type, notification.related_object_id
        )


class NotificationSerializer(serializers.ModelSerializer):
    is_read = serializers.SerializerMethodField()
    related_object = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = (
            "id",
            "kind",
            "title",
            "body",
            "created_at",
            "read_at",
            "is_read",
            "related_object",
        )
        read_only_fields = fields

    def get_is_read(self, notification):
        return notification.read_at is not None

    def get_related_object(self, notification):
        if not notification.related_object_type:
            return None
        return RelatedObjectLinkSerializer(notification, context=self.context).data


class NotificationReadStateSerializer(serializers.Serializer):
    """Notification read state is separate from the /auth/me profile allowlist."""

    is_read = serializers.BooleanField()

    def validate(self, attrs):
        unsupported_fields = set(self.initial_data) - set(self.fields)
        if unsupported_fields:
            raise serializers.ValidationError(
                {field_name: ["This field cannot be updated."] for field_name in unsupported_fields}
            )
        return attrs
