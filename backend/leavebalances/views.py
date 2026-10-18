"""Leave-balance endpoints (أرصدة الإجازات) — the HR settings panel's server half.

  GET  /api/v1/leave-balances?year=<int>   read balances (HR: everyone; else: own)
  POST /api/v1/leave-balances/adjust       HR-only, versioned, idempotent adjust

The read scope is the owner's rule: HR sees the whole company, an employee
sees only their own rows. The adjust endpoint is HR-only — a non-HR caller gets
the uniform 404 envelope (accounts.permissions.IsHR), never a disclosure that
balances exist, matching the work-schedules/holidays policy. Adjustments carry
the same discipline as the rest of the API: a required Idempotency-Key header,
{version} for optimistic concurrency (a stale write is refused 409, never
silently applied), and a mandatory reason.
"""
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import IsAuthenticated401, IsHR
from accounts.throttles import MutationRateThrottle
from config.api import error_payload
from leavebalances import serializers as ls
from leavebalances.services import (
    IdempotencyConflict,
    IdempotencyReplay,
    VersionConflict,
    adjust_balance,
    build_balance_payload,
    idempotency_fingerprint,
    leave_types,
)
from reqs.models import RequestType


def _parse_year(raw):
    """Return the requested year, defaulting to the current one."""
    if raw in (None, ""):
        return timezone.now().year
    try:
        year = int(raw)
    except (TypeError, ValueError):
        raise ValueError("not an integer")
    if year < 1974 or year > 2100:
        raise ValueError("out of range")
    return year


class LeaveBalanceListView(APIView):
    """GET /api/v1/leave-balances — scoped read, never mutates, never throttled."""

    permission_classes = [IsAuthenticated401]
    throttle_classes = []

    def get(self, request):
        try:
            year = _parse_year(request.query_params.get("year"))
        except ValueError:
            return Response(
                error_payload(
                    code="validation_error",
                    message="Invalid year query parameter.",
                    fields={"year": ["Year must be an integer between 1974 and 2100."]},
                    request=request,
                ),
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        return Response({"data": build_balance_payload(user=request.user, year=year)})


class LeaveBalanceAdjustView(APIView):
    """POST /api/v1/leave-balances/adjust — HR-only entitlement adjustment.

    Body: {employee_id, request_type_id, year, entitled_days, carried_over_days,
    version, reason}; header Idempotency-Key required. The employee and the
    leave type are resolved INSIDE the caller's company, so a foreign id is a
    validation error, never a cross-tenant write.
    """

    permission_classes = [IsAuthenticated401, IsHR]
    throttle_classes = [MutationRateThrottle]

    def post(self, request):
        idempotency_key = request.headers.get("Idempotency-Key", "").strip()
        if not idempotency_key:
            return Response(
                error_payload(
                    code="idempotency_key_required",
                    message="An Idempotency-Key header is required to adjust a balance.",
                    fields={"idempotency_key": ["Missing Idempotency-Key header."]},
                    request=request,
                ),
                status=422,
            )

        serializer = ls.LeaveBalanceAdjustSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        employee = User.objects.filter(
            pk=data["employee_id"], company=request.user.company
        ).first()
        if employee is None:
            return Response(
                error_payload(
                    code="validation_error",
                    message="Unknown employee.",
                    fields={"employee_id": ["No such employee in your company."]},
                    request=request,
                ),
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        # The leave type must be an ACTIVE leave type of the caller's company —
        # the same predicate the read side uses, so read and adjust agree.
        request_type = (
            leave_types(request.user.company).filter(pk=data["request_type_id"]).first()
        )
        if request_type is None:
            return Response(
                error_payload(
                    code="validation_error",
                    message="Unknown leave type.",
                    fields={
                        "request_type_id": [
                            "No active leave type with this id in your company."
                        ]
                    },
                    request=request,
                ),
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        key_hash, payload_hash = idempotency_fingerprint(
            key=idempotency_key,
            employee_id=employee.pk,
            request_type_id=request_type.pk,
            year=data["year"],
            entitled_days=data["entitled_days"],
            carried_over_days=data["carried_over_days"],
            version=data["version"],
        )

        try:
            row = adjust_balance(
                hr_user=request.user,
                employee=employee,
                request_type=request_type,
                year=data["year"],
                entitled_days=data["entitled_days"],
                carried_over_days=data["carried_over_days"],
                version=data["version"],
                reason=data["reason"],
                key_hash=key_hash,
                payload_hash=payload_hash,
            )
        except VersionConflict:
            return Response(
                error_payload(
                    code="version_conflict",
                    message="This balance changed since you last saw it. Reload and try again.",
                    fields={"version": ["The provided version is stale."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except IdempotencyReplay as replay:
            return Response(replay.snapshot, status=status.HTTP_200_OK)
        except IdempotencyConflict:
            return Response(
                error_payload(
                    code="idempotency_conflict",
                    message="This idempotency key was already used with a different payload.",
                    fields={"idempotency_key": ["Key reused with different payload."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )

        return Response({"data": row}, status=status.HTTP_200_OK)
