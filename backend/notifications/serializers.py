from rest_framework import serializers

from notifications.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    is_read = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = ("id", "kind", "title", "body", "created_at", "read_at", "is_read")
        read_only_fields = fields

    def get_is_read(self, notification):
        return notification.read_at is not None


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
