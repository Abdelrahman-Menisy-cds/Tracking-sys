from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from notifications.models import Notification
from notifications.serializers import NotificationReadStateSerializer, NotificationSerializer


class NotificationListView(APIView):
    def get(self, request):
        notifications = Notification.objects.filter(recipient=request.user)
        return Response({"data": NotificationSerializer(notifications, many=True).data})


class NotificationReadStateView(APIView):
    def patch(self, request, notification_id):
        notification = get_object_or_404(
            Notification.objects.filter(recipient=request.user),
            pk=notification_id,
        )
        serializer = NotificationReadStateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        notification.read_at = timezone.now() if serializer.validated_data["is_read"] else None
        notification.save(update_fields=["read_at"])
        return Response({"data": NotificationSerializer(notification).data})
