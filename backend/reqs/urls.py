from django.urls import path, re_path

from reqs import attachment_views
from reqs import views

app_name = "reqs"

urlpatterns = [
    path("requests", views.RequestListView.as_view(), name="request-list"),
    path("requests/<uuid:pk>", views.RequestDetailView.as_view(), name="request-detail"),
    path("requests/<uuid:pk>/attachments", attachment_views.AttachmentListView.as_view(), name="attachment-list"),
    path("attachments/<uuid:pk>", attachment_views.AttachmentDetailView.as_view(), name="attachment-detail"),
    re_path(r"^attachments/(?P<pk>[0-9a-f-]{36})/replace(?:/(?P<pk2>[0-9a-f-]{36})?)$", attachment_views.AttachmentReplaceView.as_view(), name="attachment-replace"),
    path("attachments/<uuid:pk>/download", attachment_views.AttachmentDownloadView.as_view(), name="attachment-download"),
]
