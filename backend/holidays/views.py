"""Holidays endpoints (Stage H1).

GET  /api/v1/holidays?year=<int>&country=<ISO2> — the register for a year.
POST /api/v1/holidays/refresh — run refresh_public_holidays and return the
summary. HR-only (canManageHolidays capability); the IsHR permission class
gives a non-HR authenticated caller the same 404 envelope as an unknown
resource (no existence disclosure, permission-matrix 404 policy).
"""
from datetime import date

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAuthenticated401, IsHR
from accounts.throttles import MutationRateThrottle
from config.api import error_payload
from holidays import serializers as hs
from holidays.models import PublicHoliday
from holidays.services import NagerUnavailableError, refresh_public_holidays

DEFAULT_COUNTRY = "EG"
MIN_YEAR = 1974  # Nager.Date coverage begins here
MAX_YEAR = 2100


def _invalid_param(request, field, message):
    return Response(
        error_payload(
            code="validation_error",
            message="Validation failed.",
            fields={field: [message]},
            request=request,
        ),
        status=status.HTTP_422_UNPROCESSABLE_ENTITY,
    )


def _parse_year(raw):
    try:
        year = int(str(raw).strip())
    except (TypeError, ValueError):
        return None
    return year if MIN_YEAR <= year <= MAX_YEAR else None


class HolidayListView(APIView):
    """GET /api/v1/holidays?year=&country= — the public-holidays register."""

    permission_classes = [IsAuthenticated401, IsHR]
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request):
        raw_year = request.query_params.get("year")
        raw_country = request.query_params.get("country") or DEFAULT_COUNTRY
        year = date.today().year if (raw_year is None or raw_year.strip() == "") else _parse_year(raw_year)
        if year is None:
            return _invalid_param(
                request, "year", f"year must be an integer between {MIN_YEAR} and {MAX_YEAR}."
            )
        country = raw_country.strip().upper()
        if len(country) != 2 or not country.isalpha():
            return _invalid_param(
                request, "country", "country must be a 2-letter ISO 3166-1 alpha-2 code."
            )
        rows = PublicHoliday.objects.filter(
            company=request.user.company, country_code=country, year=year
        ).order_by("date", "name")
        return Response({"data": hs.PublicHolidaySerializer(rows, many=True).data})


class HolidayRefreshView(APIView):
    """POST /api/v1/holidays/refresh — HR-only, idempotent by natural key.

    A double-click re-runs the upsert and re-derives the same rows (the
    second run adds nothing). Nager failure maps to 503 upstream_unavailable
    with zero rows written; LLM failure never fails the request (the summary
    says so instead).
    """

    permission_classes = [IsAuthenticated401, IsHR]
    throttle_classes = [MutationRateThrottle]

    def post(self, request):
        serializer = hs.HolidayRefreshRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        year = serializer.validated_data.get("year") or date.today().year
        country = serializer.validated_data.get("country") or DEFAULT_COUNTRY
        try:
            summary = refresh_public_holidays(year, country, company=request.user.company)
        except NagerUnavailableError as exc:
            return Response(
                error_payload(
                    code="upstream_unavailable",
                    message=(
                        "The public-holidays provider (Nager.Date) is unreachable; "
                        "nothing was changed."
                    ),
                    fields={"upstream": [str(exc)]},
                    request=request,
                ),
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response({"data": summary}, status=status.HTTP_200_OK)
