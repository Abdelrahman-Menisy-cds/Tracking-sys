"""Request draft endpoints (Story 2.1): requester-scoped create/list/detail/patch.

Story 2.4 adds RequestDecisionView: reviewer-scope decide endpoint with
idempotency, 404-safe out-of-scope denials, and 409/422 error envelopes.
"""
from django.http import Http404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.throttles import MutationRateThrottle
from config.api import RequestPagination, error_payload
from reqs import serializers as rs
from reqs import attachment_views  # re-exported for reqs.urls (Story 2.2)
from reqs.models import (
    EmployeeRequest,
    SubmissionIdempotencyRecord,
)
from reqs.services import create_draft, edit_draft
from reqs.submission_services import (
    SubmissionError,
    VersionConflict as SubmitVersionConflict,
    idempotency_fingerprint,
    record_idempotency,
    submit_request,
)
from reqs.decision_services import (
    DecisionStateError,
    IdempotencyConflict,
    IdempotencyReplay,
    VersionConflict,
    decide_request,
)
from reqs.cancel_services import (
    CancelStateError,
    IdempotencyConflict as CancelIdempotencyConflict,
    IdempotencyReplay as CancelIdempotencyReplay,
    VersionConflict as CancelVersionConflict,
    cancel_request,
)


def _get_own_request(user, pk):
    """Raise the same 404 for a missing request as for another user's request."""
    try:
        return EmployeeRequest.objects.get(pk=pk, requester=user)
    except (EmployeeRequest.DoesNotExist, ValueError):
        raise Http404


class RequestListView(APIView):
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request):
        paginator = RequestPagination()
        page = paginator.paginate_queryset(
            EmployeeRequest.objects.filter(requester=request.user),
            request,
            view=self,
        )
        return paginator.get_paginated_response(rs.EmployeeRequestSerializer(page, many=True).data)

    def post(self, request):
        serializer = rs.DraftCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        draft = create_draft(
            requester=request.user,
            request_type=serializer.validated_data["request_type_id"],
            title=serializer.validated_data["title"],
            details=serializer.validated_data["details"],
        )
        return Response({"data": rs.EmployeeRequestSerializer(draft).data}, status=status.HTTP_201_CREATED)


class RequestDetailView(APIView):
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request, pk):
        instance = _get_own_request(request.user, pk)
        return Response({"data": rs.EmployeeRequestSerializer(instance).data})

    def patch(self, request, pk):
        instance = _get_own_request(request.user, pk)
        if instance.status not in (EmployeeRequest.Status.DRAFT, EmployeeRequest.Status.RETURNED):
            return Response(
                {
                    "error": {
                        "code": "state_conflict",
                        "message": "This request is read-only in its current state.",
                        "fields": {"status": ["Editing is only allowed for drafts and returned requests."]},
                        "request_id": request.request_id,
                    }
                },
                status=status.HTTP_409_CONFLICT,
            )
        serializer = rs.DraftEditSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        new = edit_draft(
            request=instance,
            editor=request.user,
            title=serializer.validated_data.get("title", instance.title),
            details=serializer.validated_data.get("details", instance.details),
        )
        return Response({"data": rs.EmployeeRequestSerializer(new).data})


class RequestSubmitView(APIView):
    """POST /api/v1/requests/{id}/submit (Story 2.3).

    Requester-only, DRAFT/RETURNED-only, idempotent via Idempotency-Key,
    server-derived routing. Notifications are Epic 4 scope.
    """

    throttle_classes = [MutationRateThrottle]

    def post(self, request, pk):
        request_obj = _get_own_request(request.user, pk)

        idempotency_key = request.headers.get("Idempotency-Key", "").strip()
        if not idempotency_key:
            return Response(
                error_payload(
                    code="idempotency_key_required",
                    message="An Idempotency-Key header is required to submit a request.",
                    fields={"idempotency_key": ["Missing Idempotency-Key header."]},
                    request=request,
                ),
                status=422,
            )

        serializer = rs.SubmitRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        expected_version = serializer.validated_data["version"]

        key_hash, payload_hash = idempotency_fingerprint(
            key=idempotency_key, request_id=request_obj.pk, version=expected_version
        )
        existing = SubmissionIdempotencyRecord.objects.filter(key_hash=key_hash).first()
        if existing is not None:
            if existing.payload_hash == payload_hash:
                return Response(existing.response_snapshot, status=status.HTTP_200_OK)
            return Response(
                error_payload(
                    code="idempotency_conflict",
                    message="This idempotency key was already used with a different payload.",
                    fields={"idempotency_key": ["Key reused with different payload."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )

        try:
            submitted = submit_request(
                requester=request.user,
                request_obj=request_obj,
                version=expected_version,
            )
        except SubmissionError as exc:
            field_errors = [exc.message]
            if exc.detail:
                # e.g. attachment ids that failed the clean-scan requirement.
                field_errors.extend(exc.detail.split(","))
            return Response(
                error_payload(
                    code=exc.code,
                    message=exc.message,
                    fields={exc.field: field_errors},
                    request=request,
                ),
                status=422,
            )
        except SubmitVersionConflict:
            return Response(
                error_payload(
                    code="version_conflict",
                    message="This request changed since you last saw it. Reload and try again.",
                    fields={"version": ["The provided version is stale."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except PermissionError:
            return Response(
                error_payload(
                    code="state_conflict",
                    message="Only drafts and returned requests can be submitted.",
                    fields={"status": ["Submitting requires the DRAFT or RETURNED state."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )

        body = {"data": rs.EmployeeRequestSerializer(submitted).data}
        record_idempotency(
            user=request.user,
            key_hash=key_hash,
            payload_hash=payload_hash,
            snapshot=body,
        )
        return Response(body, status=status.HTTP_200_OK)


def _get_request_for_review(user, pk):
    """Fetch any request the user may review; 404 when it does not exist.

    Scope (manager-of / HR-role) is enforced inside the service under the
    row lock; out-of-scope there maps back to this same 404 so an
    unauthorized reviewer learns nothing about the request's existence
    (permission-matrix.md 404 policy).
    """
    try:
        return EmployeeRequest.objects.get(pk=pk)
    except (EmployeeRequest.DoesNotExist, ValueError):
        raise Http404


class RequestDecisionView(APIView):
    """POST /api/v1/requests/{id}/decision (Story 2.4).

    Idempotency-Key required; action approve/reject/return with a
    non-blank bounded comment for reject/return; version for optimistic
    concurrency. Idempotency lookup AND record insert run inside the
    locked decision transaction (decision_services.decide_request): the
    UniqueConstraint(key_hash, user) arbitrates concurrent same-key
    requests — identical payload replays the winner's 200 with exactly one
    transition/event; differing payload -> 409 idempotency_conflict.
    Records are scoped by reviewer so one reviewer's stored snapshot is
    never visible to another user who guesses the key.
    """

    throttle_classes = [MutationRateThrottle]

    def post(self, request, pk):
        request_obj = _get_request_for_review(request.user, pk)

        idempotency_key = request.headers.get("Idempotency-Key", "").strip()
        if not idempotency_key:
            return Response(
                error_payload(
                    code="idempotency_key_required",
                    message="An Idempotency-Key header is required to decide a request.",
                    fields={"idempotency_key": ["Missing Idempotency-Key header."]},
                    request=request,
                ),
                status=422,
            )

        serializer = rs.DecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        action = serializer.validated_data["action"]
        comment = serializer.validated_data["comment"]
        expected_version = serializer.validated_data["version"]

        payload_hash = _decision_payload_hash(
            request_id=request_obj.pk, version=expected_version, action=action, comment=comment
        )
        key_hash = _decision_key_hash(idempotency_key)

        try:
            decided = decide_request(
                reviewer=request.user,
                request_obj=request_obj,
                action=action,
                comment=comment,
                version=expected_version,
                key_hash=key_hash,
                payload_hash=payload_hash,
            )
        except VersionConflict:
            return Response(
                error_payload(
                    code="version_conflict",
                    message="This request changed since you last saw it. Reload and try again.",
                    fields={"version": ["The provided version is stale."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except DecisionStateError:
            return Response(
                error_payload(
                    code="state_conflict",
                    message="This action is not possible in the request's current state.",
                    fields={"status": ["No matching transition for this action and state."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except IdempotencyReplay as replay:
            # Lost a concurrent same-key race with the identical payload: the
            # winner's transition stands; replay its response (200).
            return Response(replay.snapshot, status=status.HTTP_200_OK)
        except IdempotencyConflict:
            return Response(
                error_payload(
                    code="idempotency_conflict",
                    message="This idempotency key was already used with a different payload.",
                    fields={"idempotency_key": ["Key reused with different payload."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except PermissionError:
            return Response(
                error_payload(
                    code="self_decision_forbidden",
                    message="You cannot decide your own request.",
                    fields={"action": ["Self-approval is forbidden."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except LookupError:
            # Out of scope: same envelope as a nonexistent request (404 policy).
            raise Http404

        body = {"data": rs.EmployeeRequestSerializer(decided).data}
        return Response(body, status=status.HTTP_200_OK)


def _decision_key_hash(key: str) -> str:
    from hashlib import sha256

    return sha256(key.encode()).hexdigest()


def _cancel_key_hash(key: str) -> str:
    return _decision_key_hash(key)


def _cancel_payload_hash(*, request_id, version: int) -> str:
    from hashlib import sha256

    return sha256(f"{request_id}:{version}".encode()).hexdigest()


class RequestCancelView(APIView):
    """POST /api/v1/requests/{id}/cancel (Story 2.5).

    Requester-only cancellation before any decision. Contract: Idempotency-Key
    header required; payload {confirm: true, version: <int>}. Missing key or
    missing/false confirm -> 422 with no mutation. Cross-user access is the
    same 404 as a nonexistent request (404 policy). Idempotency lookup AND
    record insert run inside the locked cancellation transaction
    (cancel_services.cancel_request): identical payload replays the winner's
    200 with exactly one transition/event; differing payload -> 409
    idempotency_conflict. The post-commit requester notification is
    failure-isolated (Story 2.4 pattern).
    """

    throttle_classes = [MutationRateThrottle]

    def post(self, request, pk):
        request_obj = _get_own_request(request.user, pk)

        idempotency_key = request.headers.get("Idempotency-Key", "").strip()
        if not idempotency_key:
            return Response(
                error_payload(
                    code="idempotency_key_required",
                    message="An Idempotency-Key header is required to cancel a request.",
                    fields={"idempotency_key": ["Missing Idempotency-Key header."]},
                    request=request,
                ),
                status=422,
            )

        serializer = rs.CancelRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        expected_version = serializer.validated_data["version"]

        key_hash = _cancel_key_hash(idempotency_key)
        payload_hash = _cancel_payload_hash(
            request_id=request_obj.pk, version=expected_version
        )

        try:
            cancelled = cancel_request(
                requester=request.user,
                request_obj=request_obj,
                version=expected_version,
                key_hash=key_hash,
                payload_hash=payload_hash,
            )
        except CancelVersionConflict:
            return Response(
                error_payload(
                    code="version_conflict",
                    message="This request changed since you last saw it. Reload and try again.",
                    fields={"version": ["The provided version is stale."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except CancelStateError:
            return Response(
                error_payload(
                    code="state_conflict",
                    message="A decided or already-cancelled request cannot be cancelled.",
                    fields={"status": ["Cancellation is only possible before a decision."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except CancelIdempotencyReplay as replay:
            # Lost a concurrent same-key race with the identical payload: the
            # winner's cancellation stands; replay its response (200).
            return Response(replay.snapshot, status=status.HTTP_200_OK)
        except CancelIdempotencyConflict:
            return Response(
                error_payload(
                    code="idempotency_conflict",
                    message="This idempotency key was already used with a different payload.",
                    fields={"idempotency_key": ["Key reused with different payload."]},
                    request=request,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        except LookupError:
            # Not the requester: same envelope as a nonexistent request
            # (404 policy, no existence disclosure).
            raise Http404

        body = {"data": rs.EmployeeRequestSerializer(cancelled).data}
        return Response(body, status=status.HTTP_200_OK)


def _decision_payload_hash(*, request_id, version: int, action: str, comment: str) -> str:
    from hashlib import sha256

    return sha256(f"{request_id}:{version}:{action}:{comment}".encode()).hexdigest()
