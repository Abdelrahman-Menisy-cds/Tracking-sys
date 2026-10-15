"""The «مدام عفاف» assistant's tools — what it may DO (Story H18).

Every tool executes AS THE CALLING USER through the project's existing
services and permission helpers — never a privileged shortcut and never a
bypass of authorization. A user who cannot do something in the UI cannot do
it through the assistant either; a tool whose service raises PermissionError
or LookupError surfaces as an error for the loop to report, not elevated.

Two families:

  READ tools run IMMEDIATELY on the turn they are called (owner decision:
  the assistant reads freely). Each answers with a bounded JSON blob the
  model can quote back.

  WRITE tools NEVER run on the chat turn. A call to one returns a
  pending_action: a signed, short-lived token bound to (user, tool, args).
  POST /assistant/actions/<token>/confirm re-checks the user, the tool's
  permission, and the exact arguments, then runs the real service and
  writes an AuditEvent (actor = the user, action = assistant.<tool>).

The loop is bounded to MAX_PROVIDER_ROUNDS (5): a confused model cannot
spin, run extra reads, or multiply provider spend.
"""
import json
from datetime import date, timedelta

from review import scope as review_scope
from reqs.models import EmployeeRequest
from timesheets.models import Timesheet
from timesheets.serializers import TimesheetSerializer
from review.serializers import (
    ReviewRequestSummarySerializer,
    ReviewTimesheetSummarySerializer,
)

MAX_PROVIDER_ROUNDS = 5
MAX_READ_ROWS = 10

# ---------------------------------------------------------------------------
# Read tools (immediate)
# ---------------------------------------------------------------------------


def _bounded(list_value):
    return list_value[:MAX_READ_ROWS]


def read_my_requests(user, args):
    """The caller's own requests, newest first."""
    from reqs.serializers import EmployeeRequestSerializer

    rows = EmployeeRequest.objects.filter(requester=user).order_by("-created_at")
    data = [
        {
            "id": str(row.pk),
            "title": row.title,
            "status": row.status,
            "version": row.version,
            "request_type": row.request_type.name,
        }
        for row in _bounded(rows.select_related("request_type"))
    ]
    return {"ok": True, "requests": data, "count": rows.count()}


def read_request_types(user, args):
    """The request types the caller may use when raising a request.

    The assistant resolves «إجازة اعتيادية» BY NAME from this list and never
    asks the user for a numeric id (owner complaint H20 #2). Types are
    org-wide and readable by everyone; nothing user-private here. An empty
    table is recommended as "HR/admin must define the types" — never as
    "give me the id".
    """
    from reqs.models import RequestType

    rows = RequestType.objects.order_by("name")
    active = [row for row in rows if row.is_active]
    data = [
        {
            "id": row.pk,
            "name": row.name,
            "requires_manager_approval": row.requires_manager_approval,
            "requires_hr_approval": row.requires_hr_approval,
            "is_active": row.is_active,
        }
        for row in _bounded(active)
    ]
    result = {"ok": True, "request_types": data}
    if not data:
        result["note"] = (
            "No request types are defined yet. HR (or an admin) must create "
            "them in the admin before any request can be raised; ask the user "
            "for the KIND of request by name, never for a type id."
        )
    return result


def read_my_timesheets(user, args):
    """The caller's own weekly sheets, newest first."""
    rows = Timesheet.objects.filter(employee=user).order_by("-week_start")
    data = [
        {
            "id": str(row.pk),
            "week_start": row.week_start.isoformat(),
            "status": row.status,
            "version": row.version,
        }
        for row in _bounded(rows)
    ]
    return {"ok": True, "timesheets": data, "count": rows.count()}


def read_my_leave_balance(user, args):
    """Leave balance COMPUTED from data that exists (H20 #1).

    The product has no leave-accrual/entitlement domain (PRD MVP boundary),
    so entitlement is genuinely unknown — but the days already taken ARE in
    the data: approved EmployeeRequests per leave type count whole-day
    leaves from their title/details is not guessable, so the honest count is
    the number of approved requests per leave type with their dates when
    the payload carries them. What the tool returns:

      per leave type: taken (approved requests count) and entitlement
      explicitly "not configured" — never a fabricated number, never a
      blanket "this org does not track balances".

    This is ALWAYS the caller's own data; no manager/HR scoping exists
    because the queryset is requester=user.
    """
    from reqs.models import RequestType

    leave_types = RequestType.objects.filter(is_active=True, name__icontains="إجازة").order_by("name")
    balances = []
    for row in leave_types:
        approved = EmployeeRequest.objects.filter(
            requester=user, request_type=row, status=EmployeeRequest.Status.APPROVED
        )
        balances.append(
            {
                "request_type_id": row.pk,
                "name": row.name,
                "taken_requests": approved.count(),
                "entitlement_days": None,
                "remaining_days": None,
                "note": "entitlement is not configured in the system; only approved-request counts are known",
            }
        )
    if not balances:
        return {
            "ok": True,
            "tracked": False,
            "note": (
                "No leave types are defined in the system yet, so no balance "
                "can be computed. HR must define leave request types first."
            ),
        }
    return {
        "ok": True,
        "tracked": True,
        "entitlement_configured": False,
        "balances": balances,
        "note": (
            "Entitlements are not configured in this system, so no remaining "
            "balance can be computed; the counts above are approved requests "
            "per leave type from your own record."
        ),
    }


def read_my_tasks(user, args):
    """The caller's tasks.

    The backend has NO tasks app yet (tasks live in frontend mock data only);
    there is no tasks table to query. The honest answer is "none tracked
    server-side".
    """
    return {
        "ok": True,
        "tasks": [],
        "note": "Tasks are not tracked in the backend yet, so there are none to list here.",
    }


def read_my_attendance(user, args):
    """The caller's timesheet-based attendance derivations.

    The backend has NO standalone attendance app (attendance pages derive
    from mock data); what IS server-tracked is the timesheet entry history,
    which is what "my time" means in the data model today.
    """
    from timesheets.models import TimeEntry

    rows = (
        TimeEntry.objects.filter(timesheet__employee=user)
        .select_related("timesheet")
        .order_by("-work_date")
    )
    data = [
        {
            "work_date": row.work_date.isoformat(),
            "duration_minutes": row.duration_minutes,
            "unpaid_break_minutes": row.unpaid_break_minutes,
        }
        for row in _bounded(rows)
    ]
    return {"ok": True, "time_entries": data, "note": "Attendance is derived from timesheet entries."}


def read_review_queue(user, args):
    """The caller's scoped review queue (manager or HR only).

    Scope comes STRAIGHT from review_scope (the same queryset the /review
    endpoints render), so somebody with no queue simply gets an empty list —
    and a plain employee gets ok: false with a reason, never data.
    """
    if user.role not in ("MANAGER", "HR"):
        return {"ok": False, "error": "Only managers and HR have a review queue."}
    requests_qs = review_scope.scope_requests(user).filter(
        status=EmployeeRequest.Status.PENDING_MANAGER
    )[:MAX_READ_ROWS]
    sheets_qs = review_scope.scope_timesheets(user).filter(
        status=Timesheet.Status.SUBMITTED
    )[:MAX_READ_ROWS]
    return {
        "ok": True,
        "pending_requests": ReviewRequestSummarySerializer(requests_qs, many=True, context={"viewer": user}).data,
        "pending_timesheets": ReviewTimesheetSummarySerializer(sheets_qs, many=True, context={"viewer": user}).data,
    }


def read_employee_directory(user, args):
    """HR: the employee directory (same visibility rule as /employees)."""
    if user.role != "HR":
        return {"ok": False, "error": "Only HR can read the employee directory."}
    from accounts.models import User

    rows = (
        User.objects.select_related("employee_profile")
        .filter(is_staff=False, is_superuser=False)
        .exclude(role=User.Role.HR)
        .filter(is_active=True)
        .order_by("id")
    )
    return {
        "ok": True,
        "employees": [
            {
                "id": row.pk,
                "email": row.email,
                "full_name": row.full_name,
                "role": row.role,
            }
            for row in _bounded(rows)
        ],
        "count": rows.count(),
    }


def read_departments(user, args):
    """HR: the departments."""
    if user.role != "HR":
        return {"ok": False, "error": "Only HR can read the departments."}
    from accounts.models import Department

    rows = Department.objects.all().order_by("code")
    return {
        "ok": True,
        "departments": [
            {"id": row.pk, "code": row.code, "name_ar": row.name_ar, "is_active": row.is_active}
            for row in _bounded(rows)
        ],
    }


# ---------------------------------------------------------------------------
# Write tools (pending action + confirm)
# ---------------------------------------------------------------------------


def write_create_request(user, args):
    """Create a request (draft or submitted). Args per the project's own
    draft APIs: request_type_id, title, details, and submit=True to send it
    in one shot. Executed through reqs.services.create_draft (+ the submit
    service) — the same path the UI's own form takes."""
    request_type = args.get("request_type_id")
    if request_type is None or not isinstance(request_type, int) or isinstance(request_type, bool):
        return {
            "error": "validation_error",
            "field": "request_type_id",
            "message": "request_type_id (integer) is required.",
        }
    title = str(args.get("title") or "").strip()
    if not title:
        return {"error": "validation_error", "field": "title", "message": "title is required."}
    from reqs.models import RequestType

    if not RequestType.objects.filter(pk=request_type, is_active=True).exists():
        return {"error": "validation_error", "field": "request_type_id", "message": "Unknown or inactive request type."}
    return {
        "validated": {
            "request_type_id": request_type,
            "title": title,
            "details": str(args.get("details") or ""),
            "submit": bool(args.get("submit", False)),
        }
    }


def _execute_create_request(user, validated):
    from reqs.services import create_draft
    from reqs.models import RequestType

    draft = create_draft(
        requester=user,
        request_type=RequestType.objects.get(pk=validated["request_type_id"]),
        title=validated["title"],
        details=validated["details"],
    )
    result = {
        "request_id": str(draft.pk),
        "status": draft.status,
    }
    if validated.get("submit"):
        from reqs.submission_services import (
            SubmissionError,
            VersionConflict as SubmitVersionConflict,
            submit_request,
        )

        try:
            submitted = submit_request(requester=user, request_obj=draft, version=draft.version)
            result["status"] = submitted.status
        except SubmissionError as exc:
            result["submit_result"] = f"not submitted ({exc.code}: {exc.field})"
        except SubmitVersionConflict:
            result["submit_result"] = "not submitted (version_conflict)"
        except PermissionError:
            # State moved under us (DRAFT was no longer submittable on commit).
            result["submit_result"] = "not submitted (state conflict)"
    return {"ok": True, **result}


def write_decide_request(user, args):
    return _validate_decision_args(args, "request")


def _validate_decision_args(args, target):
    from reqs.serializers import DECISION_ACTIONS  # shared action vocabulary

    object_id = args.get(f"{target}_id")
    if not object_id or not isinstance(object_id, str):
        return {"error": "validation_error", "field": f"{target}_id", "message": f"{target}_id (string uuid) is required."}
    action = args.get("action")
    if action not in DECISION_ACTIONS:
        return {"error": "validation_error", "field": "action", "message": f"action must be one of {list(DECISION_ACTIONS)}."}
    comment = str(args.get("comment") or "")
    if action in ("reject", "return") and not comment.strip():
        return {"error": "validation_error", "field": "comment", "message": "a non-blank comment is required for reject/return."}
    return {"validated": {f"{target}_id": object_id, "action": action, "comment": comment}}


def _execute_decide_request(user, validated):
    from reqs.decision_services import (
        DecisionStateError,
        IdempotencyConflict,
        IdempotencyReplay,
        VersionConflict,
        decide_request,
    )
    from django.http import Http404

    request_obj = EmployeeRequest.objects.filter(pk=validated["request_id"]).first()
    if request_obj is None:
        raise Http404("request not found")
    from hashlib import sha256
    from uuid import uuid4

    key = str(uuid4())
    key_hash = sha256(key.encode()).hexdigest()
    payload_hash = sha256(
        f"{request_obj.pk}:{request_obj.version}:{validated['action']}:{validated['comment']}".encode()
    ).hexdigest()
    decided = decide_request(
        reviewer=user,
        request_obj=request_obj,
        action=validated["action"],
        comment=validated["comment"],
        version=request_obj.version,
        key_hash=key_hash,
        payload_hash=payload_hash,
    )
    return {"ok": True, "request_id": str(decided.pk), "status": decided.status}


def write_decide_timesheet(user, args):
    """Decide a timesheet (approve/reject/return). Authorization is enforced
    inside timesheets.review_services.decide_timesheet under the lock."""
    object_id = args.get("timesheet_id")
    if not object_id or not isinstance(object_id, str):
        return {"error": "validation_error", "field": "timesheet_id", "message": "timesheet_id (string uuid) is required."}
    action = args.get("action")
    from reqs.serializers import DECISION_ACTIONS

    if action not in DECISION_ACTIONS:
        return {"error": "validation_error", "field": "action", "message": f"action must be one of {list(DECISION_ACTIONS)}."}
    comment = str(args.get("comment") or "")
    if action in ("reject", "return") and not comment.strip():
        return {"error": "validation_error", "field": "comment", "message": "a non-blank comment is required for reject/return."}
    return {"validated": {"timesheet_id": object_id, "action": action, "comment": comment}}


def _execute_decide_timesheet(user, validated):
    from timesheets.models import Timesheet
    from timesheets.review_services import (
        DecisionStateError,
        IdempotencyConflict,
        IdempotencyReplay,
        VersionConflict,
        decide_timesheet,
    )
    from django.http import Http404
    from hashlib import sha256
    from uuid import uuid4

    sheet = Timesheet.objects.filter(pk=validated["timesheet_id"]).first()
    if sheet is None:
        raise Http404("timesheet not found")
    key = str(uuid4())
    key_hash = sha256(key.encode()).hexdigest()
    payload_hash = sha256(
        f"{sheet.pk}:{sheet.version}:{validated['action']}:{validated['comment']}".encode()
    ).hexdigest()
    decided = decide_timesheet(
        reviewer=user,
        sheet=sheet,
        action=validated["action"],
        comment=validated["comment"],
        version=sheet.version,
        key_hash=key_hash,
        payload_hash=payload_hash,
    )
    return {"ok": True, "timesheet_id": str(decided.pk), "status": decided.status}


def write_submit_timesheet(user, args):
    """Submit one of the caller's OWN timesheets. Owner-scope is enforced
    twice: the arg lookup here is employee=user, and the service re-checks."""
    object_id = args.get("timesheet_id")
    if not object_id or not isinstance(object_id, str):
        return {"error": "validation_error", "field": "timesheet_id", "message": "timesheet_id (string uuid) is required."}
    sheet = Timesheet.objects.filter(pk=object_id, employee=user).first()
    if sheet is None:
        return {"error": "validation_error", "field": "timesheet_id", "message": "timesheet not found among your timesheets."}
    version = args.get("version")
    if version is None:
        version = sheet.version
    if not isinstance(version, int) or isinstance(version, bool):
        return {"error": "validation_error", "field": "version", "message": "version must be an integer."}
    return {"validated": {"timesheet_id": object_id, "version": version}}


def _execute_submit_timesheet(user, validated):
    from timesheets.models import Timesheet
    from timesheets.correction_services import (
        IdempotencyConflict as SubmitIdempotencyConflict,
        IdempotencyReplay as SubmitIdempotencyReplay,
        SubmitStateError,
        VersionConflict as SubmitVersionConflict,
        submit_idempotency_fingerprint,
        submit_timesheet,
    )
    from django.http import Http404
    from uuid import uuid4

    sheet = Timesheet.objects.filter(pk=validated["timesheet_id"], employee=user).first()
    if sheet is None:
        raise Http404("timesheet not found")
    key = str(uuid4())
    key_hash, payload_hash = submit_idempotency_fingerprint(
        key=key, timesheet_id=sheet.pk, version=validated["version"]
    )
    try:
        submitted = submit_timesheet(
            employee=user,
            sheet=sheet,
            version=validated["version"],
            key_hash=key_hash,
            payload_hash=payload_hash,
        )
    except SubmitIdempotencyReplay as exc:
        submitted = Timesheet.objects.get(pk=exc.snapshot["timesheet_id"])
    return {"ok": True, "timesheet_id": str(submitted.pk), "status": submitted.status}


def write_create_task(user, args):
    """Create a task.

    The backend has no tasks app yet — no Task model, no service, no
    permission gate. Refusing honestly (never faking an object id) is the
    only correct behavior; the frontend's task screen is mock-only today.
    """
    return {
        "error": "unsupported",
        "message": "Tasks are not implemented in the backend yet; the assistant cannot create one.",
    }


def write_clock_in(user, args):
    """Clock in/out is an attendance-domain write.

    The backend has no attendance app or models — attendance pages are mock
    data on the frontend. Refusing honestly, never fabricating an event.
    """
    return {
        "error": "unsupported",
        "message": "Attendance clock endpoints are not implemented in the backend yet; the assistant cannot record one.",
    }


WRITE_TOOLS = {
    "create_request": (write_create_request, _execute_create_request),
    "submit_timesheet": (write_submit_timesheet, _execute_submit_timesheet),
    "decide_request": (write_decide_request, _execute_decide_request),
    "decide_timesheet": (write_decide_timesheet, _execute_decide_timesheet),
    "create_task": (write_create_task, None),
    "clock_in": (write_clock_in, None),
}

READ_TOOLS = {
    "read_my_requests": read_my_requests,
    "read_request_types": read_request_types,
    "read_my_timesheets": read_my_timesheets,
    "read_my_leave_balance": read_my_leave_balance,
    "read_my_tasks": read_my_tasks,
    "read_my_attendance": read_my_attendance,
    "read_review_queue": read_review_queue,
    "read_employee_directory": read_employee_directory,
    "read_departments": read_departments,
}

ALL_TOOL_NAMES = sorted(READ_TOOLS) + sorted(WRITE_TOOLS)


def _parameters(*, required=None, properties=None):
    return {
        "type": "function",
        "function": {
            "name": "",
            "description": "",
            "parameters": {
                "type": "object",
                "properties": properties or {},
                "required": required or [],
            },
        },
    }


READ_TOOL_SPECS = [
    {
        "type": "function",
        "function": {
            "name": "read_my_requests",
            "description": "List my (the signed-in user's) own requests.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_request_types",
            "description": (
                "List the active request types (id + name) so you can resolve a "
                "type by NAME yourself. ALWAYS call this before creating a "
                "request; never ask the user for a numeric type id."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_my_timesheets",
            "description": "List my own weekly timesheets.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_my_leave_balance",
            "description": (
                "My leave usage per leave type: how many requests of each leave "
                "type I have had APPROVED. Entitlements are not configured in "
                "this system, so no remaining figure exists — say that plainly."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_my_tasks",
            "description": "My tasks.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_my_attendance",
            "description": "My time entries (attendance derivations).",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_review_queue",
            "description": "My scoped review queue (managers and HR only).",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_employee_directory",
            "description": "The employee directory (HR only).",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_departments",
            "description": "The departments (HR only).",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]

WRITE_TOOL_SPECS = [
    {
        "type": "function",
        "function": {
            "name": "create_request",
            "description": (
                "Create a request for the signed-in user, optionally submitting it "
                "in the same step. THIS CHANGES DATA: the caller must be asked for "
                "explicit confirmation before it runs."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "request_type_id": {"type": "integer", "description": "The active RequestType id."},
                    "title": {"type": "string"},
                    "details": {"type": "string"},
                    "submit": {
                        "type": "boolean",
                        "description": "Also submit the draft when True.",
                    },
                },
                "required": ["request_type_id", "title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "submit_timesheet",
            "description": (
                "Submit one of the CALLER'S OWN timesheets (DRAFT/RETURNED -> "
                "SUBMITTED). THIS CHANGES DATA and must be confirmed."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "timesheet_id": {"type": "string"},
                    "version": {"type": "integer"},
                },
                "required": ["timesheet_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "decide_request",
            "description": (
                "Decide (approve/reject/return) a request in the caller's review "
                "scope. THIS CHANGES DATA and must be confirmed. reject/return "
                "require a non-blank comment."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "request_id": {"type": "string"},
                    "action": {"type": "string", "enum": ["approve", "reject", "return"]},
                    "comment": {"type": "string"},
                },
                "required": ["request_id", "action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "decide_timesheet",
            "description": (
                "Decide (approve/reject/return) a timesheet in the caller's review "
                "scope. THIS CHANGES DATA and must be confirmed."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "timesheet_id": {"type": "string"},
                    "action": {"type": "string", "enum": ["approve", "reject", "return"]},
                    "comment": {"type": "string"},
                },
                "required": ["timesheet_id", "action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_task",
            "description": "Create a task (not available in the backend yet).",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clock_in",
            "description": "Record attendance clock in/out (not available in the backend yet).",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]

ALL_TOOL_SPECS = READ_TOOL_SPECS + WRITE_TOOL_SPECS

SYSTEM_PROMPT = (
    "أنت «مدام عفاف»، مساعدة شؤون العاملين داخل تطبيق هي فوضى؟. "
    "You answer in the user's language (Arabic default). "
    "You may freely run READ tools for the signed-in user. "
    "RULES: "
    "(1) When the user asks for a leave balance, call read_my_leave_balance "
    "and quote ITS REAL NUMBERS (approved-request counts per leave type). "
    "Never say the organization does not track anything without calling it; "
    "the only honest gap is that entitlements are not configured, which the "
    "tool itself reports. "
    "(2) When the user wants a request of some TYPE (e.g. «إجازة اعتيادية»), "
    "call read_request_types FIRST and resolve the type by NAME yourself. "
    "NEVER ask the user for a request-type id; if read_request_types returns "
    "an empty list, tell them HR must define the request types first. "
    "(3) You may format replies in Markdown (bold **…**, lists) — the chat "
    "renders it. "
    "Every action that CHANGES data (create_request, submit_timesheet, "
    "decide_request, decide_timesheet) must be offered as a tool call so the "
    "system shows a confirmation card; NEVER claim to have performed a write "
    "yourself. If a tool reports an error, tell the user honestly what it said."
)
