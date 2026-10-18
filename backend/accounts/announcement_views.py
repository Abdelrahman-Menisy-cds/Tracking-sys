"""Announcement endpoints — the «الإعلانات الداخلية» screen's server half.

  GET  /api/v1/announcements              HR: every company announcement (drafts
                                          + published); anyone else: the PUBLISHED
                                          ones addressed to them (the in-app feed)
  POST /api/v1/announcements              HR authors a DRAFT   (Idempotency-Key)
  POST /api/v1/announcements/<id>/publish HR publishes one     (version + Idempotency-Key)
  GET  /api/v1/announcements/log          HR reads the send log (what/audience/when)

Permissions follow company_views.py, the in-codebase precedent: an authenticated
caller without the HR application role gets the standard 403 ``permission_denied``
envelope, and anonymous callers get 401 (IsAuthenticated401). An employee never
partial-fails into a disclosure — they are denied before any announcement is read
or written. The audience rule itself lives in announcement_services.py; this
module only shapes the wire.

No delivery is ever simulated: publish writes exactly ONE delivery row whose
channel is the in-app feed, because that is the only transport that exists.
"""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.announcement_serializers import (
    AnnouncementPublishSerializer,
    AnnouncementWriteSerializer,
    serialize_announcement,
    serialize_delivery,
)
from accounts.announcement_services import (
    AnnouncementError,
    AnnouncementStateError,
    AnnouncementVersionConflict,
    create_draft,
    idempotency_fingerprint,
    publish_announcement,
)
from accounts.models import Announcement, AnnouncementDelivery, AnnouncementIdempotencyRecord, User
from accounts.permissions import IsAuthenticated401
from accounts.throttles import MutationRateThrottle
from config.api import error_payload


def _error(request, code, message, fields, status_code):
    return Response(
        error_payload(code=code, message=message, fields=fields, request=request),
        status=status_code,
    )


def _hr_denied(request):
    return _error(
        request,
        "permission_denied",
        "You do not have permission to perform this action.",
        {},
        status.HTTP_403_FORBIDDEN,
    )


def _not_found(request):
    return _error(request, "not_found", "Not found.", {}, status.HTTP_404_NOT_FOUND)


def _validation(request, fields, message="Validation failed."):
    return _error(request, "validation_error", message, fields, status.HTTP_422_UNPROCESSABLE_ENTITY)


def _idempotency_required(request, action):
    return _error(
        request,
        "idempotency_key_required",
        f"An Idempotency-Key header is required to {action}.",
        {"idempotency_key": ["Missing Idempotency-Key header."]},
        status.HTTP_422_UNPROCESSABLE_ENTITY,
    )


def _idempotency_conflict(request):
    return _error(
        request,
        "idempotency_conflict",
        "This idempotency key was already used with a different payload.",
        {"idempotency_key": ["Key reused with different payload."]},
        status.HTTP_409_CONFLICT,
    )


def _hr_user(request):
    """The caller when they hold the HR application role, else None."""
    if request.user.is_authenticated and request.user.role == User.Role.HR:
        return request.user
    return None


class AnnouncementListView(APIView):
    """GET the role-scoped feed; POST author a draft (HR only)."""

    permission_classes = [IsAuthenticated401]
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request):
        is_hr = request.user.role == User.Role.HR
        queryset = (
            Announcement.feed_for(request.user)
            .select_related("author")
            .prefetch_related("recipients", "deliveries")
        )
        return Response({"data": [serialize_announcement(row, is_hr=is_hr) for row in queryset]})

    def post(self, request):
        actor = _hr_user(request)
        if actor is None:
            return _hr_denied(request)

        idempotency_key = (request.headers.get("Idempotency-Key") or "").strip()
        if not idempotency_key:
            return _idempotency_required(request, "author an announcement")

        serializer = AnnouncementWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        payload = (
            f"create:{data['title']}:{data['body']}:{data['audience']}:"
            f"{sorted(data.get('recipients') or [])}"
        )
        key_hash, payload_hash = idempotency_fingerprint(key=idempotency_key, payload=payload)
        existing = AnnouncementIdempotencyRecord.objects.filter(key_hash=key_hash, user=actor).first()
        if existing is not None:
            if existing.payload_hash == payload_hash:
                return Response(existing.response_snapshot, status=status.HTTP_201_CREATED)
            return _idempotency_conflict(request)

        try:
            announcement = create_draft(
                author=actor,
                title=data["title"],
                body=data["body"],
                audience=data["audience"],
                recipient_ids=data.get("recipients"),
            )
        except AnnouncementError as exc:
            return _validation(request, {exc.field: [exc.message]})

        body = {"data": serialize_announcement(announcement, is_hr=True)}
        AnnouncementIdempotencyRecord.objects.create(
            key_hash=key_hash,
            payload_hash=payload_hash,
            response_snapshot=body,
            company=actor.company,
            user=actor,
        )
        return Response(body, status=status.HTTP_201_CREATED)


class AnnouncementPublishView(APIView):
    """POST /api/v1/announcements/<id>/publish — HR publishes one draft."""

    permission_classes = [IsAuthenticated401]
    throttle_classes = [MutationRateThrottle]

    def post(self, request, announcement_id):
        actor = _hr_user(request)
        if actor is None:
            return _hr_denied(request)

        announcement = (
            Announcement.objects.filter(company=actor.company, pk=announcement_id).first()
        )
        if announcement is None:
            return _not_found(request)

        idempotency_key = (request.headers.get("Idempotency-Key") or "").strip()
        if not idempotency_key:
            return _idempotency_required(request, "publish an announcement")

        serializer = AnnouncementPublishSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        version = serializer.validated_data["version"]

        payload = f"publish:{announcement.pk}:{version}"
        key_hash, payload_hash = idempotency_fingerprint(key=idempotency_key, payload=payload)
        existing = AnnouncementIdempotencyRecord.objects.filter(key_hash=key_hash, user=actor).first()
        if existing is not None:
            if existing.payload_hash == payload_hash:
                return Response(existing.response_snapshot, status=status.HTTP_200_OK)
            return _idempotency_conflict(request)

        try:
            announcement, delivery = publish_announcement(
                announcement=announcement,
                actor=actor,
                expected_version=version,
                request_id=request.request_id,
            )
        except AnnouncementVersionConflict:
            return _error(
                request,
                "version_conflict",
                "This announcement changed since you last saw it. Reload and try again.",
                {"version": ["The provided version is stale."]},
                status.HTTP_409_CONFLICT,
            )
        except AnnouncementStateError:
            return _error(
                request,
                "state_conflict",
                "Only a draft can be published.",
                {"state": ["Publishing requires the DRAFT state."]},
                status.HTTP_409_CONFLICT,
            )

        body = {
            "data": serialize_announcement(announcement, is_hr=True),
            "delivery": serialize_delivery(delivery),
        }
        AnnouncementIdempotencyRecord.objects.create(
            key_hash=key_hash,
            payload_hash=payload_hash,
            response_snapshot=body,
            company=actor.company,
            user=actor,
        )
        return Response(body, status=status.HTTP_200_OK)


class AnnouncementLogView(APIView):
    """GET /api/v1/announcements/log — HR reads the send log (HR only)."""

    permission_classes = [IsAuthenticated401]

    def get(self, request):
        actor = _hr_user(request)
        if actor is None:
            return _hr_denied(request)
        rows = (
            AnnouncementDelivery.objects.filter(company=actor.company)
            .select_related("announcement", "sent_by")
        )
        return Response({"data": [serialize_delivery(row) for row in rows]})
