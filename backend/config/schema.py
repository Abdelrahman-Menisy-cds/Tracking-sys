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

from accounts.company_serializers import CompanyProfileReadSerializer, CompanyProfileWriteSerializer
from accounts.employee_serializers import (
    EmployeeCreateSerializer,
    EmployeeReadSerializer,
    EmployeeUpdateSerializer,
)
from accounts.serializers import CurrentUserSerializer, CurrentUserUpdateSerializer, LoginSerializer, SignupSerializer
from accounts.views import SignupView
from accounts.work_schedule_serializers import WorkScheduleReadSerializer, WorkScheduleWriteSerializer
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
COMPANY_PROFILE = _component(CompanyProfileReadSerializer(), "CompanyProfile")
NOTIFICATION = _component(NotificationSerializer(), "Notification")
EMPLOYEE_REQUEST = _component(reqs_serializers.EmployeeRequestSerializer(), "EmployeeRequest")
REQUEST_TYPE = _component(reqs_serializers.RequestTypeSerializer(), "RequestType")
TIMESHEET = _component(ts_serializers.TimesheetSerializer(), "Timesheet")
TIME_ENTRY = _component(ts_serializers.TimeEntrySerializer(), "TimeEntry")
TIMESHEET_EVENT = _component(ts_serializers.TimesheetEventSerializer(), "TimesheetEvent")

# Request body components (write shapes), exactly as the views instantiate them.
LOGIN_REQUEST = _component(LoginSerializer(), "LoginRequest")
SIGNUP_REQUEST = _component(SignupSerializer(), "SignupRequest")
SIGNUP_EMAIL_IN_USE = {
    "title": "SignupEmailInUse",
    "type": "object",
    "properties": {"outcome": {"type": "string", "enum": ["email_in_use"]}},
    "required": ["outcome"],
}
CURRENT_USER_UPDATE_REQUEST = _component(CurrentUserUpdateSerializer(partial=True), "CurrentUserUpdateRequest")
COMPANY_PROFILE_UPDATE_REQUEST = _component(CompanyProfileWriteSerializer(partial=True), "CompanyProfileUpdateRequest")
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

# Story H39: work schedules (read shape carries the nested day set; the write
# shape is the same serializer the view instantiates, partial for PATCH).
WORK_SCHEDULE = _component(WorkScheduleReadSerializer(), "WorkSchedule")
WORK_SCHEDULE_CREATE_REQUEST = _component(WorkScheduleWriteSerializer(), "WorkScheduleCreateRequest")
WORK_SCHEDULE_UPDATE_REQUEST = _component(WorkScheduleWriteSerializer(partial=True), "WorkScheduleUpdateRequest")

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

    def get_operation_id(self, path, method):
        # Explicit ids: DRF's default camel-cased ids need the `inflection`
        # package (not a repo dependency) and are otherwise identity-quality.
        view_name = self.view.__class__.__name__
        if view_name.endswith("APIView"):
            view_name = view_name[: -len("APIView")]
        if view_name.endswith("View"):
            view_name = view_name[: -len("View")]
        return f"{view_name}_{method.lower()}"

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


class SignupSchema(_ViewSchema):
    request_bodies = {"post": _body(_object_ref("SignupRequest"))}
    responses = {
        # SignupView.post: 200 CurrentUser + csrftoken on success,
        # 200 {"data": {"outcome": "email_in_use"}} for an existing account.
        "post": {
            **_json_response("200", "Session established.", {
                "type": "object",
                "properties": {
                    "data": _object_ref("CurrentUser"),
                    "meta": {"type": "object", "properties": {"csrftoken": {"type": "string"}}},
                },
            }),
            **_json_response("200", "Email already registered; account untouched (non-enumerating).", _data_envelope(SIGNUP_EMAIL_IN_USE)),
            **_error_response(
                "400",
                "invalid_code: wrong or inactive subscription code (generic); "
                "company_data_not_expected: a code bound to a company was sent with company data (H34); "
                "validation_error: the nested company data is missing required profile fields (H34).",
            ),
            **_error_response("403", "CSRF check failed on the unsafe method."),
            **_error_response("422", "Validation failed (e.g. weak password, bad email, or an invalid nested company field)."),
            **_error_response("429", "Signup rate limit exceeded (10/min per IP)."),
        },
    }


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
        # MeView.patch: 200 CurrentUser envelope, or 409 version_conflict when
        # a stale expected_appearance would overwrite a newer saved value
        # (Story 5.3 stale-write guard; handled in MeView.patch, not the
        # shared exception handler).
        "patch": {
            **_json_response("200", "Profile updated.", _data_envelope(_object_ref("CurrentUser"))),
            **_error_response("409", "version_conflict: the saved appearance changed since the client last saw it."),
        },
    }


class CompanySchema(_ViewSchema):
    request_bodies = {
        "patch": _body(_object_ref("CompanyProfileUpdateRequest")),
    }
    responses = {
        # CompanyProfileView.get/patch: {"data": {"profile": CompanyProfile|null,
        # "needs_profile": bool}} — Story H17.
        "get": {
            **_json_response("200", "Company profile read; profile is null when the organisation has not saved one yet.", {
                "type": "object",
                "properties": {
                    "data": {
                        "type": "object",
                        "properties": {
                            "profile": {"nullable": True, "oneOf": [_object_ref("CompanyProfile")]},
                            "needs_profile": {"type": "boolean"},
                        },
                        "required": ["profile", "needs_profile"],
                    },
                },
            }),
            **_error_response("403", "permission_denied: company data is available to HR only."),
        },
        "patch": {
            **_json_response("200", "Company profile updated (200 with the same shape as GET).", {
                "type": "object",
                "properties": {
                    "data": {
                        "type": "object",
                        "properties": {
                            "profile": {"nullable": True, "oneOf": [_object_ref("CompanyProfile")]},
                            "needs_profile": {"type": "boolean"},
                        },
                        "required": ["profile", "needs_profile"],
                    },
                },
            }),
            **_error_response("400", "validation_error: the merged result would miss a required field, or a field value is invalid (fields carries the per-field errors)."),
            **_error_response("403", "permission_denied: company data is available to HR only."),
        },
    }


_ASSISTANT_CONFIG_ITEM = {
    "title": "AssistantConfigRead",
    "type": "object",
    # The key itself NEVER appears; only the hint and its origin. Story H18.
    # H19 adds the subscription fields (mode, provider, source...) — the
    # token material never appears anywhere in the shape, only the hint.
    "properties": {
        "is_configured": {"type": "boolean"},
        "is_active": {"type": "boolean"},
        "base_url": {"type": "string"},
        "model": {"type": "string"},
        "key_hint": {"type": "string"},
        "key_source": {"nullable": True, "type": "string", "enum": ["self", "hr", None]},
        "can_replace_key": {"type": "boolean"},
        "mode": {"type": "string", "enum": ["api", "subscription"]},
        "subscription_provider": {"type": "string", "description": "'opencode' | 'codex' when linked, '' in api mode."},
        "subscription_hint": {"type": "string"},
        "subscription_cred_type": {"type": "string", "description": "'key' | 'oauth' when linked, '' otherwise."},
        "subscription_source": {"type": "string", "description": "'device' (the in-app login flow) | 'local' (imported from this machine's CLI login)."},
        "subscription_expires": {"nullable": True, "type": "string", "format": "date-time", "description": "oauth only; a KEY credential does not expire."},
    },
    "required": ["is_configured", "is_active", "base_url", "model", "key_hint", "key_source", "can_replace_key", "mode", "subscription_provider", "subscription_hint", "subscription_cred_type", "subscription_source", "subscription_expires"],
}

_ASSISTANT_CONFIG_WRITE = {
    "title": "AssistantConfigWrite",
    "type": "object",
    "properties": {
        "base_url": {"type": "string", "format": "uri"},
        "model": {"type": "string"},
        # write-only in practice: documented but never returned.
        "api_key": {"type": "string", "description": "Stored encrypted at rest; never returned."},
        "mode": {"type": "string", "enum": ["api", "subscription"], "description": "api (default): base_url/model required. subscription: links the picked provider from this machine's local CLI login."},
        "subscription_provider": {"nullable": True, "type": "string", "enum": ["opencode", "codex", None], "description": "With mode=subscription only. No other presets exist (owner's rule)."},
    },
    "required": ["base_url", "model"],
}

_ASSISTANT_SUBSCRIPTION_START = {
    "title": "AssistantSubscriptionStart",
    "type": "object",
    "properties": {
        "provider": {"type": "string", "enum": ["opencode", "codex"]},
    },
    "required": ["provider"],
}

_ASSISTANT_SUBSCRIPTION_FLOW = {
    "title": "AssistantSubscriptionFlow",
    "type": "object",
    "description": "The device-login job: approve the user code at the link; the server stores the token server-side only.",
    "properties": {
        "provider": {"type": "string"},
        "verification_uri": {"nullable": True, "type": "string"},
        "user_code": {"nullable": True, "type": "string"},
        "interval": {"type": "integer"},
        "expires_in": {"type": "integer"},
    },
    "required": ["provider", "interval", "expires_in"],
}

_ASSISTANT_SUBSCRIPTION_POLL = {
    "title": "AssistantSubscriptionPollResult",
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["pending", "linked"]},
        "additionalProperties": True,
    },
    "required": ["status"],
}

_ASSISTANT_SUBSCRIPTION_CAPABILITY = {
    "title": "AssistantSubscriptionCapability",
    "type": "object",
    "description": "What this provider honestly supports: the local-CLI import is the primary link path; an in-app login exists only where the provider itself offers one (fix-up 4: no invented /oauth/* calls).",
    "properties": {
        "provider": {"type": "string"},
        "import_available": {"type": "boolean"},
        "login_flow_available": {"type": "boolean"},
    },
    "required": ["provider", "import_available", "login_flow_available"],
}

_ASSISTANT_SUBSCRIPTION_MODELS = {
    "title": "AssistantSubscriptionModels",
    "type": "object",
    "properties": {
        "supported": {"type": "boolean", "description": "false when the provider exposes no listing endpoint (then type the model id)."},
        "models": {"type": "array", "items": {"type": "string"}},
        "detail": {"type": "string"},
    },
    "required": ["supported", "models", "detail"],
}

_ASSISTANT_HR_WRITE = {
    "title": "AssistantEmployeeWrite",
    "type": "object",
    "properties": {
        "base_url": {"type": "string", "format": "uri"},
        "model": {"type": "string"},
        "api_key": {"type": "string", "description": "Stored encrypted at rest; never returned."},
        "is_active": {"type": "boolean", "description": "HR's activation toggle."},
    },
}

_ASSISTANT_TEST_RESULT = {
    "title": "AssistantTestResult",
    "type": "object",
    "properties": {
        "ok": {"type": "boolean"},
        "latency_ms": {"type": "integer"},
        "detail": {"type": "string", "description": "On failure: the provider's own status and message, or a classified connection symptom (dns/connect/tls/timeout), always naming the exact URL used."},
    },
    "required": ["ok", "latency_ms", "detail"],
}

_ASSISTANT_CHAT_REPLY = {
    "title": "AssistantChatReply",
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "pending_action": {
            "nullable": True,
            "type": "object",
            "properties": {
                "token": {"type": "string", "description": "Opaque signed confirmation token."},
                "name": {"type": "string", "description": "The write tool, e.g. create_request."},
                "args": {"type": "object"},
            },
            "required": ["token", "name", "args"],
        },
        "tool_trace": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tool": {"type": "string"},
                    "immediate": {"type": "boolean"},
                    "pending": {"type": "boolean"},
                    "refused": {"type": "boolean"},
                },
            },
        },
    },
    "required": ["reply", "pending_action", "tool_trace"],
}

_ASSISTANT_CONFIRM_RESULT = {
    "title": "AssistantConfirmResult",
    "type": "object",
    "properties": {
        "result": {"type": "object", "description": "The write's own result payload."},
        "tool": {"type": "string"},
    },
    "required": ["result", "tool"],
}


class AssistantConfigSchema(_ViewSchema):
    """GET/PUT /api/v1/assistant/config (the caller's own config)."""

    request_bodies = {"put": _body(_object_ref("AssistantConfigWrite"))}
    responses = {
        "get": {
            **_json_response("200", "The caller's own assistant config; the key (and any subscription token) is never returned.", _data_envelope(_ASSISTANT_CONFIG_ITEM)),
        },
        "put": {
            **_json_response("200", "Config saved (the read shape is returned). With mode=subscription the picked provider is linked from this machine's local CLI login; one credential per row, so the previous subscription/api key is cleared.", _data_envelope(_ASSISTANT_CONFIG_ITEM)),
            **_error_response("409", "no_local_login: no local CLI login exists for the picked provider on this machine."),
            **_error_response("422", "Validation failed (bad base_url/model, an unknown provider, or a protected field)."),
        },
    }


class AssistantSubscriptionCapabilitySchema(_ViewSchema):
    """GET /api/v1/assistant/subscription/capability?provider=<slug> — the
    honest capability set for one provider (import always; in-app login
    only when the provider itself offers one)."""

    responses = {
        "get": {
            **_json_response("200", "The provider's capability set: import_available and login_flow_available.", _data_envelope(_ASSISTANT_SUBSCRIPTION_CAPABILITY)),
            **_error_response("422", "unknown_provider: pick opencode or codex."),
            **_error_response("401", "Authentication required."),
        },
    }


class AssistantSubscriptionImportSchema(_ViewSchema):
    """POST /api/v1/assistant/subscription/import — link the local CLI login."""

    request_bodies = {"post": _body(_object_ref("AssistantSubscriptionStart"))}
    responses = {
        "post": {
            **_json_response("200", "Linked from this machine's CLI login; the read shape says subscription_source=\"local\". No secret in any field.", _data_envelope(_ASSISTANT_SUBSCRIPTION_POLL)),
            **_error_response("409", "no_local_login: the provider's CLI was never logged in on this machine."),
            **_error_response("422", "unknown_provider: pick opencode or codex."),
        },
    }


class AssistantSubscriptionStartSchema(_ViewSchema):
    """POST /api/v1/assistant/subscription/start — begin the provider's own
    device flow (H21): the user_code + approval URL the SPA shows; the
    device_code stays server-side."""

    request_bodies = {"post": _body(_object_ref("AssistantSubscriptionStart"))}
    responses = {
        "post": {
            **_json_response("200", "The device flow started: approve the user_code at verification_uri (NOT opened anywhere else); expires_in seconds of runway, poll at interval seconds.", _data_envelope(_ASSISTANT_SUBSCRIPTION_FLOW)),
            **_error_response("409", "no_login_flow: this provider has no in-app login (codex); provider_unreachable / provider_error: the provider's own failure, scrubbed."),
            **_error_response("422", "unknown_provider: pick opencode or codex."),
        },
    }


class AssistantSubscriptionPollSchema(_ViewSchema):
    """POST /api/v1/assistant/subscription/poll — one poll turn."""

    request_bodies = {"post": _body(_object_ref("AssistantSubscriptionStart"))}
    responses = {
        "post": {
            **_json_response("200", "pending until approved; on approval the credential is stored ENCRYPTED and the row read shape returns (subscription_source=\"device\"). No token in any field.", _data_envelope(_ASSISTANT_SUBSCRIPTION_POLL)),
            **_error_response("409", "no_active_flow / flow_expired / no_login_flow: start the flow again; provider_unreachable / provider_error: the provider's own failure, scrubbed."),
            **_error_response("422", "unknown_provider: pick opencode or codex."),
        },
    }


class AssistantSubscriptionModelsSchema(_ViewSchema):
    """GET /api/v1/assistant/subscription/models — the offered models."""

    responses = {
        "get": {
            **_json_response("200", "The models the linked subscription offers (the user picks one). supported=false honestly reports a provider with no listing endpoint.", _data_envelope(_ASSISTANT_SUBSCRIPTION_MODELS)),
            **_error_response("409", "not_configured / not linked."),
        },
    }


class AssistantTestSchema(_ViewSchema):
    """POST /api/v1/assistant/test — the Test button."""

    responses = {
        "post": {
            **_json_response("200", "The connection result: ok + latency, or the provider's own status/message.", _data_envelope(_ASSISTANT_TEST_RESULT)),
            **_error_response("409", "not_configured: no base URL/key/model yet, or key_unreadable: the server secret cannot open the stored key."),
        },
    }


class AssistantHRConfigSchema(_ViewSchema):
    """GET/PUT /api/v1/employees/{target_id}/assistant (HR only)."""

    request_bodies = {"put": _body(_object_ref("AssistantEmployeeWrite"))}
    responses = {
        "get": {
            **_json_response("200", "The employee's assistant config; the key is never returned.", _data_envelope(_ASSISTANT_CONFIG_ITEM)),
            **_error_response("403", "permission_denied: HR only."),
            **_error_response("404", "Not found."),
        },
        "put": {
            **_json_response("200", "The employee's assistant config updated (audited).", _data_envelope(_ASSISTANT_CONFIG_ITEM)),
            **_error_response("403", "permission_denied: HR only."),
            **_error_response("404", "Not found."),
            **_error_response("422", "Validation failed; fields carries the per-field errors."),
        },
    }


class AssistantChatSchema(_ViewSchema):
    """POST /api/v1/assistant/chat — the conversation turn."""

    responses = {
        "post": {
            **_json_response("200", "One assistant turn: the reply, an optional pending write action, and the tool trace.", _data_envelope(_ASSISTANT_CHAT_REPLY)),
            **_error_response("409", "not_configured / inactive / key_unreadable / provider_error: the chat cannot run."),
            **_error_response("422", "Validation failed: malformed or client-supplied-credential body."),
        },
    }


class AssistantConfirmSchema(_ViewSchema):
    """POST /api/v1/assistant/actions/{token}/confirm — run one confirmed write."""

    responses = {
        "post": {
            **_json_response("200", "The confirmed write's result (audited).", _data_envelope(_ASSISTANT_CONFIRM_RESULT)),
            **_error_response("400", "invalid_token / tampered / unknown_tool."),
            **_error_response("403", "user_mismatch / permission_denied."),
            **_error_response("404", "not_found: the action's target no longer exists."),
            **_error_response("409", "expired / already_used / unsupported_tool."),
            **_error_response("422", "validation_error: the arguments are no longer valid."),
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


class RequestTypeListSchema(_ViewSchema):
    responses = {
        # RequestTypeListView.get: {"data": [RequestType]} — the caller's
        # company's active types only (the rows the create endpoint accepts).
        "get": {
            **_json_response(
                "200",
                "The caller's company's ACTIVE request types.",
                _data_envelope({"type": "array", "items": _object_ref("RequestType")}),
            ),
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


# Stage H1: public-holidays register (Nager-authoritative, LLM-assisted).
HOLIDAY = {
    "title": "PublicHoliday",
    "type": "object",
    "properties": {
        "id": {"type": "string", "format": "uuid"},
        "country_code": {"type": "string"},
        "date": {"type": "string", "format": "date"},
        "name": {"type": "string"},
        "name_local": {"type": "string"},
        "source": {"type": "string", "enum": ["NAGER", "LLM", "MANUAL"]},
        "is_manual_override": {"type": "boolean"},
        "needs_confirmation": {"type": "boolean"},
        "is_recurring": {"type": "boolean"},
        "external_id": {"type": "string", "nullable": True},
        "year": {"type": "integer"},
        "created_at": {"type": "string", "format": "date-time"},
        "updated_at": {"type": "string", "format": "date-time"},
    },
    "required": [
        "id", "country_code", "date", "name", "name_local", "source",
        "is_manual_override", "needs_confirmation", "is_recurring",
        "external_id", "year", "created_at", "updated_at",
    ],
}

HOLIDAY_REFRESH_REQUEST = {
    "title": "HolidayRefreshRequest",
    "type": "object",
    "properties": {
        "year": {"type": "integer", "minimum": 1974, "maximum": 2100,
                 "description": "Defaults to the current year."},
        "country": {"type": "string", "minLength": 2, "maxLength": 2,
                    "description": "ISO 3166-1 alpha-2 code. Defaults to EG."},
    },
}

HOLIDAY_REFRESH_SUMMARY = {
    "title": "HolidayRefreshSummary",
    "type": "object",
    "properties": {
        "year": {"type": "integer"},
        "country": {"type": "string"},
        "added": {"type": "integer"},
        "updated": {"type": "integer"},
        "unchanged": {"type": "integer"},
        "manual_preserved": {"type": "integer",
                             "description": "Rows HR edited by hand and the refresh left untouched."},
        "proposed_missing": {"type": "integer",
                             "description": "LLM-proposed rows stored source=LLM / needs_confirmation=True."},
        "llm_available": {"type": "boolean"},
        "warnings": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["year", "country", "added", "updated", "unchanged",
                 "manual_preserved", "proposed_missing", "llm_available", "warnings"],
}


class HolidayListSchema(_ViewSchema):
    responses = {
        # HolidayListView.get: {"data": [PublicHoliday]} (register for year+country).
        "get": {
            **_json_response("200", "The public-holidays register for a country and year.", _data_envelope({"type": "array", "items": _object_ref("PublicHoliday")})),
            **_error_response("422", "Invalid year or country query parameter."),
            **_error_response("404", "Non-HR callers receive the uniform 404 (no existence disclosure)."),
        },
    }


class HolidayRefreshSchema(_ViewSchema):
    request_bodies = {
        "post": _body(_object_ref("HolidayRefreshRequest")),
    }
    responses = {
        # HolidayRefreshView.post: {"data": summary}; Nager down -> 503,
        # nothing written; LLM down -> 200 with llm_available=False + warnings.
        "post": {
            **_json_response("200", "Refresh summary (idempotent: a second run adds nothing).", _data_envelope(_object_ref("HolidayRefreshSummary"))),
            **_error_response("503", "Nager.Date unreachable; nothing was written."),
            **_error_response("422", "Invalid year/country body."),
            **_error_response("404", "Non-HR callers receive the uniform 404 (no existence disclosure)."),
        },
    }


# Story H39: the work-schedule endpoints (HR only, uniform 404 for non-HR).
class WorkScheduleListSchema(_ViewSchema):
    request_bodies = {
        "post": _body(_object_ref("WorkScheduleCreateRequest")),
    }
    responses = {
        # WorkScheduleListView: {"data": [WorkSchedule]}; POST creates the
        # schedule and its days in one transaction (201).
        "get": {
            **_json_response("200", "The company's work schedules, the active one flagged.", _data_envelope({"type": "array", "items": _object_ref("WorkSchedule")})),
            **_error_response("404", "Non-HR callers receive the uniform 404 (no existence disclosure)."),
        },
        "post": {
            **_json_response("201", "Schedule created with its day set (the company's first schedule activates itself).", _data_envelope(_object_ref("WorkSchedule"))),
            **_error_response("422", "Missing name/effective_from/days, or invalid day rows."),
            **_error_response("429", "Mutation rate limit exceeded (60/min)."),
            **_error_response("404", "Non-HR callers receive the uniform 404 (no existence disclosure)."),
        },
    }


class WorkScheduleDetailSchema(_ViewSchema):
    request_bodies = {
        "patch": _body(_object_ref("WorkScheduleUpdateRequest")),
    }
    responses = {
        # WorkScheduleDetailView: GET one with days; PATCH edits scalars
        # and/or replaces the day set; DELETE deactivates (soft delete).
        "get": {
            **_json_response("200", "One schedule with its days.", _data_envelope(_object_ref("WorkSchedule"))),
            **_error_response("404", "Unknown id, another company's schedule, or a non-HR caller (uniform 404)."),
        },
        "patch": {
            **_json_response("200", "Schedule updated (days replaced when sent).", _data_envelope(_object_ref("WorkSchedule"))),
            **_error_response("404", "Unknown id, another company's schedule, or a non-HR caller (uniform 404)."),
            **_error_response("422", "Invalid field values or invalid day rows."),
            **_error_response("429", "Mutation rate limit exceeded (60/min)."),
        },
        "delete": {
            **_json_response("200", "Schedule deactivated (soft delete; the row remains as version history).", _data_envelope(_object_ref("WorkSchedule"))),
            **_error_response("404", "Unknown id, another company's schedule, or a non-HR caller (uniform 404)."),
            **_error_response("429", "Mutation rate limit exceeded (60/min)."),
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
    # accounts/urls.py (Story H39)
    "schedule_id": ("path", "integer"),
    # reqs/urls.py, timesheets/urls.py, review/urls.py
    "pk": ("path", "string", "uuid"),
    "entry_id": ("path", "string"),
    # review/urls.py
    "category": ("path", "string", None, ["requests", "timesheets"]),
}


def _attach_schema(view_cls, schema_cls):
    view_cls.schema = schema_cls()


def _wire_schemas():
    from accounts import assistant_views, company_views, employee_views, views as accounts_views, work_schedule_views
    from notifications import views as notification_views
    from reqs import attachment_views, views as reqs_views
    from review import report_views, views as review_views
    from timesheets import views as timesheet_views

    _attach_schema(accounts_views.CsrfBootstrapView, AccountsSchema)
    _attach_schema(accounts_views.LoginView, AccountsSchema)
    _attach_schema(accounts_views.SignupView, SignupSchema)
    _attach_schema(accounts_views.LogoutView, AccountsSchema)
    _attach_schema(accounts_views.MeView, MeSchema)
    _attach_schema(company_views.CompanyProfileView, CompanySchema)
    _attach_schema(employee_views.EmployeeListView, EmployeeSchema)
    _attach_schema(employee_views.EmployeeDetailView, EmployeeDetailSchema)
    _attach_schema(work_schedule_views.WorkScheduleListView, WorkScheduleListSchema)
    _attach_schema(work_schedule_views.WorkScheduleDetailView, WorkScheduleDetailSchema)
    _attach_schema(assistant_views.AssistantConfigView, AssistantConfigSchema)
    _attach_schema(assistant_views.AssistantTestView, AssistantTestSchema)
    _attach_schema(assistant_views.AssistantChatView, AssistantChatSchema)
    _attach_schema(assistant_views.AssistantActionConfirmView, AssistantConfirmSchema)
    _attach_schema(assistant_views.AssistantHRConfigView, AssistantHRConfigSchema)
    _attach_schema(assistant_views.AssistantSubscriptionCapabilityView, AssistantSubscriptionCapabilitySchema)
    _attach_schema(assistant_views.AssistantSubscriptionImportView, AssistantSubscriptionImportSchema)
    _attach_schema(assistant_views.AssistantSubscriptionStartView, AssistantSubscriptionStartSchema)
    _attach_schema(assistant_views.AssistantSubscriptionPollView, AssistantSubscriptionPollSchema)
    _attach_schema(assistant_views.AssistantSubscriptionModelsView, AssistantSubscriptionModelsSchema)

    _attach_schema(reqs_views.RequestTypeListView, RequestTypeListSchema)
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

    from holidays import views as holiday_views

    _attach_schema(holiday_views.HolidayListView, HolidayListSchema)
    _attach_schema(holiday_views.HolidayRefreshView, HolidayRefreshSchema)


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
    "SignupRequest": SIGNUP_REQUEST,
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
    "PublicHoliday": HOLIDAY,
    "HolidayRefreshRequest": HOLIDAY_REFRESH_REQUEST,
    "HolidayRefreshSummary": HOLIDAY_REFRESH_SUMMARY,
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
