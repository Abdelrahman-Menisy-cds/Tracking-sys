"""Department endpoints — Story H16 (HR only).

  GET   /api/v1/departments          list (active and inactive, ordered by code)
  POST  /api/v1/departments          create
  GET   /api/v1/departments/<id>     retrieve one
  PATCH /api/v1/departments/<id>     rename / reassign the manager / deactivate

Every non-HR authenticated caller gets the shared 404-style envelope, same as the
employee endpoints: no department is disclosed to anybody else (permission-matrix
404 policy).

A department is owned from INSIDE itself: its manager must be one of its active
members. So assigning a manager either confirms an existing membership, or — when
that person has no department at all yet, the common case right after HR creates
the team — places them in it. A manager who already belongs to a DIFFERENT
department is refused rather than silently moved: moving somebody between
departments is an org change that happens through the employee record, never as a
side effect of editing a department. Placement and every assignment are audited.
"""
from django.db import transaction
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.department_serializers import DepartmentReadSerializer, DepartmentWriteSerializer
from accounts.models import AuditEvent, Department, EmployeeProfile, User
from accounts.permissions import IsAuthenticated401, IsHR
from accounts.throttles import MutationRateThrottle
from config.api import error_payload


def _safe_denial(request):
    return Response(
        error_payload(code="not_found", message="Not found.", fields={}, request=request),
        status=status.HTTP_404_NOT_FOUND,
    )


def _validation_response(request, fields, message="Validation failed."):
    return Response(
        error_payload(code="validation_error", message=message, fields=fields, request=request),
        status=status.HTTP_422_UNPROCESSABLE_ENTITY,
    )


def _assign_manager(*, department, manager_id, actor, request_id):
    """Set ``department.manager``, placing the person inside it if need be.

    Returns an error dict for the caller to render, or None on success. Three
    outcomes when a manager is named:

      * already an active member -> assigned as-is;
      * holds no department at all -> placed in this one (audited), then assigned;
      * belongs to another department -> refused, so a department edit can never
        quietly move a person between teams.

    ``manager_id=None`` clears the column and is audited too.
    """
    if manager_id is None:
        if department.manager_id is not None:
            AuditEvent.objects.create(
                company=actor.company,
                actor=actor,
                subject_id=department.manager_id,
                action="department.manager_unassigned",
                request_id=request_id or "",
                before={"department": department.pk, "manager": department.manager_id},
                after={"department": department.pk, "manager": None},
            )
        department.manager_id = None
        department.save(update_fields=["manager"])
        return None

    profile = EmployeeProfile.objects.filter(user_id=manager_id).first()
    if profile is None:
        profile = EmployeeProfile.objects.create(
            user_id=manager_id,
            # The profile belongs to the MANAGER's company (same company by the
            # no-cross-company-creation invariant; read from the user row).
            company_id=User.objects.filter(pk=manager_id)
            .values_list("company_id", flat=True)
            .first(),
        )
    if profile.department_id != department.pk:
        if profile.department_id is not None:
            return {
                "manager": [
                    "The proposed manager already belongs to another department; move them first."
                ]
            }
        profile.department = department
        profile.save(update_fields=["department"])
        AuditEvent.objects.create(
            company=actor.company,
            actor=actor,
            subject_id=manager_id,
            action="department.manager_placed",
            request_id=request_id or "",
            before={"department": None},
            after={"department": department.pk},
        )

    if department.manager_id != manager_id:
        AuditEvent.objects.create(
            company=actor.company,
            actor=actor,
            subject_id=manager_id,
            action="department.manager_assigned",
            request_id=request_id or "",
            before={"department": department.pk, "manager": department.manager_id},
            after={"department": department.pk, "manager": manager_id},
        )
    department.manager_id = manager_id
    department.save(update_fields=["manager"])
    return None


class DepartmentListView(APIView):
    permission_classes = [IsAuthenticated401, IsHR]
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request):
        departments = Department.objects.select_related("manager").all()
        return Response({"data": DepartmentReadSerializer(departments, many=True).data})

    def post(self, request):
        serializer = DepartmentWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        missing = {
            field: ["This field is required."]
            for field in ("code", "name_ar")
            if not data.get(field)
        }
        if missing:
            return _validation_response(request, missing)
        if Department.objects.filter(code=data["code"]).exists():
            return _validation_response(
                request, {"code": ["A department with this code already exists."]}
            )

        with transaction.atomic():
            department = Department.objects.create(
                company=request.user.company,
                code=data["code"],
                name_ar=data["name_ar"],
                name_en=data.get("name_en", ""),
                is_active=data.get("is_active", True),
            )
            manager_id = data.get("manager")
            if manager_id is not None:
                error = _assign_manager(
                    department=department,
                    manager_id=manager_id,
                    actor=request.user,
                    request_id=request.request_id,
                )
                if error:
                    # Nothing half-built: the department and its manager are one unit.
                    transaction.set_rollback(True)
                    return _validation_response(request, error)

        return Response(
            {"data": DepartmentReadSerializer(department).data}, status=status.HTTP_201_CREATED
        )


class DepartmentDetailView(APIView):
    permission_classes = [IsAuthenticated401, IsHR]
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def _resolve(self, department_id):
        return Department.objects.select_related("manager").filter(pk=department_id).first()

    def get(self, request, department_id):
        department = self._resolve(department_id)
        if department is None:
            return _safe_denial(request)
        return Response({"data": DepartmentReadSerializer(department).data})

    def patch(self, request, department_id):
        department = self._resolve(department_id)
        if department is None:
            return _safe_denial(request)
        serializer = DepartmentWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if "code" in data and Department.objects.exclude(pk=department.pk).filter(code=data["code"]).exists():
            return _validation_response(
                request, {"code": ["A department with this code already exists."]}
            )

        with transaction.atomic():
            for field in ("code", "name_ar", "name_en", "is_active"):
                if field in data:
                    setattr(department, field, data[field])
            if "manager" in data:
                error = _assign_manager(
                    department=department,
                    manager_id=data["manager"],
                    actor=request.user,
                    request_id=request.request_id,
                )
                if error:
                    transaction.set_rollback(True)
                    return _validation_response(request, error)
            department.save()

        return Response({"data": DepartmentReadSerializer(department).data})
