from django.core.exceptions import ObjectDoesNotExist
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.throttles import MutationRateThrottle
from config.api import NotificationPagination, error_payload
from notifications.models import Notification
from notifications.services import mark_notification_read
from notifications.serializers import NotificationReadStateSerializer, NotificationSerializer


class NotificationListView(APIView):
    def get(self, request):
        paginator = NotificationPagination()
        notification_page = paginator.paginate_queryset(
            Notification.objects.filter(recipient=request.user),
            request,
            view=self,
        )
        serializer = NotificationSerializer(
            notification_page, many=True, context={"request": request}
        )
        return paginator.get_paginated_response(serializer.data)


class NotificationDetailView(APIView):
    """Read-only notification detail; owner-scoped with a safe 404."""

    def get(self, request, notification_id):
        notification = get_object_or_404(
            Notification.objects.filter(recipient=request.user),
            pk=notification_id,
        )
        return Response(
            {"data": NotificationSerializer(notification, context={"request": request}).data}
        )


class NotificationReadStateView(APIView):
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def get(self, request, notification_id):
        notification = get_object_or_404(
            Notification.objects.filter(recipient=request.user),
            pk=notification_id,
        )
        return Response(
            {"data": NotificationSerializer(notification, context={"request": request}).data}
        )

    def patch(self, request, notification_id):
        serializer = NotificationReadStateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        is_read = serializer.validated_data["is_read"]
        try:
            if is_read:
                mark_notification_read(notification_id, request.user)
            else:
                _mark_unread(notification_id, request.user)
        except ObjectDoesNotExist:
            return self._safe_404(request)
        except Exception:
            # Failure-preserves-unread (AC): a failed write never marks the
            # notification read; the error is retryable, the state unchanged.
            return self._failure_response(request)
        notification = Notification.objects.filter(
            recipient=request.user, pk=notification_id
        ).first()
        if notification is None:
            return self._safe_404(request)
        return Response(
            {"data": NotificationSerializer(notification, context={"request": request}).data}
        )

    def _safe_404(self, request):
        return Response(
            error_payload(code="not_found", message="Not found.", fields={}, request=request),
            status=status.HTTP_404_NOT_FOUND,
        )

    def _failure_response(self, request):
        return Response(
            error_payload(
                code="read_state_error",
                message="Read state could not be saved. Please retry.",
                fields={},
                request=request,
            ),
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


def _mark_unread(notification_id, user):
    """Revert to unread: transactional, idempotent, failure-leaves-state."""
    from django.db import transaction

    with transaction.atomic():
        notification = (
            Notification.objects.select_for_update()
            .filter(recipient=user, pk=notification_id)
            .first()
        )
        if notification is None:
            raise ObjectDoesNotExist("notification not found")
        if notification.read_at is not None:
            notification.read_at = None
            notification.save(update_fields=["read_at"])
