"""Manager-grant serializers — Story H16 (HR only).

A grant is HR's explicit, per-employee widening of a manager's scope. The
allowlist of scopes is CLOSED (``ManagerGrant.ALL_SCOPES``): HR cannot invent a
scope the enforcement layer does not know how to honour, so a typo cannot become
a silent no-op that looks like access.

What a grant carries: per the owner's decision, BOTH read and management
(approve/reject) for that one employee — in the review queues that means the
employee's records appear in the manager's queue AND ``can_decide`` is true for
their PENDING_MANAGER items.
"""
from rest_framework import serializers

from accounts.models import ManagerGrant, User


class ManagerGrantReadSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True, source="pk")
    manager_id = serializers.IntegerField(read_only=True)
    manager_name = serializers.SerializerMethodField()
    employee_id = serializers.IntegerField(read_only=True)
    employee_name = serializers.SerializerMethodField()
    scope = serializers.CharField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)

    def get_manager_name(self, grant):
        return grant.manager.full_name or grant.manager.email

    def get_employee_name(self, grant):
        return grant.employee.full_name or grant.employee.email


class ManagerGrantWriteSerializer(serializers.Serializer):
    manager = serializers.IntegerField()
    employee = serializers.IntegerField()
    scope = serializers.ChoiceField(choices=[value for value in ManagerGrant.ALL_SCOPES])

    def validate_manager(self, value):
        try:
            manager = User.objects.get(pk=value)
        except (User.DoesNotExist, ValueError, TypeError):
            raise serializers.ValidationError("The proposed manager does not exist.") from None
        if not manager.is_active:
            raise serializers.ValidationError("The proposed manager must be an active user.")
        if manager.role != User.Role.MANAGER:
            raise serializers.ValidationError("The proposed manager must hold the manager role.")
        return value

    def validate_employee(self, value):
        try:
            employee = User.objects.get(pk=value)
        except (User.DoesNotExist, ValueError, TypeError):
            raise serializers.ValidationError("The proposed employee does not exist.") from None
        if not employee.is_active:
            raise serializers.ValidationError("The proposed employee must be an active user.")
        return value

    def validate(self, attrs):
        if attrs["manager"] == attrs["employee"]:
            # Mirrors the DB check constraint so the caller gets a field error.
            raise serializers.ValidationError({"employee": ["A manager cannot be granted scope over themselves."]})
        return attrs
