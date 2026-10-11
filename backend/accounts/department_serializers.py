"""Department serializers — Story H16 (HR only).

A department is the unit the owner asked for: one place to name it, one place to
say which manager owns it, and one place to see who belongs to it. Writes are
allowlisted the same way employee writes are: anything not named here is refused
before it can touch a row.
"""
from rest_framework import serializers

from accounts.models import EmployeeProfile, User


class DepartmentReadSerializer(serializers.Serializer):
    """Department representation for the HR organisation screen.

    ``member_count`` counts ACTIVE members only — the screen's whole point is to
    show HR where the workforce actually is, and a deactivated account must not
    inflate it.
    """

    id = serializers.IntegerField(read_only=True, source="pk")
    code = serializers.CharField(read_only=True)
    name_ar = serializers.CharField(read_only=True)
    name_en = serializers.CharField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    manager_id = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()

    def get_manager_id(self, department):
        return department.manager_id

    def get_manager_name(self, department):
        manager = department.manager
        if manager is None:
            return None
        return manager.full_name or manager.email

    def get_member_count(self, department):
        return EmployeeProfile.objects.filter(
            department_id=department.pk, user__is_active=True
        ).count()


class DepartmentWriteSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=32, required=False)
    name_ar = serializers.CharField(max_length=120, required=False)
    name_en = serializers.CharField(max_length=120, required=False, allow_blank=True)
    manager = serializers.IntegerField(required=False, allow_null=True)
    is_active = serializers.BooleanField(required=False)

    def validate_manager(self, value):
        """The manager column only ever holds an active MANAGER, never anyone else.

        Membership of the department itself is checked in the view, where the
        department (and therefore its roster) is known.
        """
        if value is None:
            return None
        try:
            user = User.objects.get(pk=value)
        except (User.DoesNotExist, ValueError, TypeError):
            raise serializers.ValidationError("The proposed manager does not exist.") from None
        if not user.is_active:
            raise serializers.ValidationError("The proposed manager must be an active user.")
        if user.role != User.Role.MANAGER:
            raise serializers.ValidationError("The proposed manager must hold the manager role.")
        return value
