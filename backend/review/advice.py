"""«رأي المساعد» — the rule verdict and the assistant's Arabic prose (review queue).

TWO HALVES, ONE OF THEM OPTIONAL. The VERDICT is derived by deterministic
server-side RULES over data that already exists, so it is always present and
never depends on a network call. The Arabic EXPLANATION is the assistant's:
when the reviewer has no configured/unreachable assistant the payload still
carries the rule verdict and its cited facts, and the explanation is marked
ABSENT — never a fabricated sentence. The payload says plainly which of the
two the caller got (``explanation.available``).

Each rule returns a FACT (the numbers it was derived from) and a SUPPORT
stance — ``approve`` / ``reject`` / ``warn`` / ``info`` — and the overall
verdict is derived from those stances:

    any reject  -> RECOMMEND_REJECT
    else any warn -> NEEDS_ATTENTION
    else any approve -> RECOMMEND_APPROVE
    else -> NO_OPINION

The rules:

  balance   enough leave balance for THIS request. The balance comes from
            ``leavebalances`` (its own derived ``remaining`` = entitled +
            carried_over − used), never recomputed here. The request is read
            as consuming one day per calendar day it names (or one unit when
            it names no period, since the backend's ``used_days`` counts
            approved REQUESTS). Not a leave type -> the rule does not apply.
  overlap   another APPROVED request of the same requester whose period
            overlaps this one — a real conflict, reject-leaning.
  coverage  how many OTHER people in the requester's department already have
            APPROVED leave covering the same dates — a WARNING, never a veto.
  hr        whether the request type needs HR approval at this stage — a fact.

WHERE THE PERIOD COMES FROM. ``EmployeeRequest`` carries no structured dates:
the leave period travels as free text inside ``title``/``details``
(leavebalances.services documents exactly this). The period is therefore read
from that free text (ISO ``YYYY-MM-DD``, Arabic-Indic digits accepted), and
when the text names no dates the overlap/coverage rules report honestly that
the period is unknown and were NOT checked — never a guessed span.
"""
import json
import re
from datetime import date

from accounts.models import EmployeeProfile
from reqs.models import EmployeeRequest
from review import scope as review_scope

# --- verdicts -------------------------------------------------------------
VERDICT_RECOMMEND_APPROVE = "RECOMMEND_APPROVE"
VERDICT_RECOMMEND_REJECT = "RECOMMEND_REJECT"
VERDICT_NEEDS_ATTENTION = "NEEDS_ATTENTION"
VERDICT_NO_OPINION = "NO_OPINION"

VERDICT_LABELS = {
    VERDICT_RECOMMEND_APPROVE: {"ar": "يوصى بالاعتماد", "en": "Recommend approve"},
    VERDICT_RECOMMEND_REJECT: {"ar": "يوصى بالرفض", "en": "Recommend reject"},
    VERDICT_NEEDS_ATTENTION: {"ar": "يحتاج انتباه", "en": "Needs attention"},
    VERDICT_NO_OPINION: {"ar": "لا يوجد رأي", "en": "No opinion"},
}

# --- support stances ------------------------------------------------------
SUPPORTS_APPROVE = "approve"
SUPPORTS_REJECT = "reject"
SUPPORTS_WARN = "warn"
SUPPORTS_INFO = "info"

#: How many colleagues already on approved leave over the same dates makes the
#: coverage rule WARN. It is a warning, never a veto, so it never rejects.
COVERAGE_WARNING_THRESHOLD = 1

#: The advice is a read: it never fires once per row. The batch endpoint is
#: bounded to this many ids in one call.
MAX_BATCH = 50

#: The assistant answers the whole batch as ONE JSON array, and a long array is
#: where it stops being JSON: measured live, 7 rows parsed and 25 came back
#: unusable, so every row reported «شرح المساعد غير متاح» while the assistant was
#: working fine. The rows are asked for in chunks this size, so a long queue is
#: explained as reliably as a short one.
BATCH_CHUNK = 8

_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_DATE_RE = re.compile(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})")


def parse_request_period(request_obj):
    """The period read from the request's free text, or None.

    ``EmployeeRequest`` stores no structured dates; the leave period lives as
    prose in ``title``/``details``. Every ISO-shaped date found is collected
    and the period is [earliest, latest] (a single date is a one-day period).
    Returns ``{"start", "end", "days", "source"}`` or ``None`` when the text
    names no date — the caller must then say the period is unknown, never
    guess one.
    """
    text = f"{request_obj.title or ''} {request_obj.details or ''}".translate(_ARABIC_DIGITS)
    found = []
    for match in _DATE_RE.finditer(text):
        try:
            found.append(date(int(match.group(1)), int(match.group(2)), int(match.group(3))))
        except ValueError:
            continue
    if not found:
        return None
    start, end = min(found), max(found)
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "days": (end - start).days + 1,
        "source": "request_text",
    }


def _fact(rule, supports, fact, reason_ar, reason_en):
    return {
        "rule": rule,
        "supports": supports,
        "fact": fact,
        "reason_ar": reason_ar,
        "reason_en": reason_en,
    }


def _number(value):
    """Render a derived number without a spurious ``.0`` (21.0 -> '21')."""
    if value is None:
        return "0"
    return f"{value:g}"


def _leave_type_for(request_obj):
    """The request's type WHEN it is a leave type (the leavebalances predicate).

    The one definition of "leave type" lives in ``leavebalances.services``;
    a request whose type is not a leave type simply has no balance to check.
    """
    from leavebalances.services import leave_types

    return leave_types(request_obj.company).filter(pk=request_obj.request_type_id).first()


def _balance_fact(request_obj, period):
    leave_type = _leave_type_for(request_obj)
    request_type = request_obj.request_type
    if leave_type is None:
        return _fact(
            "balance",
            SUPPORTS_INFO,
            {"is_leave_type": False, "request_type_name": request_type.name},
            f"نوع الطلب «{request_type.name}» ليس إجازة، فلا ينطبق عليه رصيد الإجازات.",
            f"Request type '{request_type.name}' is not a leave type, so no leave balance applies.",
        )

    from leavebalances.services import employee_leave_balance

    submitted = request_obj.submitted_at or request_obj.created_at
    year = submitted.year
    balance = employee_leave_balance(
        employee=request_obj.requester, request_type=leave_type, year=year
    )
    requested_units = period["days"] if period else 1
    fact = {
        "is_leave_type": True,
        "request_type_name": leave_type.name,
        "year": year,
        "requested_units": requested_units,
        "entitled_days": balance["entitled_days"],
        "carried_over_days": balance["carried_over_days"],
        "used_days": balance["used_days"],
        "remaining_days": balance["remaining_days"],
        "is_configured": balance["is_configured"],
    }

    if not balance["is_configured"]:
        return _fact(
            "balance",
            SUPPORTS_WARN,
            fact,
            f"لا يوجد رصيد مُعرّف لإجازة «{leave_type.name}» لعام {year}، فلا يمكن التحقق من كفاية الرصيد.",
            f"No balance is configured for '{leave_type.name}' in {year}, so sufficiency cannot be verified.",
        )

    remaining = balance["remaining_days"]
    if remaining >= requested_units:
        return _fact(
            "balance",
            SUPPORTS_APPROVE,
            fact,
            f"الرصيد المتبقي {_number(remaining)} يوم يغطي هذا الطلب ({requested_units} يوم).",
            f"Remaining balance {_number(remaining)} days covers this request ({requested_units} days).",
        )
    return _fact(
        "balance",
        SUPPORTS_REJECT,
        fact,
        f"الرصيد المتبقي {_number(remaining)} يوم أقل من المطلوب ({requested_units} يوم)؛ الرصيد لا يكفي.",
        f"Remaining balance {_number(remaining)} days is below the {requested_units} requested; the balance is insufficient.",
    )


def _period_bounds(period):
    return date.fromisoformat(period["start"]), date.fromisoformat(period["end"])


def _overlaps(period_a, period_b):
    a_start, a_end = _period_bounds(period_a)
    b_start, b_end = _period_bounds(period_b)
    return b_start <= a_end and b_end >= a_start


def _overlap_fact(request_obj, period):
    if period is None:
        return _fact(
            "overlap",
            SUPPORTS_INFO,
            {"period_known": False, "count": 0, "overlapping": []},
            "الطلب لا يذكر تواريخ، فلم يُفحص التعارض مع إجازة معتمدة أخرى.",
            "The request names no dates, so overlap with another approved request was not checked.",
        )

    others = (
        EmployeeRequest.objects.filter(
            company=request_obj.company,
            requester_id=request_obj.requester_id,
            status=EmployeeRequest.Status.APPROVED,
        )
        .exclude(pk=request_obj.pk)
        .select_related("request_type")
    )
    overlapping = []
    for other in others:
        other_period = parse_request_period(other)
        if other_period is None or not _overlaps(period, other_period):
            continue
        overlapping.append(
            {
                "id": str(other.pk),
                "title": other.title,
                "start": other_period["start"],
                "end": other_period["end"],
                "request_type_name": other.request_type.name,
            }
        )

    if overlapping:
        return _fact(
            "overlap",
            SUPPORTS_REJECT,
            {"period_known": True, "count": len(overlapping), "overlapping": overlapping},
            f"توجد {len(overlapping)} إجازة معتمدة أخرى لنفس الموظف تتقاطع مع هذه الفترة.",
            f"{len(overlapping)} other approved request(s) for the same employee overlap this period.",
        )
    return _fact(
        "overlap",
        SUPPORTS_APPROVE,
        {"period_known": True, "count": 0, "overlapping": []},
        "لا توجد إجازة معتمدة أخرى لنفس الموظف تتقاطع مع هذه الفترة.",
        "No other approved request for the same employee overlaps this period.",
    )


def _coverage_fact(request_obj, period):
    if period is None:
        return _fact(
            "coverage",
            SUPPORTS_INFO,
            {"period_known": False, "department_id": None, "count": 0, "colleagues": []},
            "الطلب لا يذكر تواريخ، فلم تُفحص تغطية القسم.",
            "The request names no dates, so department coverage was not checked.",
        )

    profile = EmployeeProfile.objects.filter(user_id=request_obj.requester_id).first()
    department_id = profile.department_id if profile is not None else None
    if department_id is None:
        return _fact(
            "coverage",
            SUPPORTS_INFO,
            {"period_known": True, "department_id": None, "count": 0, "colleagues": []},
            "الموظف غير مسند إلى قسم، فلا تُقاس تغطية القسم.",
            "The employee has no department, so coverage is not assessed.",
        )

    member_ids = list(
        EmployeeProfile.objects.filter(department_id=department_id, user__is_active=True)
        .exclude(user_id=request_obj.requester_id)
        .values_list("user_id", flat=True)
    )
    colleagues = {}
    if member_ids:
        others = (
            EmployeeRequest.objects.filter(
                company=request_obj.company,
                requester_id__in=member_ids,
                status=EmployeeRequest.Status.APPROVED,
            )
            .select_related("requester", "request_type")
        )
        for other in others:
            other_period = parse_request_period(other)
            if other_period is None or not _overlaps(period, other_period):
                continue
            colleagues[other.requester_id] = {
                "employee_id": str(other.requester_id),
                "name": other.requester.full_name or other.requester.email,
                "request_type_name": other.request_type.name,
            }

    count = len(colleagues)
    fact = {
        "period_known": True,
        "department_id": department_id,
        "count": count,
        "colleagues": list(colleagues.values()),
    }
    if count >= COVERAGE_WARNING_THRESHOLD:
        return _fact(
            "coverage",
            SUPPORTS_WARN,
            fact,
            f"لدى {count} من زملاء القسم إجازة معتمدة تغطي نفس الفترة؛ قد تتأثر التغطية.",
            f"{count} colleague(s) in the same department already have approved leave over the same period; coverage may be affected.",
        )
    return _fact(
        "coverage",
        SUPPORTS_INFO,
        fact,
        "لا يوجد زميل آخر في القسم بإجازة معتمدة تغطي نفس الفترة.",
        "No other colleague in the department has approved leave over the same period.",
    )


def _hr_fact(request_obj):
    request_type = request_obj.request_type
    if not request_type.requires_hr_approval:
        return _fact(
            "hr_approval",
            SUPPORTS_INFO,
            {"requires_hr_approval": False, "status": request_obj.status},
            "هذا النوع لا يتطلب اعتماد الموارد البشرية؛ اعتماد المدير نهائي.",
            "This type does not need HR approval; the manager's decision is final.",
        )
    if request_obj.status == EmployeeRequest.Status.PENDING_HR:
        return _fact(
            "hr_approval",
            SUPPORTS_INFO,
            {"requires_hr_approval": True, "status": request_obj.status},
            "هذا النوع يتطلب اعتماد الموارد البشرية، والطلب في مرحلة الموارد البشرية الآن.",
            "This type needs HR approval, and the request is at the HR stage now.",
        )
    return _fact(
        "hr_approval",
        SUPPORTS_INFO,
        {"requires_hr_approval": True, "status": request_obj.status},
        "هذا النوع يتطلب اعتماد الموارد البشرية؛ الاعتماد هنا يُحوّل الطلب إلى الموارد البشرية.",
        "This type needs HR approval; approving here routes the request to HR next.",
    )


def derive_verdict(facts):
    """The overall verdict from the rules' support stances (deterministic)."""
    supports = {fact["supports"] for fact in facts}
    if SUPPORTS_REJECT in supports:
        return VERDICT_RECOMMEND_REJECT
    if SUPPORTS_WARN in supports:
        return VERDICT_NEEDS_ATTENTION
    if SUPPORTS_APPROVE in supports:
        return VERDICT_RECOMMEND_APPROVE
    return VERDICT_NO_OPINION


def evaluate_rules(request_obj):
    """The rule half of the advice: period, cited facts, and the verdict."""
    period = parse_request_period(request_obj)
    facts = [
        _balance_fact(request_obj, period),
        _overlap_fact(request_obj, period),
        _coverage_fact(request_obj, period),
        _hr_fact(request_obj),
    ]
    verdict = derive_verdict(facts)
    return {
        "verdict": verdict,
        "verdict_label": VERDICT_LABELS[verdict],
        "period": period,
        "facts": facts,
    }


# ---------------------------------------------------------------------------
# The assistant's half: a short Arabic explanation of the facts.
# ---------------------------------------------------------------------------

ADVICE_SYSTEM_PROMPT = (
    "أنت «مدام عفاف»، مساعدة شؤون العاملين داخل تطبيق. تُعطى وقائع محسوبة على "
    "الخادم حول طلب مراجعة. اكتب للمراجع شرحًا عربيًا موجزًا في جملتين على "
    "الأكثر. لا تُضِف أي رقم أو واقعة غير موجودة في الوقائع المعطاة، ولا تُصدر "
    "قرارًا نيابة عن المراجع. أجب بالعربية فقط."
)


def _advice_prompt(request_obj, evaluated):
    lines = [
        f"العنوان: {request_obj.title}",
        f"النوع: {request_obj.request_type.name}",
        f"مقدم الطلب: {request_obj.requester.full_name or request_obj.requester.email}",
        f"الحالة: {request_obj.status}",
        "الوقائع:",
    ]
    for fact in evaluated["facts"]:
        lines.append(f"- {fact['reason_ar']}")
    lines.append(f"الخلاصة المحسوبة: {evaluated['verdict_label']['ar']}.")
    lines.append("اشرح هذه الوقائع للمراجع في جملتين بالعربية، دون إضافة أي معلومة جديدة.")
    return "\n".join(lines)


def _explanation_absent(reason, message):
    return {"available": False, "text_ar": None, "reason_unavailable": reason, "message": message}


def _config_for(user):
    """The reviewer's own assistant config, or None."""
    from accounts.models import AssistantConfig

    return AssistantConfig.objects.filter(user=user).first()


def assistant_explanation(user, request_obj, evaluated):
    """(text, meta) for ONE request — never fabricates an absent explanation."""
    from accounts.assistant_chat import ChatConfigError, assistant_prose
    from accounts.assistant_crypto import AssistantSecretError

    config = _config_for(user)
    if config is None or not config.is_configured:
        return None, _explanation_absent(
            "not_configured",
            "The assistant is not configured for this account, so no explanation is available.",
        )
    if not config.is_active:
        return None, _explanation_absent(
            "inactive", "The assistant is switched off for this account."
        )
    try:
        text = assistant_prose(user, config, ADVICE_SYSTEM_PROMPT, _advice_prompt(request_obj, evaluated))
    except ChatConfigError as error:
        return None, _explanation_absent(error.code, error.message)
    except AssistantSecretError as error:
        return None, _explanation_absent("key_unreadable", str(error))
    if not text.strip():
        return None, _explanation_absent("provider_error", "The assistant returned no text.")
    return text.strip(), {"available": True, "text_ar": text.strip(), "reason_unavailable": None, "message": None}


def advice_payload(user, request_obj, *, with_assistant=True):
    """The whole GET .../advice body for one request."""
    evaluated = evaluate_rules(request_obj)
    if with_assistant:
        text, meta = assistant_explanation(user, request_obj, evaluated)
    else:
        text, meta = None, _explanation_absent(
            "not_requested", "The assistant explanation was not requested for this call."
        )
    return assemble_payload(request_obj, evaluated, text, meta)


def assemble_payload(request_obj, evaluated, text, meta):
    """The advice body from an already-evaluated rule set and explanation."""
    return {
        "request_id": str(request_obj.pk),
        "verdict": evaluated["verdict"],
        "verdict_label": evaluated["verdict_label"],
        "period": evaluated["period"],
        "facts": evaluated["facts"],
        "explanation": {"available": meta["available"], "text_ar": text, "reason_unavailable": meta["reason_unavailable"], "message": meta["message"]},
    }


# ---------------------------------------------------------------------------
# Batch: one HTTP call for a whole page of the queue (never once per row).
# ---------------------------------------------------------------------------

def _batch_prompt(entries):
    lines = [
        "لديك عدة طلبات مراجعة، ولكل طلب وقائع محسوبة على الخادم.",
        "أعد مصفوفة JSON فقط، بلا أي نص خارجها، بعنصر لكل طلب بالشكل:",
        '[{"id": "<معرف الطلب>", "explanation": "<جملتان بالعربية>"}]',
        "لا تُضِف أرقامًا أو وقائع غير موجودة، ولا تُصدر قرارًا نيابة عن المراجع.",
        "",
    ]
    for request_obj, evaluated in entries:
        lines.append(f"معرف الطلب: {request_obj.pk}")
        lines.append(f"العنوان: {request_obj.title} · النوع: {request_obj.request_type.name}")
        for fact in evaluated["facts"]:
            lines.append(f"- {fact['reason_ar']}")
        lines.append(f"الخلاصة: {evaluated['verdict_label']['ar']}")
        lines.append("")
    return "\n".join(lines)


def _parse_batch_reply(text):
    """{request_id: explanation} from the model's reply, or {} when unusable."""
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return {}
    try:
        parsed = json.loads(text[start : end + 1])
    except (ValueError, TypeError):
        return {}
    if not isinstance(parsed, list):
        return {}
    result = {}
    for entry in parsed:
        if not isinstance(entry, dict):
            continue
        request_id = entry.get("id")
        explanation = entry.get("explanation")
        if isinstance(request_id, str) and isinstance(explanation, str) and explanation.strip():
            result[request_id] = explanation.strip()
    return result


def batch_explanations(user, entries):
    """One assistant call for many rows -> ({request_id: explanation}, absent_meta).

    An unconfigured / inactive / erroring assistant yields an empty map and the
    meta every row then carries (the explanation is marked ABSENT — never a
    fabricated sentence). The model's reply is parsed defensively: anything
    that is not the requested JSON array is discarded rather than guessed at.
    """
    from accounts.assistant_chat import ChatConfigError, assistant_prose
    from accounts.assistant_crypto import AssistantSecretError

    if not entries:
        return {}, _explanation_absent("not_requested", "No rows to explain.")
    config = _config_for(user)
    if config is None or not config.is_configured:
        return {}, _explanation_absent(
            "not_configured",
            "The assistant is not configured for this account, so no explanation is available.",
        )
    if not config.is_active:
        return {}, _explanation_absent("inactive", "The assistant is switched off for this account.")
    explanations: dict = {}
    for start in range(0, len(entries), BATCH_CHUNK):
        chunk = entries[start : start + BATCH_CHUNK]
        try:
            text = assistant_prose(user, config, ADVICE_SYSTEM_PROMPT, _batch_prompt(chunk))
        except ChatConfigError as error:
            # The credential is the same for every chunk: a failure here is not
            # per-row, so it is reported once for the whole batch.
            return explanations, _explanation_absent(error.code, error.message)
        except AssistantSecretError as error:
            return explanations, _explanation_absent("key_unreadable", str(error))
        explanations.update(_parse_batch_reply(text))
    return explanations, _explanation_absent(
        "provider_error", "The assistant returned no explanation for this row."
    )


def scoped_request(user, pk):
    """The request inside the caller's scope, or None (safe 404 upstream).

    The SAME scope queryset the queue and detail views use, so an out-of-scope
    id is simply absent — never an existence disclosure.
    """
    scoped = review_scope.scope_requests(user)
    try:
        return scoped.filter(pk=pk).select_related("requester", "request_type", "company").first()
    except (ValueError, TypeError):
        return None
