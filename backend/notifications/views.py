from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.throttles import MutationRateThrottle
from config.api import NotificationPagination
from notifications.models import Notification
from notifications.serializers import NotificationReadStateSerializer, NotificationSerializer


class NotificationListView(APIView):
    def get(self, request):
        paginator = NotificationPagination()
        notification_page = paginator.paginate_queryset(
            Notification.objects.filter(recipient=request.user),
            request,
            view=self,
        )
        return paginator.get_paginated_response(NotificationSerializer(notification_page, many=True).data)


class NotificationReadStateView(APIView):
    throttle_classes = [MutationRateThrottle]

    def get_throttles(self):
        if self.request.method == "GET":
            return []
        return super().get_throttles()

    def patch(self, request, notification_id):
        notification = get_object_or_404(
            Notification.objects.filter(recipient=request.user),
            pk=notification_id,
        )
        serializer = NotificationReadStateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data["is_read"]:
            notification.read_at = notification.read_at or timezone.now()
        else:
            notification.read_at = None
        notification.save(update_fields=["read_at"])
        return Response({"data": NotificationSerializer(notification).data})
