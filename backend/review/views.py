"""Review queues and read-only details (Story 4.1).

GET endpoints only: never mutate, never throttle. The scope queryset is
resolved FIRST, then filters, then count, then pagination, then
serialization — an out-of-scope or nonexistent id is therefore the same
safe 404 (scope via .filter(pk=pk) on the scoped queryset, .first()).
"""
from django.http import Http404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from config.api import error_payload
from review import scope as review_scope
from review import serializers as rv
from review.scope_helpers import apply_request_queue_filters, apply_timesheet_queue_filters


class ReviewQueuePagination:
    """Contract pagination: page/page_size, default 25, max 100, same envelope."""

    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100

    def paginate(self, queryset, request):
        from rest_framework.pagination import PageNumberPagination

        paginator = PageNumberPagination()
        paginator.page_size = self.page_size
        paginator.page_size_query_param = self.page_size_query_param
        paginator.max_page_size = self.max_page_size
        page = paginator.paginate_queryset(queryset, request, view=None)
        return page, paginator

    @staticmethod
    def response(paginator, data):
        from rest_framework.response import Response as DRFResponse

        return DRFResponse(
            {
                "data": data,
                "meta": {
                    "page": paginator.page.number,
                    "page_size": paginator.get_page_size(paginator.request),
                    "count": paginator.page.paginator.count,
                    "total_pages": paginator.page.paginator.num_pages,
                },
            }
        )


class BaseReviewView(APIView):
    """Auth-only base (default IsAuthenticated401); GET = no throttle/mutation."""

    throttle_classes = []  # GET endpoints: no mutation, no throttle per contract

    def get_serializer_context(self):
        return {"viewer": self.request.user, "request": self.request}


class RequestQueueView(BaseReviewView):
    """GET /api/v1/review/requests/queue — scoped, filtered, deterministic."""

    def get(self, request):
        scoped = review_scope.scope_requests(request.user)
        filtered, _cleaned, errors = apply_request_queue_filters(scoped, request.query_params)
        if errors:
            return Response(
                error_payload(
                    code="validation_error",
                    message="Invalid queue filters.",
                    fields={"non_field_errors": errors},
                    request=request,
                ),
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        page, paginator = ReviewQueuePagination().paginate(filtered, request)
        data = rv.ReviewRequestSummarySerializer(page, many=True, context=self.get_serializer_context()).data
        return ReviewQueuePagination.response(paginator, data)


class RequestReviewDetailView(BaseReviewView):
    """GET /api/v1/review/requests/{id} — scoped read-only detail, safe 404."""

    def get(self, request, pk):
        scoped = review_scope.scope_requests(request.user)
        try:
            instance = scoped.filter(pk=pk).first()
        except ValueError:
            instance = None
        if instance is None:
            raise Http404
        data = rv.ReviewRequestSerializer(instance, context=self.get_serializer_context()).data
        return Response({"data": data})


class TimesheetQueueView(BaseReviewView):
    """GET /api/v1/review/timesheets/queue — scoped, filtered, deterministic."""

    def get(self, request):
        scoped = review_scope.scope_timesheets(request.user)
        filtered, _cleaned, errors = apply_timesheet_queue_filters(scoped, request.query_params)
        if errors:
            return Response(
                error_payload(
                    code="validation_error",
                    message="Invalid queue filters.",
                    fields={"non_field_errors": errors},
                    request=request,
                ),
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        page, paginator = ReviewQueuePagination().paginate(filtered, request)
        data = rv.ReviewTimesheetSummarySerializer(page, many=True, context=self.get_serializer_context()).data
        return ReviewQueuePagination.response(paginator, data)


class TimesheetReviewDetailView(BaseReviewView):
    """GET /api/v1/review/timesheets/{id} — scoped read-only detail, safe 404."""

    def get(self, request, pk):
        scoped = review_scope.scope_timesheets(request.user)
        try:
            instance = scoped.filter(pk=pk).first()
        except ValueError:
            instance = None
        if instance is None:
            raise Http404
        data = rv.ReviewTimesheetSerializer(instance, context=self.get_serializer_context()).data
        return Response({"data": data})
