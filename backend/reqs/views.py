"""Request draft endpoints (Story 2.1): requester-scoped create/list/detail/patch."""
from django.http import Http404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.throttles import MutationRateThrottle
from config.api import RequestPagination
from reqs import serializers as rs
from reqs.models import EmployeeRequest
from reqs.services import create_draft, edit_draft


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
