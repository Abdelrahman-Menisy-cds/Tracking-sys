"""Employee-administration serializers — Story 1.3.

Allowlist layer: only approved authoritative fields are accepted; anything
else in the payload is rejected with a field-level error before the service
runs, so no authoritative field can change by accident. Manager is a
writable PK; existence/active/cycle validation lives in the service so a
bad manager never leaves the prior relationship partially modified.
"""
from rest_framework import serializers

from accounts.models import EmployeeProfile, User

ROLE_CHOICES = [choice[0] for choice in User.Role.choices]

AUTHORITATIVE_FIELDS = {
    "email",
    "full_name",
    "role",
    "is_active",
    "employee_number",
    "job_title",
    "manager",
}


def _reject_non_authoritative(serializer):
    protected = set(serializer.initial_data) - AUTHORITATIVE_FIELDS
    if protected:
        raise serializers.ValidationError(
            {field: ["This field is managed by the organization."] for field in protected}
        )


class EmployeeReadSerializer(serializers.Serializer):
    """Authoritative employee representation for HR list/retrieve."""

    id = serializers.IntegerField(read_only=True, source="pk")
    email = serializers.EmailField(read_only=True)
    full_name = serializers.CharField(read_only=True)
    role = serializers.CharField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    employee_number = serializers.SerializerMethodField()
    job_title = serializers.SerializerMethodField()
    manager_id = serializers.SerializerMethodField()

    def _profile(self, user):
        profile = getattr(user, "employee_profile", None)
        if profile is None and user.pk is not None:
            profile = EmployeeProfile.objects.filter(user_id=user.pk).first()
        return profile

    def get_employee_number(self, user):
        profile = self._profile(user)
        return profile.employee_number if profile else None

    def get_job_title(self, user):
        profile = self._profile(user)
        return profile.job_title if profile else ""

    def get_manager_id(self, user):
        profile = self._profile(user)
        return profile.manager_id if profile else None


class EmployeeWriteSerializerBase(serializers.Serializer):
    manager = serializers.IntegerField(required=False, allow_null=True)
    employee_number = serializers.CharField(required=False, allow_null=True, allow_blank=False, max_length=32)
    job_title = serializers.CharField(required=False, allow_blank=True, max_length=100)

    def validate(self, attrs):
        _reject_non_authoritative(self)
        return attrs


class EmployeeCreateSerializer(EmployeeWriteSerializerBase):
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=ROLE_CHOICES, required=False)
    is_active = serializers.BooleanField(required=False)

    def create(self, validated_data):
        raise NotImplementedError("Writes go through accounts.employee_service.create_employee.")


class EmployeeUpdateSerializer(EmployeeWriteSerializerBase):
    email = serializers.EmailField(required=False)
    full_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=ROLE_CHOICES, required=False)
    is_active = serializers.BooleanField(required=False)

    def create(self, validated_data):
        raise NotImplementedError("Writes go through accounts.employee_service.update_employee.")
