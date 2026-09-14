from rest_framework import serializers


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(trim_whitespace=True)
    password = serializers.CharField(
        max_length=128,
        trim_whitespace=False,
        style={"input_type": "password"},
    )


class CurrentUserSerializer(serializers.Serializer):
    """Authoritative identity and preference representation for /auth/me."""

    id = serializers.IntegerField(read_only=True, source="pk")
    email = serializers.EmailField(read_only=True)
    full_name = serializers.CharField(read_only=True)
    role = serializers.CharField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    preferred_locale = serializers.CharField(read_only=True)
    appearance = serializers.CharField(read_only=True)
    timezone_display = serializers.CharField(read_only=True)


class CurrentUserUpdateSerializer(serializers.Serializer):
    """The complete allowlist for a signed-in user's own profile changes."""

    full_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    preferred_locale = serializers.ChoiceField(choices=("ar", "en"), required=False)
    appearance = serializers.ChoiceField(choices=("system", "light", "dark"), required=False)
    timezone_display = serializers.CharField(max_length=63, required=False, allow_blank=False)
    # Story 5.3 stale-write guard: the appearance value the client last saw.
    # When provided and different from the saved value the update is a stale
    # write (409 version_conflict) instead of silently overwriting a newer
    # selection; omitted means last-write-wins (backwards compatible).
    expected_appearance = serializers.ChoiceField(
        choices=("system", "light", "dark"), required=False, write_only=True
    )

    class AppearanceStaleWrite(Exception):
        """The client's expected appearance does not match the saved value."""

    def validate(self, attrs):
        protected_fields = set(self.initial_data) - set(self.fields)
        if protected_fields:
            raise serializers.ValidationError(
                {field_name: ["This field is managed by the organization."] for field_name in protected_fields}
            )
        return attrs

    def update(self, user, validated_data):
        expected = validated_data.pop("expected_appearance", None)
        if expected is not None and "appearance" in validated_data and user.appearance != expected:
            raise self.AppearanceStaleWrite()
        for field_name, field_value in validated_data.items():
            setattr(user, field_name, field_value)
        user.save(update_fields=list(validated_data))
        return user

    def create(self, validated_data):
        raise NotImplementedError("Current-user updates always apply to an existing user.")
