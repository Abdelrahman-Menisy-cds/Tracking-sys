"""Timesheet endpoints (Stories 3.1 + 3.2): owner-scoped lifecycle.

- POST   /api/v1/timesheets                        (create unique week + entries)
- GET    /api/v1/timesheets                        (requester's own sheets)
- GET    /api/v1/timesheets/{id}                   (owner-only detail)
- POST   /api/v1/timesheets/{id}/submit            (DRAFT/RETURNED -> SUBMITTED)
- PATCH  /api/v1/timesheets/{id}/entries/{entry_id} (correct one entry, DRAFT/RETURNED)
- DELETE /api/v1/timesheets/{id}/entries/{entry_id} (remove one entry, DRAFT/RETURNED)

Authorization, error envelope, idempotency-key handling, throttling, and CSRF
reuse the shared patterns (config.api.error_payload, MutationRateThrottle,
CsrfEnforcedSessionAuthentication) — no bespoke paths for this story.
Cross-user access is a uniform 404 (permission-matrix 404 policy); unauth 401;
CSRF 403; mutations throttled 60/min/user; GET unthrottled.
"""
from hashlib import sha256

from django.http import Http404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.throttles import MutationRateThrottle
from config.api import RequestPagination, error_payload

from . import serializers as ts
from . import review_services
from .models import TimeEntry, Timesheet
from .services import (
    DuplicateWeek,
    IdempotencyConflict,
    IdempotencyReplay,
    TimesheetError,
    create_timesheet,
)
from .correction_services import (
    IdempotencyConflict as SubmitIdempotencyConflict,
    IdempotencyReplay as SubmitIdempotencyReplay,
    SubmitStateError,
    VersionConflict as SubmitVersionConflict,
    delete_entry,
    edit_entry,
    submit_idempotency_fingerprint,
    submit_timesheet,
)


def _get_own_timesheet(user, pk):
    """Raise the same 404 for a missing sheet as for another user's sheet."""
    try:
        return Timesheet.objects.get(pk=pk, employee=user)
    except (Timesheet.DoesNotExist, ValueError):
        raise Http404


def _get_own_entry(sheet, entry_pk):
    """Raise the same 404 for a missing entry as for another sheet's entry."""
    try:
        return TimeEntry.objects.get(pk=entry_pk, timesheet=sheet)
    except (TimeEntry.DoesNotExist, ValueError):
        raise Http404


def _state_conflict_payload(message, field_message, request):
    return error_payload(
        code="state_conflict",
        message=message,
        fields={"status": [field_message]},
        request=request,
    )


def _version_conflict_payload(request):
    return error_payload(
        code="version_conflict",
        message="This timesheet changed since you last saw it. Reload and try again.",
        fields={"version": ["The provided version is stale."]},
        request=request,
    )


def _idempotency_conflict_payload(request):
    return error_payload(
        code="idempotency_conflict",
        message="This idempotency key was already used with a different payload.",
        fields={"idempotency_key": ["Key reused with different payload."]},
        request=request,
    )


def _validation_payload(exc: TimesheetError, request):
    return error_payload(
        code=exc.code,
        message=exc.message,
        fields={exc.field: [str(exc.message)]},
        request=request,
    )


def _duplicate_week_payload(request, existing: Timesheet):
    """Safe duplicate-week 409 body.

    The existing sheet reference (id, week_start) is included ONLY because the
    create request is owner-only; another employee can never reach this code
    path with someone else's sheet, and a nonexistent or unauthorized attempt
    receives 401/404 instead — never this payload.
    """
    return error_payload(
        code="duplicate_week",
        message="A timesheet already exists for this week.",
        fields={
            "week_start": [
                {
                    "existing_timesheet_id": str(existing.pk),
                    "existing_week_start": existing.week_start.isoformat(),
                }
            ]
        },
        request=request,
    )


class TimesheetListCreateView(APIView):
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request):
        paginator = RequestPagination()
        page = paginator.paginate_queryset(
            Timesheet.objects.filter(employee=request.user),
            request,
            view=self,
        )
        return paginator.get_paginated_response(ts.TimesheetSerializer(page, many=True).data)

    def post(self, request):
        idempotency_key = request.headers.get("Idempotency-Key", "").strip()
        if not idempotency_key:
            return Response(
                error_payload(
                    code="idempotency_key_required",
                    message="An Idempotency-Key header is required to create a timesheet.",
                    fields={"idempotency_key": ["Missing Idempotency-Key header."]},
                    request=request,
                ),
                status=422,
            )

        serializer = ts.TimesheetCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        week_start = serializer.validated_data["week_start"]
        entries = serializer.validated_data["entries"]

        payload_hash = sha256(
            f"{week_start.isoformat()}:{sorted((str(e['work_date']), e['duration_minutes'], e['unpaid_break_minutes'], e.get('description', '')) for e in entries)}".encode()
        ).hexdigest()
        key_hash = sha256(idempotency_key.encode()).hexdigest()

        try:
            sheet = create_timesheet(
                employee=request.user,
                week_start=week_start,
                entries=entries,
                key_hash=key_hash,
                payload_hash=payload_hash,
            )
        except IdempotencyReplay as exc:
            # Replay the stored committed response as 201 shape with the stored id.
            sheet = Timesheet.objects.get(pk=exc.snapshot["timesheet_id"])
        except IdempotencyConflict:
            return Response(
                _idempotency_conflict_payload(request),
                status=status.HTTP_409_CONFLICT,
            )
        except DuplicateWeek as exc:
            return Response(
                _duplicate_week_payload(request, exc.existing),
                status=status.HTTP_409_CONFLICT,
            )
        except TimesheetError as exc:
            return Response(
                _validation_payload(exc, request),
                status=422,
            )

        body = {"data": ts.TimesheetSerializer(sheet).data}
        return Response(body, status=status.HTTP_201_CREATED)


class TimesheetDetailView(APIView):
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request, pk):
        instance = _get_own_timesheet(request.user, pk)
        return Response({"data": ts.TimesheetSerializer(instance).data})


class TimesheetSubmitView(APIView):
    """POST /api/v1/timesheets/{id}/submit (Story 3.2).

    Owner-only; DRAFT/RETURNED -> SUBMITTED after full week validation
    (complete week, <= 168h worked, no rounding/deductions). Requires an
    Idempotency-Key and explicit confirm=true; stale version -> 409;
    SUBMITTED/APPROVED/REJECTED -> 409 state_conflict with no mutation.
    State, version, event, audit, and the idempotency record commit in one
    locked transaction; same-key races replay or conflict, never duplicate.
    """

    throttle_classes = [MutationRateThrottle]

    def post(self, request, pk):
        sheet = _get_own_timesheet(request.user, pk)

        idempotency_key = request.headers.get("Idempotency-Key", "").strip()
        if not idempotency_key:
            return Response(
                error_payload(
                    code="idempotency_key_required",
                    message="An Idempotency-Key header is required to submit a timesheet.",
                    fields={"idempotency_key": ["Missing Idempotency-Key header."]},
                    request=request,
                ),
                status=422,
            )

        serializer = ts.TimesheetSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        expected_version = serializer.validated_data["version"]

        key_hash, payload_hash = submit_idempotency_fingerprint(
            key=idempotency_key, timesheet_id=sheet.pk, version=expected_version
        )

        try:
            submitted = submit_timesheet(
                employee=request.user,
                sheet=sheet,
                version=expected_version,
                key_hash=key_hash,
                payload_hash=payload_hash,
            )
        except SubmitIdempotencyReplay as exc:
            # Replay the stored committed response without a second transition.
            replayed = Timesheet.objects.get(pk=exc.snapshot["timesheet_id"])
            return Response({"data": ts.TimesheetSerializer(replayed).data}, status=status.HTTP_200_OK)
        except SubmitIdempotencyConflict:
            return Response(
                _idempotency_conflict_payload(request),
                status=status.HTTP_409_CONFLICT,
            )
        except SubmitStateError:
            return Response(
                _state_conflict_payload(
                    "Only draft and returned timesheets can be submitted.",
                    "Submitting requires the DRAFT or RETURNED state.",
                    request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except SubmitVersionConflict:
            return Response(
                _version_conflict_payload(request),
                status=status.HTTP_409_CONFLICT,
            )
        except TimesheetError as exc:
            return Response(
                _validation_payload(exc, request),
                status=422,
            )

        return Response({"data": ts.TimesheetSerializer(submitted).data}, status=status.HTTP_200_OK)


class TimesheetEntryDetailView(APIView):
    """PATCH/DELETE /api/v1/timesheets/{id}/entries/{entry_id} (Story 3.2).

    Owner-only corrections while the sheet is DRAFT or RETURNED. Permitted
    entry fields: work_date, duration_minutes, unpaid_break_minutes,
    description. SUBMITTED/APPROVED/REJECTED are read-only to the employee:
    409 state_conflict explaining the read-only policy, no mutation, no
    event. The reviewer reason and all history are preserved; every accepted
    correction bumps the sheet version and appends an EDITED event.
    """

    throttle_classes = [MutationRateThrottle]

    def _editable_or_conflict(self, sheet, request):
        if sheet.status not in ("DRAFT", "RETURNED"):
            return Response(
                _state_conflict_payload(
                    "This timesheet is read-only in its current state.",
                    "Entries can be edited only while the timesheet is DRAFT or RETURNED.",
                    request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        return None

    def patch(self, request, pk, entry_id):
        sheet = _get_own_timesheet(request.user, pk)
        conflict = self._editable_or_conflict(sheet, request)
        if conflict is not None:
            return conflict
        entry = _get_own_entry(sheet, entry_id)

        serializer = ts.TimeEntryCorrectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cleaned = serializer.validated_data

        try:
            sheet, entry = edit_entry(
                employee=request.user,
                sheet=sheet,
                entry=entry,
                cleaned=cleaned,
            )
        except SubmitStateError:
            # State changed between the pre-check and the locked transaction.
            return Response(
                _state_conflict_payload(
                    "This timesheet is read-only in its current state.",
                    "Entries can be edited only while the timesheet is DRAFT or RETURNED.",
                    request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except SubmitVersionConflict:
            return Response(
                _version_conflict_payload(request),
                status=status.HTTP_409_CONFLICT,
            )
        except TimesheetError as exc:
            return Response(
                _validation_payload(exc, request),
                status=422,
            )

        return Response({"data": ts.TimesheetSerializer(sheet).data})

    def delete(self, request, pk, entry_id):
        sheet = _get_own_timesheet(request.user, pk)
        conflict = self._editable_or_conflict(sheet, request)
        if conflict is not None:
            return conflict
        entry = _get_own_entry(sheet, entry_id)

        serializer = ts.EntryDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        version = serializer.validated_data["version"]

        try:
            sheet = delete_entry(
                employee=request.user,
                sheet=sheet,
                entry=entry,
                version=version,
            )
        except SubmitStateError:
            return Response(
                _state_conflict_payload(
                    "This timesheet is read-only in its current state.",
                    "Entries can be edited only while the timesheet is DRAFT or RETURNED.",
                    request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except SubmitVersionConflict:
            return Response(
                _version_conflict_payload(request),
                status=status.HTTP_409_CONFLICT,
            )

        return Response({"data": ts.TimesheetSerializer(sheet).data})


def _get_timesheet_for_review(user, pk):
    """Fetch any timesheet the user may review; 404 when it does not exist.

    Scope (direct-report manager / HR role) is enforced inside the service
    under the row lock; out-of-scope there maps back to this same 404 so an
    unauthorized reviewer learns nothing about the sheet's existence
    (permission-matrix.md 404 policy).
    """
    try:
        return Timesheet.objects.get(pk=pk)
    except (Timesheet.DoesNotExist, ValueError):
        raise Http404


class TimesheetDecisionView(APIView):
    """POST /api/v1/timesheets/{id}/decision (Story 3.3).

    Reviewer-only (active direct-report manager or active HR); the sheet
    must be SUBMITTED. Idempotency-Key header required; payload
    {action, comment, version} — non-blank comment required for
    reject/return (422, no mutation). Undisclosed cross-scope access is a
    uniform 404. The transition, event, audit, and the idempotency record
    commit in one locked transaction; same-key races replay or conflict,
    never duplicate. Post-commit employee notification is failure-isolated.
    """

    throttle_classes = [MutationRateThrottle]

    def post(self, request, pk):
        sheet = _get_timesheet_for_review(request.user, pk)

        idempotency_key = request.headers.get("Idempotency-Key", "").strip()
        if not idempotency_key:
            return Response(
                error_payload(
                    code="idempotency_key_required",
                    message="An Idempotency-Key header is required to decide a timesheet.",
                    fields={"idempotency_key": ["Missing Idempotency-Key header."]},
                    request=request,
                ),
                status=422,
            )

        serializer = ts.TimesheetDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        action = serializer.validated_data["action"]
        comment = serializer.validated_data["comment"]
        expected_version = serializer.validated_data["version"]

        payload_hash = sha256(
            f"{sheet.pk}:{expected_version}:{action}:{comment}".encode()
        ).hexdigest()
        key_hash = sha256(idempotency_key.encode()).hexdigest()

        try:
            decided = review_services.decide_timesheet(
                reviewer=request.user,
                sheet=sheet,
                action=action,
                comment=comment,
                version=expected_version,
                key_hash=key_hash,
                payload_hash=payload_hash,
            )
        except review_services.VersionConflict:
            return Response(
                _version_conflict_payload(request),
                status=status.HTTP_409_CONFLICT,
            )
        except review_services.DecisionStateError:
            return Response(
                _state_conflict_payload(
                    "This action is not possible in the timesheet's current state.",
                    "Decisions require the SUBMITTED state.",
                    request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except review_services.IdempotencyReplay as replay:
            # Lost a concurrent same-key race with the identical payload: the
            # winner's transition stands; replay its response (200).
            replayed = Timesheet.objects.get(pk=replay.snapshot["timesheet_id"])
            return Response({"data": ts.TimesheetSerializer(replayed).data}, status=status.HTTP_200_OK)
        except review_services.IdempotencyConflict:
            return Response(
                _idempotency_conflict_payload(request),
                status=status.HTTP_409_CONFLICT,
            )
        except PermissionError:
            return Response(
                error_payload(
                    code="self_decision_forbidden",
                    message="You cannot decide your own timesheet.",
                    fields={"action": ["Self-approval is forbidden."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except LookupError:
            # Out of scope: same envelope as a nonexistent resource (404 policy).
            raise Http404

        return Response({"data": ts.TimesheetSerializer(decided).data}, status=status.HTTP_200_OK)


class TimesheetReopenView(APIView):
    """POST /api/v1/timesheets/{id}/reopen (Story 3.3, HR-only).

    Active HR only; only APPROVED or REJECTED sheets may be reopened to
    RETURNED. Mandatory non-blank reason, explicit confirm=true, and an
    Idempotency-Key; stale version -> 409. All prior history is retained
    (append-only); the reopened sheet becomes employee-editable. Employees
    and managers get the same 404 as a nonexistent sheet.
    """

    throttle_classes = [MutationRateThrottle]

    def post(self, request, pk):
        sheet = _get_timesheet_for_review(request.user, pk)

        idempotency_key = request.headers.get("Idempotency-Key", "").strip()
        if not idempotency_key:
            return Response(
                error_payload(
                    code="idempotency_key_required",
                    message="An Idempotency-Key header is required to reopen a timesheet.",
                    fields={"idempotency_key": ["Missing Idempotency-Key header."]},
                    request=request,
                ),
                status=422,
            )

        serializer = ts.TimesheetReopenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = serializer.validated_data["comment"]
        expected_version = serializer.validated_data["version"]

        key_hash, payload_hash = review_services.reopen_idempotency_fingerprint(
            key=idempotency_key, timesheet_id=sheet.pk, version=expected_version, comment=comment
        )

        try:
            reopened = review_services.reopen_timesheet(
                hr_user=request.user,
                sheet=sheet,
                comment=comment,
                version=expected_version,
                key_hash=key_hash,
                payload_hash=payload_hash,
            )
        except review_services.VersionConflict:
            return Response(
                _version_conflict_payload(request),
                status=status.HTTP_409_CONFLICT,
            )
        except review_services.DecisionStateError:
            return Response(
                _state_conflict_payload(
                    "Only approved or rejected timesheets can be reopened.",
                    "Reopening requires the APPROVED or REJECTED state.",
                    request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except review_services.IdempotencyReplay as replay:
            replayed = Timesheet.objects.get(pk=replay.snapshot["timesheet_id"])
            return Response({"data": ts.TimesheetSerializer(replayed).data}, status=status.HTTP_200_OK)
        except review_services.IdempotencyConflict:
            return Response(
                _idempotency_conflict_payload(request),
                status=status.HTTP_409_CONFLICT,
            )
        except PermissionError:
            return Response(
                error_payload(
                    code="self_decision_forbidden",
                    message="You cannot reopen your own timesheet.",
                    fields={"action": ["Self-reopen is forbidden."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except LookupError:
            # Not HR: same envelope as a nonexistent resource (404 policy).
            raise Http404

        return Response({"data": ts.TimesheetSerializer(reopened).data}, status=status.HTTP_200_OK)
