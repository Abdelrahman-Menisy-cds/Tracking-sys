"""Employee-administration serializers — Story 1.3, extended by Story H16.

Allowlist layer: only approved authoritative fields are accepted; anything
else in the payload is rejected with a field-level error before the service
runs, so no authoritative field can change by accident. Manager and
department are writable PKs; existence/active/cycle validation lives in the
service so a bad manager or a manager outside the employee's own department
never leaves the prior relationship partially modified.
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
    "department",
}


def _reject_non_authoritative(serializer):
    protected = set(serializer.initial_data) - AUTHORITATIVE_FIELDS
    if protected:
        raise serializers.ValidationError(
            {field: ["This field is managed by the organization."] for field in protected}
        )


class EmployeeReadSerializer(serializers.Serializer):
    """Authoritative employee representation for HR list/retrieve.

    Department travels in both shapes on purpose: ``department_id`` is what a
    write sends back, and the code/name pair is what the roster's «الإدارة»
    column renders without a second request. ``manager_name`` exists for the
    same reason — the HR screen shows people, not ids.
    """

    id = serializers.IntegerField(read_only=True, source="pk")
    email = serializers.EmailField(read_only=True)
    full_name = serializers.CharField(read_only=True)
    role = serializers.CharField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    employee_number = serializers.SerializerMethodField()
    job_title = serializers.SerializerMethodField()
    manager_id = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()
    department_id = serializers.SerializerMethodField()
    department_code = serializers.SerializerMethodField()
    department_name_ar = serializers.SerializerMethodField()
    department_name_en = serializers.SerializerMethodField()

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

    def get_manager_name(self, user):
        profile = self._profile(user)
        if profile is None or profile.manager_id is None:
            return None
        manager = profile.manager
        return manager.full_name or manager.email

    def _department(self, user):
        profile = self._profile(user)
        return profile.department if profile is not None else None

    def get_department_id(self, user):
        department = self._department(user)
        return department.pk if department is not None else None

    def get_department_code(self, user):
        department = self._department(user)
        return department.code if department is not None else None

    def get_department_name_ar(self, user):
        department = self._department(user)
        return department.name_ar if department is not None else None

    def get_department_name_en(self, user):
        department = self._department(user)
        return department.name_en if department is not None else None


class EmployeeWriteSerializerBase(serializers.Serializer):
    manager = serializers.IntegerField(required=False, allow_null=True)
    department = serializers.IntegerField(required=False, allow_null=True)
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
