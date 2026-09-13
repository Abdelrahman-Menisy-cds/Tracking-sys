"""Timesheet endpoints (Story 3.1): owner-scoped create/list/detail.

- POST /api/v1/timesheets   (create unique week container + entries)
- GET  /api/v1/timesheets   (requester's own sheets, bounded pagination)
- GET  /api/v1/timesheets/{id} (owner-only detail; other users see 404)

Authorization, error envelope, idempotency-key handling, throttling, and CSRF
reuse the shared patterns (config.api.error_payload, MutationRateThrottle,
CsrfEnforcedSessionAuthentication) — no bespoke paths for this story.
"""
from hashlib import sha256

from django.http import Http404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.throttles import MutationRateThrottle
from config.api import RequestPagination, error_payload

from . import serializers as ts
from .models import Timesheet
from .services import (
    DuplicateWeek,
    IdempotencyConflict,
    IdempotencyReplay,
    TimesheetError,
    create_timesheet,
)


def _get_own_timesheet(user, pk):
    """Raise the same 404 for a missing sheet as for another user's sheet."""
    try:
        return Timesheet.objects.get(pk=pk, employee=user)
    except (Timesheet.DoesNotExist, ValueError):
        raise Http404


def _duplicate_week_payload(request, existing: Timesheet):
    """Safe duplicate-week 409 body.

    The existing sheet reference (id, week_start) is included ONLY because the
    create request is owner-only; another employee can never reach this code
    path with someone else's sheet, and a nonexistent or unauthorized attempt
    receives 401/404 instead — never this payload.
    """
    return error_payload(
        code="duplicate_week",
        message="A timesheet already exists for this week.",
        fields={
            "week_start": [
                {
                    "existing_timesheet_id": str(existing.pk),
                    "existing_week_start": existing.week_start.isoformat(),
                }
            ]
        },
        request=request,
    )


class TimesheetListCreateView(APIView):
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request):
        paginator = RequestPagination()
        page = paginator.paginate_queryset(
            Timesheet.objects.filter(employee=request.user),
            request,
            view=self,
        )
        return paginator.get_paginated_response(ts.TimesheetSerializer(page, many=True).data)

    def post(self, request):
        idempotency_key = request.headers.get("Idempotency-Key", "").strip()
        if not idempotency_key:
            return Response(
                error_payload(
                    code="idempotency_key_required",
                    message="An Idempotency-Key header is required to create a timesheet.",
                    fields={"idempotency_key": ["Missing Idempotency-Key header."]},
                    request=request,
                ),
                status=422,
            )

        serializer = ts.TimesheetCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        week_start = serializer.validated_data["week_start"]
        entries = serializer.validated_data["entries"]

        payload_hash = sha256(
            f"{week_start.isoformat()}:{sorted((str(e['work_date']), e['duration_minutes'], e['unpaid_break_minutes'], e.get('description', '')) for e in entries)}".encode()
        ).hexdigest()
        key_hash = sha256(idempotency_key.encode()).hexdigest()

        try:
            sheet = create_timesheet(
                employee=request.user,
                week_start=week_start,
                entries=entries,
                key_hash=key_hash,
                payload_hash=payload_hash,
            )
        except IdempotencyReplay as exc:
            # Replay the stored committed response as 201 shape with the stored id.
            sheet = Timesheet.objects.get(pk=exc.snapshot["timesheet_id"])
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
        except DuplicateWeek as exc:
            return Response(
                _duplicate_week_payload(request, exc.existing),
                status=status.HTTP_409_CONFLICT,
            )
        except TimesheetError as exc:
            return Response(
                error_payload(
                    code=exc.code,
                    message=exc.message,
                    fields={exc.field: [str(exc.message)]},
                    request=request,
                ),
                status=422,
            )

        body = {"data": ts.TimesheetSerializer(sheet).data}
        return Response(body, status=status.HTTP_201_CREATED)


class TimesheetDetailView(APIView):
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request, pk):
        instance = _get_own_timesheet(request.user, pk)
        return Response({"data": ts.TimesheetSerializer(instance).data})
