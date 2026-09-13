"""Story 4.3: bounded CSV report endpoints (manager/HR, read-only).

Every output resolves its rows through review.reports.resolve_report —
the ONE server-derived scope+filter source — so rows, totals, dashboard,
and CSV are guaranteed to agree. Scope is applied BEFORE filtering,
counting, serialization, and export.

Endpoints (all GET, /api/v1/reports/…):
- GET /reports/{category}/rows       -> JSON rows + meta
- GET /reports/{category}/totals     -> totals + meta
- GET /reports/{category}/dashboard  -> dashboard values + meta
- GET /reports/{category}/csv        -> UTF-8 CSV download initiation
                                       (5/hour/user throttle, audit event,
                                       10,000-row hard bound, no partial)

Errors: unauthenticated 401; non-manager/HR 403 (ScopeDenied); invalid
filters 422 (ReportFilterError); CSV with >10,000 rows 422 row_limit, no
bytes delivered; over rate limit 429. The export audits BEFORE any body is
sent and failures never leave partial output (no disk save is performed or
claimed; the response is download initiation only).
"""
from django.http import HttpResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import AuditEvent
from config.api import error_payload
from review import reports as report_source
from review.serializers import report_rows_for
from review.csv_export import (
    REQUEST_ROWS_HEADER,
    TIMESHEET_ROWS_HEADER,
    build_csv,
    request_row_out,
    timesheet_row_out,
)
from review.throttles import ExportRateThrottle
from review.views import BaseReviewView

CATEGORIES = report_source.ALLOWED_CATEGORIES


def _parse_category(category):
    if category not in CATEGORIES:
        from django.http import Http404

        raise Http404("Unknown report category.")
    return category


def _error(request, code, message, fields, status_code):
    return Response(
        error_payload(code=code, message=message, fields=fields, request=request),
        status=status_code,
    )


class ReportRowsView(BaseReviewView):
    """GET /api/v1/reports/{category}/rows — bounded, but JSON rows cap at 10k."""

    def get(self, request, category):
        category = _parse_category(category)
        try:
            queryset, meta = report_source.resolve_report(category, request.user, request.query_params)
        except report_source.ScopeDenied:
            return _error(request, "permission_denied", "Reports are available to managers and HR only.", {}, status.HTTP_403_FORBIDDEN)
        except report_source.ReportFilterError as exc:
            return _error(request, "validation_error", "Invalid report filters.", {"non_field_errors": exc.errors}, status.HTTP_422_UNPROCESSABLE_ENTITY)
        if meta["row_count"] > report_source.MAX_REPORT_ROWS:
            queryset = queryset[: report_source.MAX_REPORT_ROWS]
            meta["row_count"] = report_source.MAX_REPORT_ROWS
            meta["truncated"] = True
        rows = report_rows_for(category, queryset)
        return Response({"data": rows, "meta": meta})


class ReportTotalsView(BaseReviewView):
    """GET /api/v1/reports/{category}/totals."""

    def get(self, request, category):
        category = _parse_category(category)
        try:
            queryset, meta = report_source.resolve_report(category, request.user, request.query_params)
        except report_source.ScopeDenied:
            return _error(request, "permission_denied", "Reports are available to managers and HR only.", {}, status.HTTP_403_FORBIDDEN)
        except report_source.ReportFilterError as exc:
            return _error(request, "validation_error", "Invalid report filters.", {"non_field_errors": exc.errors}, status.HTTP_422_UNPROCESSABLE_ENTITY)
        meta["totals"] = report_source.totals_for(category, queryset)
        return Response({"data": meta["totals"], "meta": meta})


class ReportDashboardView(BaseReviewView):
    """GET /api/v1/reports/{category}/dashboard."""

    def get(self, request, category):
        category = _parse_category(category)
        try:
            queryset, meta = report_source.resolve_report(category, request.user, request.query_params)
        except report_source.ScopeDenied:
            return _error(request, "permission_denied", "Reports are available to managers and HR only.", {}, status.HTTP_403_FORBIDDEN)
        except report_source.ReportFilterError as exc:
            return _error(request, "validation_error", "Invalid report filters.", {"non_field_errors": exc.errors}, status.HTTP_422_UNPROCESSABLE_ENTITY)
        data = report_source.dashboard_for(category, queryset)
        return Response({"data": data, "meta": meta})


class ReportCsvView(APIView):
    """GET /api/v1/reports/{category}/csv — audited, throttled, bounded export.

    Throttled 5/hour/user. On ANY rejection (limit, scope, filters) NO
    partial bytes are sent: the response is a JSON error envelope only.
    """

    throttle_classes = [ExportRateThrottle]

    def get(self, request, category):
        category = _parse_category(category)
        try:
            filtered, meta = report_source.resolve_report(category, request.user, request.query_params)
        except report_source.ScopeDenied:
            return _error(request, "permission_denied", "Reports are available to managers and HR only.", {}, status.HTTP_403_FORBIDDEN)
        except report_source.ReportFilterError as exc:
            return _error(request, "validation_error", "Invalid report filters.", {"non_field_errors": exc.errors}, status.HTTP_422_UNPROCESSABLE_ENTITY)
        if meta["row_count"] > report_source.MAX_REPORT_ROWS:
            return _error(
                request,
                "row_limit_exceeded",
                f"Report exceeds the {report_source.MAX_REPORT_ROWS}-row export limit; narrow the filters.",
                {"non_field_errors": [f"row_count={meta['row_count']} exceeds {report_source.MAX_REPORT_ROWS}."]},
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        from django.utils import timezone

        meta["generated_at_utc"] = timezone.now().isoformat()
        if category == "requests":
            header = REQUEST_ROWS_HEADER
            rows = [request_row_out(meta, obj) for obj in filtered]
        else:
            header = TIMESHEET_ROWS_HEADER
            rows = [timesheet_row_out(meta, obj) for obj in filtered]
        csv_text = build_csv(meta, header, rows)

        transactional_audit = AuditEvent.objects.create(
            actor=request.user,
            subject=request.user,
            action=f"REPORT_EXPORT_{category.upper()}",
            request_id=getattr(request, "request_id", ""),
            after={
                "report": category,
                "scope": meta["scope"],
                "filters": meta["filters_applied"],
                "row_count": meta["row_count"],
                "row_limit": meta["row_limit"],
                "org_timezone": meta["org_timezone"],
            },
        )

        response = HttpResponse(content_type="text/csv; charset=utf-8")
        filename = f"{category}_report_{meta['generated_at_utc'][:10]}.csv"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["X-Audit-Event-Id"] = str(transactional_audit.pk)
        # The CSV bytes are written straight into the response (download
        # initiation). No file is saved to disk and no partial payload is
        # ever produced on any rejection path.
        response.write(csv_text)
        return response
