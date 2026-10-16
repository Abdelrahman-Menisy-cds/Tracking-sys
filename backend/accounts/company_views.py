"""Company profile endpoints — Story H17 (HR only).

  GET   /api/v1/company   {"data": {"profile": {...}|null, "needs_profile": bool}}
  PATCH /api/v1/company   partial update; merged result must stay complete

Permissions mirror review/report_views.py (the in-codebase 403 precedent): an
authenticated caller without the HR application role gets the standard 403
``permission_denied`` envelope; anonymous callers get 401 (IsAuthenticated401).
An employee or a manager never partial-fails into a disclosure — they are
denied before any profile data is read.
"""
from django.db import transaction
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.company_serializers import (
    CompanyProfileReadSerializer,
    CompanyProfileWriteSerializer,
    apply_profile_update,
    merged_missing_required,
)
from accounts.models import CompanyProfile, User
from accounts.permissions import IsAuthenticated401
from accounts.throttles import MutationRateThrottle
from config.api import error_payload


def _error(request, code, message, fields, status_code):
    return Response(
        error_payload(code=code, message=message, fields=fields, request=request),
        status=status_code,
    )


def _hr_denied(request):
    return _error(
        request,
        "permission_denied",
        "You do not have permission to perform this action.",
        {},
        status.HTTP_403_FORBIDDEN,
    )


def _load_profile(user):
    """The caller's company row, or None (H30 plan §2.4: per-company reads).

    The pre-tenancy guard read (pk=1) is gone with the singleton; an
    unauthenticated caller never reaches this (view-level HR gate first).
    """
    try:
        return CompanyProfile.objects.get(company=user.company)
    except CompanyProfile.DoesNotExist:
        return None


def _payload(profile):
    return {
        "profile": CompanyProfileReadSerializer(profile).data if profile is not None else None,
        "needs_profile": not profile or bool(merged_missing_required(profile, {})),
    }


class CompanyProfileView(APIView):
    permission_classes = [IsAuthenticated401]
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def _hr_user(self, request):
        """The caller when they hold the HR application role, else None."""
        if request.user.is_authenticated and request.user.role == User.Role.HR:
            return request.user
        return None

    def get(self, request):
        actor = self._hr_user(request)
        if actor is None:
            return _hr_denied(request)
        return Response({"data": _payload(_load_profile(actor))})

    def patch(self, request):
        actor = self._hr_user(request)
        if actor is None:
            return _hr_denied(request)
        serializer = CompanyProfileWriteSerializer(data=request.data, partial=True)
        if not serializer.is_valid():
            return _error(
                request,
                "validation_error",
                "Validation failed.",
                serializer.errors,
                status.HTTP_400_BAD_REQUEST,
            )
        profile = _load_profile(actor)
        missing = merged_missing_required(profile, serializer.validated_data)
        if missing:
            return _error(
                request,
                "validation_error",
                "The company profile is missing required fields.",
                {
                    field: ["This field is required."]
                    for field in missing
                },
                status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            profile, _event = apply_profile_update(
                profile=profile,
                validated_data=serializer.validated_data,
                actor=actor,
                request_id=request.request_id,
            )
        return Response({"data": _payload(profile)})
