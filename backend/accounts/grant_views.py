"""Manager-grant endpoints — Story H16 (HR only).

  GET    /api/v1/manager-grants                list every grant
  POST   /api/v1/manager-grants                grant (re-activates a revoked one)
  DELETE /api/v1/manager-grants/<id>           revoke (soft: is_active=False)

A grant is never deleted: the row keeps who granted what, to whom, and when, and
the HR screen can show the history. Re-granting the same (manager, employee,
scope) flips the existing row back on instead of piling up duplicates, which is
what the unique constraint promises.

Only HR reaches this module's views; every other authenticated caller gets the
shared 404-style envelope, so the existence of a grant is never disclosed.
"""
from django.db import transaction
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.grant_serializers import ManagerGrantReadSerializer, ManagerGrantWriteSerializer
from accounts.models import AuditEvent, ManagerGrant
from accounts.permissions import IsAuthenticated401, IsHR
from accounts.throttles import MutationRateThrottle
from config.api import error_payload


def _safe_denial(request):
    return Response(
        error_payload(code="not_found", message="Not found.", fields={}, request=request),
        status=status.HTTP_404_NOT_FOUND,
    )


class ManagerGrantListView(APIView):
    permission_classes = [IsAuthenticated401, IsHR]
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request):
        # HR sees every grant, not only their own — the screen is the org's ledger.
        grants = ManagerGrant.objects.select_related("manager", "employee").all()
        return Response({"data": ManagerGrantReadSerializer(grants, many=True).data})

    def post(self, request):
        serializer = ManagerGrantWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            grant, created = ManagerGrant.objects.get_or_create(
                manager_id=data["manager"],
                employee_id=data["employee"],
                scope=data["scope"],
                defaults={
                    "granted_by": request.user,
                    "is_active": True,
                    # H30 §4.1: a grant lives inside ONE company — the actor's.
                    "company": request.user.company,
                },
            )
            if not created and not grant.is_active:
                grant.is_active = True
                grant.granted_by = request.user
                grant.save(update_fields=["is_active", "granted_by"])
            AuditEvent.objects.create(
                company=request.user.company,
                actor=request.user,
                subject_id=data["employee"],
                action="manager_grant.granted" if created else "manager_grant.reactivated",
                request_id=request.request_id or "",
                before={},
                after={"manager": data["manager"], "employee": data["employee"], "scope": data["scope"]},
            )

        payload = ManagerGrantReadSerializer(grant).data
        return Response(
            {"data": payload},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class ManagerGrantDetailView(APIView):
    permission_classes = [IsAuthenticated401, IsHR]
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        return super().get_throttles()

    def delete(self, request, grant_id):
        grant = (
            ManagerGrant.objects.select_related("manager", "employee").filter(pk=grant_id).first()
        )
        if grant is None:
            return _safe_denial(request)
        if grant.is_active:
            with transaction.atomic():
                grant.is_active = False
                grant.save(update_fields=["is_active"])
                AuditEvent.objects.create(
                    company=request.user.company,
                    actor=request.user,
                    subject_id=grant.employee_id,
                    action="manager_grant.revoked",
                    request_id=request.request_id or "",
                    before={"is_active": True},
                    after={"is_active": False, "scope": grant.scope},
                )
        return Response({"data": ManagerGrantReadSerializer(grant).data})
