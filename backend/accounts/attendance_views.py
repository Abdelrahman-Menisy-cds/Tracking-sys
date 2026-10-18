"""Attendance: clock in / clock out, and the day derived from the active schedule.

The page was a shell: the module that resolved schedules and derived days lived in
the mock layer that was deleted, so the clock-in stayed disabled with
«لا يوجد جدول مؤكد من الخادم بعد». This reads the real WorkSchedule that the
organisation settings already manage, records real events, and derives the day from
the two.

Nothing is invented: with no active schedule the answer says so (`schedule: null`)
rather than fabricating a working day.
"""
from datetime import datetime, timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import AttendanceEvent, WorkSchedule
from accounts.permissions import IsAuthenticated401


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


def _day_payload(user, day):
    """The day as the UI needs it: schedule window, events, derived state."""
    company = user.company
    schedule = _active_schedule(company)
    events = list(
        AttendanceEvent.objects.filter(company=company, user=user, occurred_at__date=day)
        .order_by("occurred_at")
    )

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


class AttendanceTodayView(APIView):
    """GET /api/v1/attendance/today - the caller's own day."""

    permission_classes = [IsAuthenticated401]

    def get(self, request):
        return Response({"data": _day_payload(request.user, _cairo_today())})


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
