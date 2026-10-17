"""Work-schedule endpoints — Story H39 (HR only).

  GET    /api/v1/work-schedules              the company's schedules (active one flagged)
  POST   /api/v1/work-schedules              create schedule + days, one transaction
  GET    /api/v1/work-schedules/<id>         one schedule with its days
  PATCH  /api/v1/work-schedules/<id>         edit scalars and/or replace the day set
  DELETE /api/v1/work-schedules/<id>         deactivate (soft delete: the row stays
                                             as the version trail the settings card shows)

The enterprise-settings card previously reported honestly that no schedule
endpoint existed; this is that endpoint. Permission is the HR application
role through IsHR — an authenticated non-HR caller gets the same uniform 404
envelope as an unknown resource (permission-matrix 404 policy), never a
disclosure that schedules exist.

Every query is company-scoped. This file exists because department_views.py
once shipped four unscoped queries and any HR could read every tenant's
departments (fixed in cb74a25) — the list/detail resolvers below filter by
the caller's company first, and tenants/test_isolation.py holds the tests
that keep it that way.
"""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import work_schedule_service
from accounts.models import WorkSchedule
from accounts.permissions import IsAuthenticated401, IsHR
from accounts.throttles import MutationRateThrottle
from accounts.work_schedule_serializers import WorkScheduleReadSerializer, WorkScheduleWriteSerializer
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


class WorkScheduleListView(APIView):
    permission_classes = [IsAuthenticated401, IsHR]
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request):
        # Scoped to the caller's company: without the filter an HR account
        # would read every tenant's schedules — the exact bug class cb74a25
        # fixed for departments.
        schedules = WorkSchedule.objects.filter(company=request.user.company).prefetch_related("days")
        return Response({"data": WorkScheduleReadSerializer(schedules, many=True).data})

    def post(self, request):
        serializer = WorkScheduleWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        # Truthiness, like the department create: an empty name or an empty
        # day set is as useless as a missing one — a schedule arrives WITH
        # its week or not at all.
        missing = {
            field: ["This field is required."]
            for field in ("name", "effective_from", "days")
            if not data.get(field)
        }
        if missing:
            return _validation_response(request, missing)

        schedule = work_schedule_service.create_schedule(
            company=request.user.company,
            created_by=request.user,
            validated_data=data,
        )
        return Response(
            {"data": WorkScheduleReadSerializer(schedule).data}, status=status.HTTP_201_CREATED
        )


class WorkScheduleDetailView(APIView):
    permission_classes = [IsAuthenticated401, IsHR]
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def _resolve(self, schedule_id):
        # Same scope as the list: an id from another company is answered with
        # the shared 404 envelope — never the row, never its existence.
        return (
            WorkSchedule.objects.filter(company=self.request.user.company, pk=schedule_id)
            .prefetch_related("days")
            .first()
        )

    def get(self, request, schedule_id):
        schedule = self._resolve(schedule_id)
        if schedule is None:
            return _safe_denial(request)
        return Response({"data": WorkScheduleReadSerializer(schedule).data})

    def patch(self, request, schedule_id):
        schedule = self._resolve(schedule_id)
        if schedule is None:
            return _safe_denial(request)
        # The schedule rides in the context so the serializer checks the
        # effective range against the merged (payload + existing) values.
        serializer = WorkScheduleWriteSerializer(data=request.data, context={"schedule": schedule})
        serializer.is_valid(raise_exception=True)
        schedule = work_schedule_service.update_schedule(
            schedule=schedule, validated_data=serializer.validated_data
        )
        return Response({"data": WorkScheduleReadSerializer(schedule).data})

    def delete(self, request, schedule_id):
        schedule = self._resolve(schedule_id)
        if schedule is None:
            return _safe_denial(request)
        schedule = work_schedule_service.deactivate_schedule(schedule=schedule)
        return Response({"data": WorkScheduleReadSerializer(schedule).data})
