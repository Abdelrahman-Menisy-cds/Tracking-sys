"""Request draft endpoints (Story 2.1): requester-scoped create/list/detail/patch."""
from django.http import Http404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.throttles import MutationRateThrottle
from config.api import RequestPagination, error_payload
from reqs import serializers as rs
from reqs import attachment_views  # re-exported for reqs.urls (Story 2.2)
from reqs.models import EmployeeRequest, SubmissionIdempotencyRecord
from reqs.services import create_draft, edit_draft
from reqs.submission_services import (
    SubmissionError,
    VersionConflict,
    idempotency_fingerprint,
    record_idempotency,
    submit_request,
)


def _get_own_request(user, pk):
    """Raise the same 404 for a missing request as for another user's request."""
    try:
        return EmployeeRequest.objects.get(pk=pk, requester=user)
    except (EmployeeRequest.DoesNotExist, ValueError):
        raise Http404


class RequestListView(APIView):
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request):
        paginator = RequestPagination()
        page = paginator.paginate_queryset(
            EmployeeRequest.objects.filter(requester=request.user),
            request,
            view=self,
        )
        return paginator.get_paginated_response(rs.EmployeeRequestSerializer(page, many=True).data)

    def post(self, request):
        serializer = rs.DraftCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        draft = create_draft(
            requester=request.user,
            request_type=serializer.validated_data["request_type_id"],
            title=serializer.validated_data["title"],
            details=serializer.validated_data["details"],
        )
        return Response({"data": rs.EmployeeRequestSerializer(draft).data}, status=status.HTTP_201_CREATED)


class RequestDetailView(APIView):
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request, pk):
        instance = _get_own_request(request.user, pk)
        return Response({"data": rs.EmployeeRequestSerializer(instance).data})

    def patch(self, request, pk):
        instance = _get_own_request(request.user, pk)
        if instance.status not in (EmployeeRequest.Status.DRAFT, EmployeeRequest.Status.RETURNED):
            return Response(
                {
                    "error": {
                        "code": "state_conflict",
                        "message": "This request is read-only in its current state.",
                        "fields": {"status": ["Editing is only allowed for drafts and returned requests."]},
                        "request_id": request.request_id,
                    }
                },
                status=status.HTTP_409_CONFLICT,
            )
        serializer = rs.DraftEditSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        new = edit_draft(
            request=instance,
            editor=request.user,
            title=serializer.validated_data.get("title", instance.title),
            details=serializer.validated_data.get("details", instance.details),
        )
        return Response({"data": rs.EmployeeRequestSerializer(new).data})


class RequestSubmitView(APIView):
    """POST /api/v1/requests/{id}/submit (Story 2.3).

    Requester-only, DRAFT/RETURNED-only, idempotent via Idempotency-Key,
    server-derived routing. Notifications are Epic 4 scope.
    """

    throttle_classes = [MutationRateThrottle]

    def post(self, request, pk):
        request_obj = _get_own_request(request.user, pk)

        idempotency_key = request.headers.get("Idempotency-Key", "").strip()
        if not idempotency_key:
            return Response(
                error_payload(
                    code="idempotency_key_required",
                    message="An Idempotency-Key header is required to submit a request.",
                    fields={"idempotency_key": ["Missing Idempotency-Key header."]},
                    request=request,
                ),
                status=422,
            )

        serializer = rs.SubmitRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        expected_version = serializer.validated_data["version"]

        key_hash, payload_hash = idempotency_fingerprint(
            key=idempotency_key, request_id=request_obj.pk, version=expected_version
        )
        existing = SubmissionIdempotencyRecord.objects.filter(key_hash=key_hash).first()
        if existing is not None:
            if existing.payload_hash == payload_hash:
                return Response(existing.response_snapshot, status=status.HTTP_200_OK)
            return Response(
                error_payload(
                    code="idempotency_conflict",
                    message="This idempotency key was already used with a different payload.",
                    fields={"idempotency_key": ["Key reused with different payload."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )

        try:
            submitted = submit_request(
                requester=request.user,
                request_obj=request_obj,
                version=expected_version,
            )
        except SubmissionError as exc:
            field_errors = [exc.message]
            if exc.detail:
                # e.g. attachment ids that failed the clean-scan requirement.
                field_errors.extend(exc.detail.split(","))
            return Response(
                error_payload(
                    code=exc.code,
                    message=exc.message,
                    fields={exc.field: field_errors},
                    request=request,
                ),
                status=422,
            )
        except VersionConflict:
            return Response(
                error_payload(
                    code="version_conflict",
                    message="This request changed since you last saw it. Reload and try again.",
                    fields={"version": ["The provided version is stale."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except PermissionError:
            return Response(
                error_payload(
                    code="state_conflict",
                    message="Only drafts and returned requests can be submitted.",
                    fields={"status": ["Submitting requires the DRAFT or RETURNED state."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )

        body = {"data": rs.EmployeeRequestSerializer(submitted).data}
        record_idempotency(
            user=request.user,
            key_hash=key_hash,
            payload_hash=payload_hash,
            snapshot=body,
        )
        return Response(body, status=status.HTTP_200_OK)
