"""Attendance: clock in / clock out, the day derived from the active schedule.

The page was a shell: the module that resolved schedules and derived days lived in
the mock layer that was deleted, so the clock-in stayed disabled with
«لا يوجد جدول مؤكد من الخادم بعد». This reads the real WorkSchedule that the
organisation settings already manage, records real events, and derives the day from
the two.

Nothing is invented: with no active schedule the answer says so (`schedule: null`)
rather than fabricating a working day.

Beyond today, the same derivation powers the caller's own history (a range of
days) and HR's daily snapshot (the whole company for one day). All three call
``_derive_day`` — one derivation, no second source of truth, and no stored
status to drift when a schedule changes or an event is corrected.
"""
from collections import defaultdict
from datetime import datetime, timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import AttendanceEvent, User, WorkSchedule
from accounts.permissions import IsAuthenticated401, IsHR
from config.api import AttendanceHistoryPagination, error_payload

#: The states a derived day may carry; history and snapshot share this list.
DAY_STATES = ("PRESENT", "ABSENT", "REST_DAY", "INCOMPLETE", "NO_SCHEDULE")

#: The most days one history request may span, so the work stays bounded.
MAX_HISTORY_DAYS = 366

#: The window used when the caller supplies neither bound.
DEFAULT_HISTORY_DAYS = 30


def _active_schedule(company):
    """The one schedule in force for the company, or None."""
    return (
        WorkSchedule.objects.filter(company=company, is_active=True)
        .prefetch_related("days")
        .first()
    )


def _cairo_today():
    """The business day, in the organisation's zone rather than UTC."""
    return timezone.localtime(timezone.now()).date()


def _derive_day(day, schedule, events):
    """The day's schedule window and state from the schedule and its events.

    THE one derivation: the today payload, the history rows and the HR
    snapshot all call it, so a schedule change or a corrected event moves
    every surface at once. Nothing is stored.
    """
    window = None
    state = "NO_SCHEDULE"
    if schedule is not None:
        # Python weekday(): Monday=0. The schedule stores Sunday=0.
        weekday = (day.weekday() + 1) % 7
        rule = next((d for d in schedule.days.all() if d.weekday == weekday), None)
        if rule is None or not rule.is_working_day:
            state = "REST_DAY"
        else:
            window = {
                "start_time": rule.start_time,
                "end_time": rule.end_time,
                "break_minutes": rule.break_minutes,
            }
            state = "PRESENT" if events else "ABSENT_CANDIDATE"
    return window, state


def _day_payload(user, day):
    """The day as the UI needs it: schedule window, events, derived state."""
    schedule = _active_schedule(user.company)
    events = list(
        AttendanceEvent.objects.filter(company=user.company, user=user, occurred_at__date=day)
        .order_by("occurred_at")
    )
    window, state = _derive_day(day, schedule, events)

    return {
        "date": day,
        "schedule": (
            {"id": schedule.id, "name": schedule.name, "window": window}
            if schedule is not None
            else None
        ),
        "state": state,
        "events": [
            {"id": e.id, "kind": e.kind, "occurred_at": e.occurred_at, "note": e.note}
            for e in events
        ],
        "can_clock_in": state == "ABSENT_CANDIDATE" and not any(e.kind == "CLOCK_IN" for e in events),
        "can_clock_out": any(e.kind == "CLOCK_IN" for e in events)
        and not any(e.kind == "CLOCK_OUT" for e in events),
    }


def _history_row(day, schedule, events):
    """One history day: first in, last out, worked minutes, derived state.

    The state names the day the way the history screen reads it:
    ``ABSENT_CANDIDATE`` (a scheduled day with no events) becomes ABSENT, and
    a clock-in without a clock-out is INCOMPLETE rather than a false PRESENT.
    Worked minutes exist only when both ends are present: the span between the
    first clock-in and the last clock-out, minus the schedule's break.
    """
    window, state = _derive_day(day, schedule, events)
    first_in = next((e for e in events if e.kind == "CLOCK_IN"), None)
    last_out = next((e for e in reversed(events) if e.kind == "CLOCK_OUT"), None)

    if state == "ABSENT_CANDIDATE":
        state = "ABSENT"
    elif state == "PRESENT" and (first_in is None or last_out is None):
        state = "INCOMPLETE"

    worked_minutes = None
    if first_in is not None and last_out is not None:
        span = int((last_out.occurred_at - first_in.occurred_at).total_seconds() // 60)
        worked_minutes = max(span - (window["break_minutes"] if window else 0), 0)

    return {
        "date": day,
        "first_clock_in": first_in.occurred_at if first_in is not None else None,
        "last_clock_out": last_out.occurred_at if last_out is not None else None,
        "worked_minutes": worked_minutes,
        "break_minutes": window["break_minutes"] if window else None,
        "state": state,
    }


class _BadRange(Exception):
    """A from/to the endpoint refuses, carrying the shared error envelope fields."""

    def __init__(self, fields):
        self.fields = fields


def _parse_date(value):
    return datetime.strptime(value, "%Y-%m-%d").date()


def _resolve_range(params, today):
    """The inclusive from/to, defaulting to the last DEFAULT_HISTORY_DAYS days."""
    raw_from = params.get("from")
    raw_to = params.get("to")
    fields = {}
    date_from = date_to = None
    if raw_from:
        try:
            date_from = _parse_date(raw_from)
        except (TypeError, ValueError):
            fields["from"] = ["Use YYYY-MM-DD."]
    if raw_to:
        try:
            date_to = _parse_date(raw_to)
        except (TypeError, ValueError):
            fields["to"] = ["Use YYYY-MM-DD."]
    if fields:
        raise _BadRange(fields)
    if date_to is None:
        date_to = today
    if date_from is None:
        date_from = date_to - timedelta(days=DEFAULT_HISTORY_DAYS - 1)
    if date_from > date_to:
        raise _BadRange({"from": ["'from' must not be after 'to'."]})
    if (date_to - date_from).days + 1 > MAX_HISTORY_DAYS:
        raise _BadRange({"from": [f"The range may span at most {MAX_HISTORY_DAYS} days."]})
    return date_from, date_to


def _events_by_date(user, date_from, date_to):
    """The caller's events in the range, grouped by their local day.

    One query for the whole range instead of one per day; grouping in Python
    keeps the day boundary identical to the ``__date`` lookup the today
    payload uses.
    """
    grouped = defaultdict(list)
    events = AttendanceEvent.objects.filter(
        company=user.company,
        user=user,
        occurred_at__date__gte=date_from,
        occurred_at__date__lte=date_to,
    ).order_by("occurred_at")
    for event in events:
        grouped[timezone.localtime(event.occurred_at).date()].append(event)
    return grouped


def _days_newest_first(date_from, date_to):
    span = (date_to - date_from).days
    return [date_to - timedelta(days=offset) for offset in range(span + 1)]


class AttendanceTodayView(APIView):
    """GET /api/v1/attendance/today - the caller's own day."""

    permission_classes = [IsAuthenticated401]

    def get(self, request):
        return Response({"data": _day_payload(request.user, _cairo_today())})


class AttendanceHistoryView(APIView):
    """GET /api/v1/attendance/history - the caller's own derived days.

    Query: ``from``/``to`` (YYYY-MM-DD, inclusive; default last 30 days),
    ``status`` (one derived state, or ALL), ``page``/``page_size``. Every day
    in the range is derived from the active schedule plus that day's events,
    then filtered, then paginated — so the count the UI shows is the count of
    the rows it was asked for, never a page-shaped lie.
    """

    permission_classes = [IsAuthenticated401]

    def get(self, request):
        try:
            date_from, date_to = _resolve_range(request.query_params, _cairo_today())
        except _BadRange as exc:
            return Response(
                error_payload(
                    code="validation_error",
                    message="Validation failed.",
                    fields=exc.fields,
                    request=request,
                ),
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        status_filter = request.query_params.get("status", "")
        if status_filter and status_filter != "ALL" and status_filter not in DAY_STATES:
            return Response(
                error_payload(
                    code="validation_error",
                    message="Validation failed.",
                    fields={"status": [f"Unknown state; use one of {', '.join(DAY_STATES)}."]},
                    request=request,
                ),
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        schedule = _active_schedule(request.user.company)
        grouped = _events_by_date(request.user, date_from, date_to)
        rows = [
            _history_row(day, schedule, grouped.get(day, []))
            for day in _days_newest_first(date_from, date_to)
        ]
        if status_filter and status_filter != "ALL":
            rows = [row for row in rows if row["state"] == status_filter]

        paginator = AttendanceHistoryPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        return paginator.get_paginated_response(page)


class AttendanceSnapshotView(APIView):
    """GET /api/v1/attendance/snapshot - HR's whole-company day.

    HR scope only (IsHR): an authenticated non-HR caller gets the same 404
    envelope as an unknown resource, so no employee's rows are disclosed and
    the surface itself is not advertised. Every active employee of the
    caller's company is answered with their derived state for ``date``
    (default today) and the counts per state, so the overview panel can show
    the buckets without deriving anything itself.
    """

    permission_classes = [IsAuthenticated401, IsHR]

    def get(self, request):
        day = _cairo_today()
        raw_date = request.query_params.get("date")
        if raw_date:
            try:
                day = _parse_date(raw_date)
            except (TypeError, ValueError):
                return Response(
                    error_payload(
                        code="validation_error",
                        message="Validation failed.",
                        fields={"date": ["Use YYYY-MM-DD."]},
                        request=request,
                    ),
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )

        company = request.user.company
        schedule = _active_schedule(company)

        events_by_user = defaultdict(list)
        events = AttendanceEvent.objects.filter(company=company, occurred_at__date=day).order_by(
            "occurred_at"
        )
        for event in events:
            events_by_user[event.user_id].append(event)

        # The same workforce the employee list exposes: one company, active,
        # employees and managers only — HR actors are not their own subjects.
        employees = (
            User.objects.filter(
                company=company, is_active=True, is_staff=False, is_superuser=False
            )
            .exclude(role=User.Role.HR)
            .order_by("id")
        )

        counts = {state: 0 for state in DAY_STATES}
        rows = []
        for employee in employees:
            row = _history_row(day, schedule, events_by_user.get(employee.id, []))
            row["user"] = {
                "id": employee.id,
                "full_name": employee.full_name,
                "email": employee.email,
            }
            counts[row["state"]] += 1
            rows.append(row)

        return Response(
            {
                "data": {
                    "date": day,
                    "schedule": (
                        {"id": schedule.id, "name": schedule.name}
                        if schedule is not None
                        else None
                    ),
                    "counts": counts,
                    "employees": rows,
                }
            }
        )


class AttendanceEventView(APIView):
    """POST /api/v1/attendance/clock-in | clock-out - record one event.

    The caller writes only their own events, and only when the day allows it: a
    rest day or a day with no schedule in force is refused with the reason, so the
    UI never shows a control that cannot work.
    """

    permission_classes = [IsAuthenticated401]

    def post(self, request, kind):
        # The URL carries the kebab form the UI uses (`clock-in`); the model
        # stores the enum. Accept both rather than making the client speak enums.
        kind = {"clock-in": "CLOCK_IN", "clock-out": "CLOCK_OUT"}.get(kind, kind)
        if kind not in ("CLOCK_IN", "CLOCK_OUT"):
            return Response(
                {"error": {"code": "bad_kind", "message": "Unknown event kind.", "fields": {}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        day = _cairo_today()
        payload = _day_payload(request.user, day)
        allowed = payload["can_clock_in"] if kind == "CLOCK_IN" else payload["can_clock_out"]
        if not allowed:
            return Response(
                {
                    "error": {
                        "code": "not_allowed",
                        "message": "The day does not allow this action.",
                        "fields": {"state": [payload["state"]]},
                    }
                },
                status=status.HTTP_409_CONFLICT,
            )

        event = AttendanceEvent.objects.create(
            company=request.user.company, user=request.user, kind=kind, occurred_at=timezone.now()
        )
        return Response(
            {"data": {"id": event.id, "kind": event.kind, "occurred_at": event.occurred_at}},
            status=status.HTTP_201_CREATED,
        )
