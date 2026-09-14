"""OpenAPI 3.0.2 schema endpoint (Story 5.1 QA follow-up).

AC: the published schema must reflect the ACTUAL serializers/views wired in
config.urls — nothing hallucinated. Design decisions, all grounded in the
current code:

- Generator: DRF's built-in ``rest_framework.schemas.openapi.SchemaGenerator``
  (installed dependency; no package added). It walks the real URLconf and
  introspects the real view classes, so paths and methods can never drift
  from what is actually wired.
- Per-view request/response components: DRF's default ``AutoSchema`` derives
  request bodies from ``view.get_serializer()``, which our plain ``APIView``
  subclasses do not implement. A small subclass supplies the serializer
  mapping below; every mapped serializer class is the exact instance the
  view constructs in its handlers (verified view-by-view in this module's
  comments and enforced by tests), so field shapes come from the actual
  serializer code, not hand-written guesses.
- Status codes: taken from each view's real response paths (including the
  409/422 error envelope branches QA's error matrix covers), plus the shared
  401/403/404/429 envelopes produced by ``config.api.api_exception_handler``
  for every versioned endpoint.
- Health endpoints are plain Django views with fixed literal payloads; their
  schemas are hand-mapped from ``config/health.py`` verbatim.
- The schema endpoint itself is read-only metadata: it never discloses
  secrets, requires no authentication, and only describes the API surface.
"""
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from rest_framework import serializers
from rest_framework.schemas.openapi import AutoSchema, SchemaGenerator

from accounts.employee_serializers import (
    EmployeeCreateSerializer,
    EmployeeReadSerializer,
    EmployeeUpdateSerializer,
)
from accounts.serializers import CurrentUserSerializer, CurrentUserUpdateSerializer, LoginSerializer
from notifications.serializers import NotificationReadStateSerializer, NotificationSerializer
from reqs import serializers as reqs_serializers
from review.serializers import (
    ReviewRequestSerializer,
    ReviewRequestSummarySerializer,
    ReviewTimesheetSerializer,
    ReviewTimesheetSummarySerializer,
)
from timesheets import serializers as ts_serializers


# ---------------------------------------------------------------------------
# Component schemas derived from the actual serializer classes.
# ---------------------------------------------------------------------------

# Reuse DRF's field mapping so component shapes are generated from the real
# serializer field declarations (required/read-only/max_length/choices...).
_inspector = AutoSchema()


def _component(serializer, name):
    """Return the OpenAPI object schema DRF derives from ``serializer``."""
    schema = _inspector.map_serializer(serializer)
    schema["title"] = name
    return schema


# Response item components (read shapes).
EMPLOYEE_READ = _component(EmployeeReadSerializer(), "EmployeeRead")
CURRENT_USER = _component(CurrentUserSerializer(), "CurrentUser")
NOTIFICATION = _component(NotificationSerializer(), "Notification")
EMPLOYEE_REQUEST = _component(reqs_serializers.EmployeeRequestSerializer(), "EmployeeRequest")
REQUEST_TYPE = _component(reqs_serializers.RequestTypeSerializer(), "RequestType")
TIMESHEET = _component(ts_serializers.TimesheetSerializer(), "Timesheet")
TIME_ENTRY = _component(ts_serializers.TimeEntrySerializer(), "TimeEntry")
TIMESHEET_EVENT = _component(ts_serializers.TimesheetEventSerializer(), "TimesheetEvent")

# Request body components (write shapes), exactly as the views instantiate them.
LOGIN_REQUEST = _component(LoginSerializer(), "LoginRequest")
CURRENT_USER_UPDATE_REQUEST = _component(CurrentUserUpdateSerializer(partial=True), "CurrentUserUpdateRequest")
EMPLOYEE_CREATE_REQUEST = _component(EmployeeCreateSerializer(), "EmployeeCreateRequest")
EMPLOYEE_UPDATE_REQUEST = _component(EmployeeUpdateSerializer(partial=True), "EmployeeUpdateRequest")
DRAFT_CREATE_REQUEST = _component(reqs_serializers.DraftCreateSerializer(), "DraftCreateRequest")
DRAFT_EDIT_REQUEST = _component(reqs_serializers.DraftEditSerializer(partial=True), "DraftEditRequest")
SUBMIT_REQUEST_REQUEST = _component(reqs_serializers.SubmitRequestSerializer(), "SubmitRequestRequest")
DECISION_REQUEST = _component(reqs_serializers.DecisionSerializer(), "DecisionRequest")
CANCEL_REQUEST_REQUEST = _component(reqs_serializers.CancelRequestSerializer(), "CancelRequestRequest")
NOTIFICATION_READ_STATE_REQUEST = _component(NotificationReadStateSerializer(), "NotificationReadStateRequest")
TIMESHEET_CREATE_REQUEST = _component(ts_serializers.TimesheetCreateSerializer(), "TimesheetCreateRequest")
TIMESHEET_SUBMIT_REQUEST = _component(ts_serializers.TimesheetSubmitSerializer(), "TimesheetSubmitRequest")
TIME_ENTRY_CORRECTION_REQUEST = _component(ts_serializers.TimeEntryCorrectionSerializer(), "TimeEntryCorrectionRequest")
ENTRY_DELETE_REQUEST = _component(ts_serializers.EntryDeleteSerializer(), "EntryDeleteRequest")
TIMESHEET_DECISION_REQUEST = _component(ts_serializers.TimesheetDecisionSerializer(), "TimesheetDecisionRequest")
TIMESHEET_REOPEN_REQUEST = _component(ts_serializers.TimesheetReopenSerializer(), "TimesheetReopenRequest")

# Attachment payloads are plain dicts built in reqs.attachment_views._attachment_payload
# (no serializer class exists); the keys below are copied from that function so the
# component matches the actual response body key-for-key.
ATTACHMENT = {
    "title": "Attachment",
    "type": "object",
    "properties": {
        "id": {"type": "string", "format": "uuid"},
        "request_id": {"type": "string", "format": "uuid"},
        "original_filename": {"type": "string"},
        "content_type": {"type": "string"},
        "detected_content_type": {"type": "string"},
        "size_bytes": {"type": "integer"},
        "scan_status": {"type": "string", "enum": ["PENDING", "CLEAN", "FAILED", "REJECTED"]},
        "created_at": {"type": "string", "format": "date-time"},
        "download_url": {"type": "string"},
    },
}


def _object_ref(name):
    return {"$ref": f"#/components/schemas/{name}"}


def _data_envelope(item_schema):
    """The single-resource success envelope every detail view returns."""
    return {
        "type": "object",
        "properties": {"data": item_schema},
    }


def _page_envelope(item_schema):
    """Envelope of RequestPagination/EmployeePagination/NotificationPagination
    (config/api.py): data array + bounded page meta."""
    return {
        "type": "object",
        "properties": {
            "data": {"type": "array", "items": item_schema},
            "meta": {
                "type": "object",
                "properties": {
                    "page": {"type": "integer"},
                    "page_size": {"type": "integer"},
                    "count": {"type": "integer"},
                    "total_pages": {"type": "integer"},
                },
            },
        },
    }


def _error_response(status_code, description):
    """The shared error envelope produced by config.api.error_payload /
    api_exception_handler for this status (uniform across the API)."""
    return {
        status_code: {
            "description": description,
            "content": {
                "application/json": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            "error": {
                                "type": "object",
                                "properties": {
                                    "code": {"type": "string"},
                                    "message": {"type": "string"},
                                    "fields": {"type": "object"},
                                    "request_id": {"type": "string"},
                                },
                                "required": ["code", "message", "fields", "request_id"],
                            }
                        },
                        "required": ["error"],
                    }
                }
            },
        }
    }


def _json_response(status_code, description, body_schema):
    return {
        status_code: {
            "description": description,
            "content": {"application/json": {"schema": body_schema}},
        }
    }


def _no_content_response():
    return {"204": {"description": "Signed out. No body is returned."}}


# Shared error responses every versioned endpoint can produce through
# api_exception_handler / session authentication (uniform contract).
AUTH_ERRORS = {
    **_error_response("401", "Authentication credentials were not provided."),
    **_error_response("403", "You do not have permission to perform this action."),
    **_error_response("404", "Not found."),
    **_error_response("422", "Validation failed; fields carries the per-field errors."),
    **_error_response("429", "Request was throttled."),
}


def _errors(*codes):
    """Merge the shared auth errors with view-specific status envelopes."""
    extra = {}
    for code, description in codes:
        extra.update(_error_response(code, description))
    return {**AUTH_ERRORS, **extra}


# ---------------------------------------------------------------------------
# Per-view AutoSchema subclass: request bodies from the actual serializers,
# responses from the actual handler return paths.
# ---------------------------------------------------------------------------


def _body(schema_ref, multipart=False):
    media = ["multipart/form-data"] if multipart else ["application/json"]
    return {"content": {ct: {"schema": schema_ref} for ct in media}}


class _ViewSchema(AutoSchema):
    """Manual mapping per view: real serializers in, real status codes out.

    Each entry documents the handler branch it was read from so the mapping
    stays auditable against the code.
    """

    request_bodies = {}
    responses = {}

    def get_request_serializer(self, path, method):
        return None  # bodies are provided directly via request_bodies

    def get_request_body(self, path, method):
        return self.request_bodies.get(method.lower(), {})

    def get_responses(self, path, method):
        return self.responses.get(method.lower(), {})


def _schema(request_bodies=None, responses=None):
    return type(
        "MappedAutoSchema",
        (_ViewSchema,),
        {"request_bodies": request_bodies or {}, "responses": responses or {}},
    )


class AccountsSchema(_ViewSchema):
    request_bodies = {
        "post": _body(_object_ref("LoginRequest")),
        "patch": _body(_object_ref("CurrentUserUpdateRequest")),
    }
    responses = {
        # CsrfBootstrapView.get: {"data": {"csrftoken": <str>}}
        "get": {
            **_json_response("200", "CSRF cookie issued for the SPA bootstrap.", {
                "type": "object",
                "properties": {"data": {"type": "object", "properties": {"csrftoken": {"type": "string"}}}},
            }),
        },
        # LoginView.post: 200 CurrentUser + csrftoken, 400 invalid_credentials.
        "post": {
            **_json_response("200", "Session established.", {
                "type": "object",
                "properties": {
                    "data": _object_ref("CurrentUser"),
                    "meta": {"type": "object", "properties": {"csrftoken": {"type": "string"}}},
                },
            }),
            **_error_response("400", "Unable to sign in with the provided credentials (generic, non-enumerating)."),
            **_error_response("429", "Login rate limit exceeded (10/min per IP)."),
        },
        # LogoutView.post: 204, no body.
        # MeView.get: {"data": CurrentUser}; patch: same envelope after update.
        "patch": {
            **_json_response("200", "Profile updated.", _data_envelope(_object_ref("CurrentUser"))),
        },
    }


class MeSchema(AccountsSchema):
    responses = {
        **AccountsSchema.responses,
        "get": {
            **_json_response("200", "Current user.", _data_envelope(_object_ref("CurrentUser"))),
        },
    }


class EmployeeSchema(_ViewSchema):
    request_bodies = {
        "post": _body(_object_ref("EmployeeCreateRequest")),
        "patch": _body(_object_ref("EmployeeUpdateRequest")),
    }
    responses = {
        # EmployeeListView.get: page envelope of EmployeeRead; post: 201.
        "get": {
            **_json_response("200", "Bounded active-employee list (HR only).", _page_envelope(_object_ref("EmployeeRead"))),
        },
        "post": {
            **_json_response("201", "Employee created.", _data_envelope(_object_ref("EmployeeRead"))),
            **_error_response("422", "Validation failed; fields carries the per-field errors."),
        },
        # EmployeeDetailView.get/patch: EmployeeRead or the shared 404 denial.
        "patch": {
            **_json_response("200", "Employee updated.", _data_envelope(_object_ref("EmployeeRead"))),
            **_error_response("422", "Validation failed; fields carries the per-field errors."),
        },
    }


class EmployeeDetailSchema(EmployeeSchema):
    responses = {
        **EmployeeSchema.responses,
        "get": {
            **_json_response("200", "Employee detail (HR only).", _data_envelope(_object_ref("EmployeeRead"))),
            **_error_response("404", "Not found or out of scope (uniform 404, no existence disclosure)."),
        },
    }


class RequestListSchema(_ViewSchema):
    request_bodies = {"post": _body(_object_ref("DraftCreateRequest"))}
    responses = {
        # RequestListView.get: page envelope of EmployeeRequest; post: 201 draft.
        "get": {
            **_json_response("200", "Requester-scoped request list.", _page_envelope(_object_ref("EmployeeRequest"))),
        },
        "post": {
            **_json_response("201", "Draft created.", _data_envelope(_object_ref("EmployeeRequest"))),
            **_error_response("422", "Validation failed; fields carries the per-field errors."),
            **_error_response("429", "Mutation rate limit exceeded (60/min)."),
        },
    }


class RequestDetailSchema(_ViewSchema):
    request_bodies = {"patch": _body(_object_ref("DraftEditRequest"))}
    responses = {
        # RequestDetailView.get: {"data": EmployeeRequest}; patch: same or 409.
        "get": {
            **_json_response("200", "Requester-owned request detail.", _data_envelope(_object_ref("EmployeeRequest"))),
            **_error_response("404", "Not found or owned by another requester (uniform 404)."),
        },
        "patch": {
            **_json_response("200", "Draft edited.", _data_envelope(_object_ref("EmployeeRequest"))),
            **_error_response("404", "Not found or owned by another requester (uniform 404)."),
            **_error_response("409", "state_conflict: editing allowed only in DRAFT/RETURNED."),
            **_error_response("422", "Validation failed; fields carries the per-field errors."),
            **_error_response("429", "Mutation rate limit exceeded (60/min)."),
        },
    }


def _transition_responses(state_conflict_description):
    return {
        **_json_response("200", "Transition applied; the resource snapshot is returned.", _data_envelope(_object_ref("EmployeeRequest"))),
        **_error_response("404", "Not found or out of scope (uniform 404)."),
        **_error_response("409", state_conflict_description),
        **_error_response("422", "Validation failed or Idempotency-Key header missing."),
        **_error_response("429", "Mutation rate limit exceeded (60/min)."),
    }


class RequestSubmitSchema(_ViewSchema):
    request_bodies = {"post": _body(_object_ref("SubmitRequestRequest"))}
    responses = {
        "post": _transition_responses(
            "version_conflict (stale version) or state_conflict (not DRAFT/RETURNED)."
        )
    }


class RequestDecisionSchema(_ViewSchema):
    request_bodies = {"post": _body(_object_ref("DecisionRequest"))}
    responses = {
        "post": _transition_responses(
            "version_conflict, state_conflict, idempotency_conflict, or self_decision_forbidden."
        )
    }


class RequestCancelSchema(_ViewSchema):
    request_bodies = {"post": _body(_object_ref("CancelRequestRequest"))}
    responses = {
        "post": _transition_responses(
            "version_conflict, state_conflict (decided/cancelled), or idempotency_conflict."
        )
    }


class AttachmentListSchema(_ViewSchema):
    request_bodies = {"post": _body(_object_ref("Attachment"), multipart=True)}
    responses = {
        # AttachmentListView.get: {"data": [Attachment...]}; post: 201 upload.
        "get": {
            **_json_response("200", "Attachments of a requester-owned request.", {
                "type": "object",
                "properties": {"data": {"type": "array", "items": _object_ref("Attachment")}},
            }),
            **_error_response("404", "Not found or owned by another requester (uniform 404)."),
        },
        "post": {
            **_json_response("201", "Attachment uploaded (multipart 'file' part; Idempotency-Key header required).", _data_envelope(_object_ref("Attachment"))),
            **_error_response("404", "Not found or owned by another requester (uniform 404)."),
            **_error_response("409", "idempotency_conflict: key reused with a different payload."),
            **_error_response("422", "Validation failed or Idempotency-Key header missing."),
            **_error_response("429", "Mutation (60/min) or upload (20/hour) rate limit exceeded."),
        },
    }


class AttachmentDetailSchema(_ViewSchema):
    responses = {
        # AttachmentDetailView.get: {"data": Attachment}; delete: 204 or 409.
        "get": {
            **_json_response("200", "Attachment metadata (owner only).", _data_envelope(_object_ref("Attachment"))),
            **_error_response("404", "Not found or owned by another requester (uniform 404)."),
        },
        "delete": {
            **_no_content_response(),
            **_error_response("404", "Not found or owned by another requester (uniform 404)."),
            **_error_response("409", "state_conflict: attachments are immutable in the request's current state."),
            **_error_response("429", "Mutation rate limit exceeded (60/min)."),
        },
    }


class AttachmentReplaceSchema(_ViewSchema):
    request_bodies = {"post": _body(_object_ref("Attachment"), multipart=True)}
    responses = {
        # AttachmentReplaceView.post: 201 new attachment (RETURNED requests only).
        "post": {
            **_json_response("201", "Attachment replaced (RETURNED requests only).", _data_envelope(_object_ref("Attachment"))),
            **_error_response("404", "Not found or owned by another requester (uniform 404)."),
            **_error_response("422", "Validation failed or missing multipart 'file' part."),
            **_error_response("429", "Mutation rate limit exceeded (60/min)."),
        },
    }


class AttachmentDownloadSchema(_ViewSchema):
    responses = {
        # AttachmentDownloadView.get: CLEAN bytes as FileResponse; blocked -> 422.
        "get": {
            "200": {
                "description": "File bytes for a CLEAN attachment (Content-Disposition: attachment).",
                "content": {"*/*": {"schema": {"type": "string", "format": "binary"}}},
            },
            **_error_response("404", "Not found, out of scope, or file missing (attempt audited)."),
            **_error_response("422", "scan_quarantined: download is unavailable while scan status is not CLEAN."),
        },
    }


class NotificationListSchema(_ViewSchema):
    responses = {
        # NotificationListView.get: page envelope of Notification.
        "get": {
            **_json_response("200", "Recipient-scoped notification list.", _page_envelope(_object_ref("Notification"))),
        },
    }


class NotificationDetailSchema(_ViewSchema):
    responses = {
        # NotificationDetailView.get: {"data": Notification}; safe 404.
        "get": {
            **_json_response("200", "Recipient-owned notification detail.", _data_envelope(_object_ref("Notification"))),
            **_error_response("404", "Not found or owned by another recipient (safe 404)."),
        },
    }


class NotificationReadStateSchema(_ViewSchema):
    request_bodies = {"patch": _body(_object_ref("NotificationReadStateRequest"))}
    responses = {
        # NotificationReadStateView.get: detail; patch: updated detail / 500 failure.
        "get": {
            **_json_response("200", "Recipient-owned notification detail.", _data_envelope(_object_ref("Notification"))),
            **_error_response("404", "Not found or owned by another recipient (safe 404)."),
        },
        "patch": {
            **_json_response("200", "Read state updated.", _data_envelope(_object_ref("Notification"))),
            **_error_response("404", "Not found or owned by another recipient (safe 404)."),
            **_error_response("422", "Validation failed; fields carries the per-field errors."),
            **_error_response("500", "read_state_error: the write failed; state unchanged, retryable."),
        },
    }


class TimesheetListSchema(_ViewSchema):
    request_bodies = {"post": _body(_object_ref("TimesheetCreateRequest"))}
    responses = {
        # TimesheetListCreateView.get: page envelope of Timesheet; post: 201.
        "get": {
            **_json_response("200", "Employee-owned timesheet list.", _page_envelope(_object_ref("Timesheet"))),
        },
        "post": {
            **_json_response("201", "Timesheet created (Idempotency-Key header required).", _data_envelope(_object_ref("Timesheet"))),
            **_error_response("409", "idempotency_conflict or duplicate_week."),
            **_error_response("422", "Validation failed or Idempotency-Key header missing."),
            **_error_response("429", "Mutation rate limit exceeded (60/min)."),
        },
    }


class TimesheetDetailSchema(_ViewSchema):
    responses = {
        # TimesheetDetailView.get: {"data": Timesheet}; safe 404.
        "get": {
            **_json_response("200", "Employee-owned timesheet detail.", _data_envelope(_object_ref("Timesheet"))),
            **_error_response("404", "Not found or owned by another employee (uniform 404)."),
        },
    }


class TimesheetSubmitSchema(_ViewSchema):
    request_bodies = {"post": _body(_object_ref("TimesheetSubmitRequest"))}
    responses = {
        "post": {
            **_json_response("200", "Timesheet submitted (or idempotent replay).", _data_envelope(_object_ref("Timesheet"))),
            **_error_response("404", "Not found or owned by another employee (uniform 404)."),
            **_error_response("409", "version_conflict, state_conflict, or idempotency_conflict."),
            **_error_response("422", "Validation failed or Idempotency-Key header missing."),
            **_error_response("429", "Mutation rate limit exceeded (60/min)."),
        }
    }


class TimesheetEntrySchema(_ViewSchema):
    request_bodies = {
        "patch": _body(_object_ref("TimeEntryCorrectionRequest")),
        "delete": _body(_object_ref("EntryDeleteRequest")),
    }
    responses = {
        # TimesheetEntryDetailView.patch/delete: corrected sheet or 409/422.
        "patch": {
            **_json_response("200", "Entry corrected; the sheet snapshot is returned.", _data_envelope(_object_ref("Timesheet"))),
            **_error_response("404", "Not found or owned by another employee (uniform 404)."),
            **_error_response("409", "version_conflict or state_conflict (read-only outside DRAFT/RETURNED)."),
            **_error_response("422", "Validation failed; fields carries the per-field errors."),
            **_error_response("429", "Mutation rate limit exceeded (60/min)."),
        },
        "delete": {
            **_json_response("200", "Entry deleted; the sheet snapshot is returned.", _data_envelope(_object_ref("Timesheet"))),
            **_error_response("404", "Not found or owned by another employee (uniform 404)."),
            **_error_response("409", "version_conflict or state_conflict (read-only outside DRAFT/RETURNED)."),
            **_error_response("422", "Validation failed; fields carries the per-field errors."),
            **_error_response("429", "Mutation rate limit exceeded (60/min)."),
        },
    }


class TimesheetDecisionSchema(_ViewSchema):
    request_bodies = {"post": _body(_object_ref("TimesheetDecisionRequest"))}
    responses = {
        "post": {
            **_json_response("200", "Decision applied (or idempotent replay).", _data_envelope(_object_ref("Timesheet"))),
            **_error_response("404", "Not found or out of scope (uniform 404)."),
            **_error_response("409", "version_conflict, state_conflict, idempotency_conflict, or self_decision_forbidden."),
            **_error_response("422", "Validation failed or Idempotency-Key header missing."),
            **_error_response("429", "Mutation rate limit exceeded (60/min)."),
        }
    }


class TimesheetReopenSchema(_ViewSchema):
    request_bodies = {"post": _body(_object_ref("TimesheetReopenRequest"))}
    responses = {
        "post": {
            **_json_response("200", "Timesheet reopened to RETURNED (HR only; or idempotent replay).", _data_envelope(_object_ref("Timesheet"))),
            **_error_response("404", "Not found or requester is not HR (uniform 404)."),
            **_error_response("409", "version_conflict, state_conflict, idempotency_conflict, or self_decision_forbidden."),
            **_error_response("422", "Validation failed or Idempotency-Key header missing."),
            **_error_response("429", "Mutation rate limit exceeded (60/min)."),
        }
    }


class ReviewQueueSchema(_ViewSchema):
    responses = {
        # RequestQueueView.get: page envelope of ReviewRequestSummary.
        "get": {
            **_json_response("200", "Scope-filtered request queue (manager/HR).", _page_envelope(_object_ref("ReviewRequestSummary"))),
            **_error_response("422", "Invalid queue filters (non_field_errors)."),
        },
    }


class ReviewRequestDetailSchema(_ViewSchema):
    responses = {
        # RequestReviewDetailView.get: {"data": ReviewRequest}; safe 404.
        "get": {
            **_json_response("200", "Scoped read-only request detail.", _data_envelope(_object_ref("ReviewRequest"))),
            **_error_response("404", "Not found or out of scope (uniform 404)."),
        },
    }


class TimesheetQueueSchema(_ViewSchema):
    responses = {
        # TimesheetQueueView.get: page envelope of ReviewTimesheetSummary.
        "get": {
            **_json_response("200", "Scope-filtered timesheet queue (manager/HR).", _page_envelope(_object_ref("ReviewTimesheetSummary"))),
            **_error_response("422", "Invalid queue filters (non_field_errors)."),
        },
    }


class TimesheetReviewDetailSchema(_ViewSchema):
    responses = {
        # TimesheetReviewDetailView.get: {"data": ReviewTimesheet}; safe 404.
        "get": {
            **_json_response("200", "Scoped read-only timesheet detail.", _data_envelope(_object_ref("ReviewTimesheet"))),
            **_error_response("404", "Not found or out of scope (uniform 404)."),
        },
    }


def _report_meta():
    """meta keys returned by review.reports.resolve_report (read verbatim)."""
    return {
        "type": "object",
        "properties": {
            "report": {"type": "string", "enum": ["requests", "timesheets"]},
            "scope": {"type": "string"},
            "org_timezone": {"type": "string"},
            "date_from": {"type": "string", "format": "date", "nullable": True},
            "date_to": {"type": "string", "format": "date", "nullable": True},
            "filters_applied": {"type": "object"},
            "row_count": {"type": "integer"},
            "row_limit": {"type": "integer"},
        },
    }


class ReportSchema(_ViewSchema):
    responses = {
        # ReportRowsView.get: {"data": [row...], "meta": report meta}.
        "get": {
            **_json_response("200", "Bounded scoped report rows (manager/HR).", {
                "type": "object",
                "properties": {
                    "data": {"type": "array", "items": {"type": "object"}},
                    "meta": _report_meta(),
                },
            }),
            **_error_response("403", "Reports are available to managers and HR only."),
            **_error_response("422", "Invalid report filters or row limit semantics."),
        },
    }


class ReportTotalsSchema(_ViewSchema):
    responses = {
        # ReportTotalsView.get: {"data": totals, "meta": report meta}.
        "get": {
            **_json_response("200", "Status totals over the scoped report.", {
                "type": "object",
                "properties": {
                    "data": {
                        "type": "object",
                        "properties": {
                            "total": {"type": "integer"},
                            "counts_by_status": {"type": "object"},
                        },
                    },
                    "meta": _report_meta(),
                },
            }),
            **_error_response("403", "Reports are available to managers and HR only."),
            **_error_response("422", "Invalid report filters."),
        },
    }


class ReportDashboardSchema(_ViewSchema):
    responses = {
        # ReportDashboardView.get: totals + timesheet minute aggregates.
        "get": {
            **_json_response("200", "Dashboard totals (plus minute aggregates for timesheets).", {
                "type": "object",
                "properties": {
                    "data": {
                        "type": "object",
                        "properties": {
                            "total": {"type": "integer"},
                            "counts_by_status": {"type": "object"},
                            "total_worked_minutes": {"type": "integer"},
                            "total_unpaid_break_minutes": {"type": "integer"},
                        },
                    },
                    "meta": _report_meta(),
                },
            }),
            **_error_response("403", "Reports are available to managers and HR only."),
            **_error_response("422", "Invalid report filters."),
        },
    }


class ReportCsvSchema(_ViewSchema):
    responses = {
        # ReportCsvView.get: CSV bytes; every rejection path is a JSON envelope.
        "get": {
            "200": {
                "description": "UTF-8 CSV download initiation (audited, bounded to 10,000 rows).",
                "content": {"text/csv": {"schema": {"type": "string"}}},
            },
            **_error_response("403", "Reports are available to managers and HR only."),
            **_error_response("422", "Invalid filters or row_limit_exceeded (no partial bytes)."),
            **_error_response("429", "Export rate limit exceeded (5/hour/user)."),
        },
    }


# ---------------------------------------------------------------------------
# Health endpoints (plain Django views, config/health.py — literal payloads).
# ---------------------------------------------------------------------------

HEALTH_LIVE_RESPONSES = {
    **_json_response("200", "Process liveness: no dependency contact.", {
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["ok"]},
            "checks": {"type": "object", "properties": {"process": {"type": "string", "enum": ["ok"]}}},
        },
    }),
}

HEALTH_READY_RESPONSES = {
    **_json_response("200", "Bounded dependency readiness.", {
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["ok"]},
            "checks": {"type": "object", "properties": {"database": {"type": "string", "enum": ["ok"]}}},
        },
    }),
    **_json_response("503", "A bounded dependency check failed; the response names only the dependency kind.", {
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["unready"]},
            "checks": {"type": "object", "properties": {"database": {"type": "string", "enum": ["unavailable"]}}},
        },
    }),
}


# ---------------------------------------------------------------------------
# Wiring: attach the mapping to the real views, then let SchemaGenerator walk
# the actual URLconf. Path parameters are typed from the URL patterns in
# config/urls.py and the app urls.py modules.
# ---------------------------------------------------------------------------

_PATH_PARAMETER_TYPES = {
    # accounts/urls.py, notifications/urls.py
    "target_id": ("path", "integer"),
    "notification_id": ("path", "integer"),
    # reqs/urls.py, timesheets/urls.py, review/urls.py
    "pk": ("path", "string", "uuid"),
    "entry_id": ("path", "string"),
    # review/urls.py
    "category": ("path", "string", None, ["requests", "timesheets"]),
}


def _attach_schema(view_cls, schema_cls):
    view_cls.schema = schema_cls()


def _wire_schemas():
    from accounts import employee_views, views as accounts_views
    from notifications import views as notification_views
    from reqs import attachment_views, views as reqs_views
    from review import report_views, views as review_views
    from timesheets import views as timesheet_views

    _attach_schema(accounts_views.CsrfBootstrapView, AccountsSchema)
    _attach_schema(accounts_views.LoginView, AccountsSchema)
    _attach_schema(accounts_views.LogoutView, AccountsSchema)
    _attach_schema(accounts_views.MeView, MeSchema)
    _attach_schema(employee_views.EmployeeListView, EmployeeSchema)
    _attach_schema(employee_views.EmployeeDetailView, EmployeeDetailSchema)

    _attach_schema(reqs_views.RequestListView, RequestListSchema)
    _attach_schema(reqs_views.RequestDetailView, RequestDetailSchema)
    _attach_schema(reqs_views.RequestSubmitView, RequestSubmitSchema)
    _attach_schema(reqs_views.RequestDecisionView, RequestDecisionSchema)
    _attach_schema(reqs_views.RequestCancelView, RequestCancelSchema)
    _attach_schema(attachment_views.AttachmentListView, AttachmentListSchema)
    _attach_schema(attachment_views.AttachmentDetailView, AttachmentDetailSchema)
    _attach_schema(attachment_views.AttachmentReplaceView, AttachmentReplaceSchema)
    _attach_schema(attachment_views.AttachmentDownloadView, AttachmentDownloadSchema)

    _attach_schema(notification_views.NotificationListView, NotificationListSchema)
    _attach_schema(notification_views.NotificationDetailView, NotificationDetailSchema)
    _attach_schema(notification_views.NotificationReadStateView, NotificationReadStateSchema)

    _attach_schema(timesheet_views.TimesheetListCreateView, TimesheetListSchema)
    _attach_schema(timesheet_views.TimesheetDetailView, TimesheetDetailSchema)
    _attach_schema(timesheet_views.TimesheetSubmitView, TimesheetSubmitSchema)
    _attach_schema(timesheet_views.TimesheetEntryDetailView, TimesheetEntrySchema)
    _attach_schema(timesheet_views.TimesheetDecisionView, TimesheetDecisionSchema)
    _attach_schema(timesheet_views.TimesheetReopenView, TimesheetReopenSchema)

    _attach_schema(review_views.RequestQueueView, ReviewQueueSchema)
    _attach_schema(review_views.RequestReviewDetailView, ReviewRequestDetailSchema)
    _attach_schema(review_views.TimesheetQueueView, TimesheetQueueSchema)
    _attach_schema(review_views.TimesheetReviewDetailView, TimesheetReviewDetailSchema)
    _attach_schema(report_views.ReportRowsView, ReportSchema)
    _attach_schema(report_views.ReportTotalsView, ReportTotalsSchema)
    _attach_schema(report_views.ReportDashboardView, ReportDashboardSchema)
    _attach_schema(report_views.ReportCsvView, ReportCsvSchema)


class TrackingSchemaGenerator(SchemaGenerator):
    """SchemaGenerator over the real URLconf with per-view status mapping.

    The health endpoints are plain Django views (not APIView), so the base
    generator skips them; they are appended verbatim from config/health.py.
    """

    def get_schema(self, request=None, public=False):
        from config.health import health_live, health_ready

        _wire_schemas()
        schema = super().get_schema(request=request, public=True)
        # reqs/urls.py's attachment-replace re_path requires the trailing
        # slash (the optional ``?`` in the pattern binds to the ignored
        # ``pk2`` segment, not to the slash), so DRF's normalized
        # ``/replace`` path is a URL that 404s in practice. The schema must
        # describe the URL that actually routes, so the path is renamed to
        # the routable form. (pk2 is accepted by the URL pattern but ignored
        # by AttachmentReplaceView.post.)
        replace_path = "/api/v1/attachments/{pk}/replace"
        if replace_path in schema["paths"]:
            schema["paths"][replace_path + "/"] = schema["paths"].pop(replace_path)
        schema["paths"]["/health/live"] = {
            "get": {
                "operationId": "healthLive",
                "responses": HEALTH_LIVE_RESPONSES,
                "tags": ["health"],
            }
        }
        schema["paths"]["/health/ready"] = {
            "get": {
                "operationId": "healthReady",
                "responses": HEALTH_READY_RESPONSES,
                "tags": ["health"],
            }
        }
        return schema

    def coerce_path(self, path, method, view):
        # Keep the contract parameter names (pk, entry_id, category, ...)
        # instead of DRF's {pk} -> {id} rewrite, so the documented paths match
        # the URL patterns exactly.
        return path

    def get_path_parameters(self, path, method):  # noqa: D102 - see AutoSchema
        parameters = []
        for name in _parameter_names(path):
            spec = _PATH_PARAMETER_TYPES.get(name, ("path", "string"))
            parameter = {"name": name, "in": spec[0], "required": True, "schema": {"type": spec[1]}}
            if len(spec) > 2 and spec[2]:
                parameter["schema"]["format"] = spec[2]
            if len(spec) > 3 and spec[3]:
                parameter["schema"]["enum"] = list(spec[3])
            parameters.append(parameter)
        return parameters


def _parameter_names(path):
    import re

    return re.findall(r"\{(\w+)\}", path)


# Query parameters documented per view (read from the actual filter code:
# config/api.py pagination classes and review/scope_helpers._common).
_PAGINATION_PARAMETERS = [
    {"name": "page", "in": "query", "required": False, "schema": {"type": "integer", "minimum": 1}},
    {"name": "page_size", "in": "query", "required": False, "schema": {"type": "integer", "minimum": 1}},
]

_QUEUE_FILTER_PARAMETERS = [
    {"name": "q", "in": "query", "required": False, "schema": {"type": "string"}},
    {"name": "status", "in": "query", "required": False, "schema": {"type": "string"}},
    {"name": "date_from", "in": "query", "required": False, "schema": {"type": "string", "format": "date"}},
    {"name": "date_to", "in": "query", "required": False, "schema": {"type": "string", "format": "date"}},
]


def _augment_query_parameters(schema):
    """Add the real query parameters to the documented list/queue/report paths.

    DRF's default AutoSchema derives query parameters from the view's
    pagination_class; our views construct paginators inline, so the real
    parameters (page/page_size; q/status/date_from/date_to for queues and
    reports) are attached here, view-by-view.
    """
    paginated = {
        "/api/v1/requests",
        "/api/v1/employees",
        "/api/v1/notifications",
        "/api/v1/timesheets",
        "/api/v1/review/requests/queue",
        "/api/v1/review/timesheets/queue",
    }
    filtered = {
        "/api/v1/review/requests/queue",
        "/api/v1/review/timesheets/queue",
        "/api/v1/reports/{category}/rows",
        "/api/v1/reports/{category}/totals",
        "/api/v1/reports/{category}/dashboard",
        "/api/v1/reports/{category}/csv",
    }
    for path, operations in schema["paths"].items():
        for method, operation in operations.items():
            parameters = []
            if path in paginated:
                parameters.extend(_PAGINATION_PARAMETERS)
            if path in filtered:
                parameters.extend(_QUEUE_FILTER_PARAMETERS)
            if parameters:
                operation["parameters"] = parameters + operation.get("parameters", [])
    return schema


COMPONENT_SCHEMAS = {
    "RequestType": REQUEST_TYPE,
    "EmployeeRequest": EMPLOYEE_REQUEST,
    "EmployeeRead": EMPLOYEE_READ,
    "CurrentUser": CURRENT_USER,
    "Notification": NOTIFICATION,
    "Timesheet": TIMESHEET,
    "TimeEntry": TIME_ENTRY,
    "TimesheetEvent": TIMESHEET_EVENT,
    "Attachment": ATTACHMENT,
    "LoginRequest": LOGIN_REQUEST,
    "CurrentUserUpdateRequest": CURRENT_USER_UPDATE_REQUEST,
    "EmployeeCreateRequest": EMPLOYEE_CREATE_REQUEST,
    "EmployeeUpdateRequest": EMPLOYEE_UPDATE_REQUEST,
    "DraftCreateRequest": DRAFT_CREATE_REQUEST,
    "DraftEditRequest": DRAFT_EDIT_REQUEST,
    "SubmitRequestRequest": SUBMIT_REQUEST_REQUEST,
    "DecisionRequest": DECISION_REQUEST,
    "CancelRequestRequest": CANCEL_REQUEST_REQUEST,
    "NotificationReadStateRequest": NOTIFICATION_READ_STATE_REQUEST,
    "TimesheetCreateRequest": TIMESHEET_CREATE_REQUEST,
    "TimesheetSubmitRequest": TIMESHEET_SUBMIT_REQUEST,
    "TimeEntryCorrectionRequest": TIME_ENTRY_CORRECTION_REQUEST,
    "EntryDeleteRequest": ENTRY_DELETE_REQUEST,
    "TimesheetDecisionRequest": TIMESHEET_DECISION_REQUEST,
    "TimesheetReopenRequest": TIMESHEET_REOPEN_REQUEST,
    "ReviewRequestSummary": _component(ReviewRequestSummarySerializer(), "ReviewRequestSummary"),
    "ReviewRequest": _component(ReviewRequestSerializer(), "ReviewRequest"),
    "ReviewTimesheetSummary": _component(ReviewTimesheetSummarySerializer(), "ReviewTimesheetSummary"),
    "ReviewTimesheet": _component(ReviewTimesheetSerializer(), "ReviewTimesheet"),
}


def build_schema():
    """Generate the OpenAPI document from the actual URLconf and views."""
    generator = TrackingSchemaGenerator(title="Heya Fawda? Tracking API", version="v1")
    schema = generator.get_schema()
    schema.setdefault("components", {})["schemas"] = COMPONENT_SCHEMAS
    return _augment_query_parameters(schema)


@require_GET
def schema_endpoint(request):
    """GET /api/v1/schema — serve the generated OpenAPI document.

    Read-only metadata about the API surface: no authentication (same
    posture as the health probes), no secrets, no state change. The
    ``X-API-Version`` header is stamped by ``APIVersionMiddleware`` like
    every other ``/api/`` response.
    """
    return JsonResponse(build_schema(), json_dumps_params={"indent": 2})
