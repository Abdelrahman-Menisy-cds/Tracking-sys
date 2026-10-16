from django.core.exceptions import ValidationError as django_exceptions_ValidationError
from django.core.validators import EmailValidator
from rest_framework import serializers


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(trim_whitespace=True)
    password = serializers.CharField(
        max_length=128,
        trim_whitespace=False,
        style={"input_type": "password"},
    )


class SignupSerializer(serializers.Serializer):
    """Body of POST /auth/signup: {email, code, password} (Story H14)."""

    email = serializers.EmailField(trim_whitespace=True)
    code = serializers.CharField(max_length=128, trim_whitespace=True)
    password = serializers.CharField(
        max_length=128,
        trim_whitespace=False,
        style={"input_type": "password"},
    )

    def validate_password(self, value):
        """Run the app's own password validators; surface their messages."""
        from django.contrib.auth.password_validation import validate_password

        try:
            validate_password(value)
        except django_exceptions_ValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value


class CurrentUserSerializer(serializers.Serializer):
    """Authoritative identity and preference representation for /auth/me.

    ``needs_company_profile`` (Story H17) is the onboarding gate the frontend
    reads: True when the organisation's company profile is missing or still
    has a blank required field. Computed against the singleton row, HR or not,
    because the gate is about THE organisation, not the caller's role.
    """

    id = serializers.IntegerField(read_only=True, source="pk")
    email = serializers.EmailField(read_only=True)
    full_name = serializers.CharField(read_only=True)
    role = serializers.CharField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    preferred_locale = serializers.CharField(read_only=True)
    appearance = serializers.CharField(read_only=True)
    timezone_display = serializers.CharField(read_only=True)
    needs_company_profile = serializers.SerializerMethodField()

    def get_needs_company_profile(self, user) -> bool:
        from accounts.company_serializers import merged_missing_required
        from accounts.models import CompanyProfile

        try:
            profile = CompanyProfile.objects.get(company=user.company)
        except CompanyProfile.DoesNotExist:
            return True
        return bool(merged_missing_required(profile, {}))


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
