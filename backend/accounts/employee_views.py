"""Employee administration endpoints — Story 1.3 (HR only).

  GET  /api/v1/employees            list (bounded pagination, active only)
  POST /api/v1/employees            create
  GET  /api/v1/employees/<id>/      retrieve one employee (also inactive)
  PATCH /api/v1/employees/<id>/     update authoritative fields

Every non-HR authenticated caller gets the shared 404-style envelope —
no employee data is disclosed (epics.md 189-191). Mutations are throttled
and CSRF stays enforced by the global session authenticator.
"""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.employee_serializers import (
    EmployeeCreateSerializer,
    EmployeeReadSerializer,
    EmployeeUpdateSerializer,
)
from accounts.employee_service import EmployeeValidationError, create_employee, update_employee
from accounts.models import User
from accounts.permissions import IsAuthenticated401, IsHR
from accounts.throttles import MutationRateThrottle
from config.api import EmployeePagination, error_payload


def _safe_denial(request):
    return Response(
        error_payload(code="not_found", message="Not found.", fields={}, request=request),
        status=status.HTTP_404_NOT_FOUND,
    )


def _visible_users(company):
    """The workforce list of ONE company (H30 §3: the tenant is the boundary).

    Employees and managers only — HR actors and any superuser/staff
    break-glass account are excluded from the workforce list. ``company`` is
    the caller's, resolved by TenantMiddleware: without it this list was the
    whole database, so HR of one company read every other company's staff.
    """
    return (
        User.objects.select_related("employee_profile")
        .filter(company=company, is_staff=False, is_superuser=False)
        .exclude(role=User.Role.HR)
        .order_by("id")
    )


def _validation_response(request, exc):
    return Response(
        error_payload(
            code="validation_error",
            message="Validation failed.",
            fields={exc.field: [exc.message]},
            request=request,
        ),
        status=status.HTTP_422_UNPROCESSABLE_ENTITY,
    )


class EmployeeListView(APIView):
    permission_classes = [IsAuthenticated401, IsHR]
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request):
        paginator = EmployeePagination()
        page = paginator.paginate_queryset(_visible_users(request.user.company).filter(is_active=True), request, view=self)
        return paginator.get_paginated_response(EmployeeReadSerializer(page, many=True).data)

    def post(self, request):
        serializer = EmployeeCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = {**serializer.validated_data, "request_id": request.request_id}
        try:
            user, _profile = create_employee(actor=request.user, validated_data=validated)
        except EmployeeValidationError as exc:
            return _validation_response(request, exc)
        return Response({"data": EmployeeReadSerializer(user).data}, status=status.HTTP_201_CREATED)


class EmployeeDetailView(APIView):
    permission_classes = [IsAuthenticated401, IsHR]
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def _resolve_target(self, request, target_id):
        """The target employee, only within the caller's company (H30 §3).

        Resolving through the caller's company turns a cross-tenant id into
        the same 404 an unknown id gets — no existence signal, no leak.
        """
        try:
            return _visible_users(request.user.company).get(pk=target_id)
        except (User.DoesNotExist, ValueError, TypeError):
            return None

    def get(self, request, target_id):
        target = self._resolve_target(request, target_id)
        if target is None:
            return _safe_denial(request)
        return Response({"data": EmployeeReadSerializer(target).data})

    def patch(self, request, target_id):
        target = self._resolve_target(request, target_id)
        if target is None:
            return _safe_denial(request)
        serializer = EmployeeUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        validated = {**serializer.validated_data, "request_id": request.request_id}
        try:
            user = update_employee(actor=request.user, user=target, validated_data=validated)
        except EmployeeValidationError as exc:
            return _validation_response(request, exc)
        return Response({"data": EmployeeReadSerializer(user).data})
