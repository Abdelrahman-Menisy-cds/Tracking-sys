from uuid import uuid4

from django.utils.translation import gettext as _
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


class RequestIDMiddleware:
    """Attach an identifier to every response for support and audit correlation."""

    header_name = "HTTP_X_REQUEST_ID"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = request.META.get(self.header_name) or uuid4().hex
        response = self.get_response(request)
        response["X-Request-ID"] = request.request_id
        return response


class NotificationPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 20

    def get_paginated_response(self, serialized_notifications):
        return Response(
            {
                "data": serialized_notifications,
                "meta": {
                    "page": self.page.number,
                    "page_size": self.get_page_size(self.request),
                    "count": self.page.paginator.count,
                    "total_pages": self.page.paginator.num_pages,
                },
            }
        )


def error_payload(*, code, message, fields, request):
    return {
        "error": {
            "code": code,
            "message": message,
            "fields": fields,
            "request_id": request.request_id,
        }
    }


def api_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return response

    status_errors = {
        401: ("authentication_failed", _("Authentication credentials were not provided.")),
        403: ("permission_denied", _("You do not have permission to perform this action.")),
        404: ("not_found", _("Not found.")),
        429: ("throttled", _("Request was throttled.")),
    }
    code, message = status_errors.get(
        response.status_code,
        ("validation_error", _("Validation failed.")),
    )
    fields = response.data if response.status_code == 400 and isinstance(response.data, dict) else {}
    response.data = error_payload(code=code, message=message, fields=fields, request=context["request"])
    return response
