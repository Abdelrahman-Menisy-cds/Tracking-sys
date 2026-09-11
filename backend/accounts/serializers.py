from rest_framework import serializers


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(trim_whitespace=True)
    password = serializers.CharField(
        max_length=128,
        trim_whitespace=False,
        style={"input_type": "password"},
    )


class CurrentUserSerializer(serializers.Serializer):
    """Authoritative identity representation for /auth/me."""

    id = serializers.IntegerField(read_only=True, source="pk")
    email = serializers.EmailField(read_only=True)
    full_name = serializers.CharField(read_only=True)
    role = serializers.CharField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)
