from django.urls import path

from accounts import announcement_views, assistant_views, attendance_views, company_views, department_views, employee_views, grant_views, task_attachment_views, task_views, views, work_schedule_views

app_name = "accounts"

urlpatterns = [
    path("auth/csrf", views.CsrfBootstrapView.as_view(), name="auth-csrf"),
    path("auth/login", views.LoginView.as_view(), name="auth-login"),
    path("auth/signup", views.SignupView.as_view(), name="auth-signup"),
    path("auth/logout", views.LogoutView.as_view(), name="auth-logout"),
    path("auth/me", views.MeView.as_view(), name="auth-me"),
    path("company", company_views.CompanyProfileView.as_view(), name="company-profile"),
    path("assistant/config", assistant_views.AssistantConfigView.as_view(), name="assistant-config"),
    path("assistant/subscription/import", assistant_views.AssistantSubscriptionImportView.as_view(), name="assistant-subscription-import"),
    path("assistant/subscription/start", assistant_views.AssistantSubscriptionStartView.as_view(), name="assistant-subscription-start"),
    path("assistant/subscription/poll", assistant_views.AssistantSubscriptionPollView.as_view(), name="assistant-subscription-poll"),
    path(
        "assistant/subscription/capability",
        assistant_views.AssistantSubscriptionCapabilityView.as_view(),
        name="assistant-subscription-capability",
    ),
    path("assistant/subscription/models", assistant_views.AssistantSubscriptionModelsView.as_view(), name="assistant-subscription-models"),
    path("assistant/test", assistant_views.AssistantTestView.as_view(), name="assistant-test"),
    path("assistant/chat", assistant_views.AssistantChatView.as_view(), name="assistant-chat"),
    path(
        "assistant/actions/<str:token>/confirm",
        assistant_views.AssistantActionConfirmView.as_view(),
        name="assistant-action-confirm",
    ),
    path("employees", employee_views.EmployeeListView.as_view(), name="employee-list"),
    path("employees/<int:target_id>", employee_views.EmployeeDetailView.as_view(), name="employee-detail"),
    path(
        "employees/<int:target_id>/assistant",
        assistant_views.AssistantHRConfigView.as_view(),
        name="assistant-hr-config",
    ),
    path("departments", department_views.DepartmentListView.as_view(), name="department-list"),
    path("attendance/today", attendance_views.AttendanceTodayView.as_view(), name="attendance-today"),
    path(
        "attendance/history",
        attendance_views.AttendanceHistoryView.as_view(),
        name="attendance-history",
    ),
    path(
        "attendance/snapshot",
        attendance_views.AttendanceSnapshotView.as_view(),
        name="attendance-snapshot",
    ),
    path(
        "attendance/<str:kind>",
        attendance_views.AttendanceEventView.as_view(),
        name="attendance-event",
    ),
    path("tasks", task_views.TaskListCreateView.as_view(), name="task-list"),
    path("tasks/<int:task_id>", task_views.TaskDetailView.as_view(), name="task-detail"),
    path(
        "tasks/<int:task_id>/attachments",
        task_attachment_views.TaskAttachmentListView.as_view(),
        name="task-attachment-list",
    ),
    path(
        "tasks/<int:task_id>/attachments/<uuid:pk>/download",
        task_attachment_views.TaskAttachmentDownloadView.as_view(),
        name="task-attachment-download",
    ),
    path(
        "departments/<int:department_id>",
        department_views.DepartmentDetailView.as_view(),
        name="department-detail",
    ),
    path("work-schedules", work_schedule_views.WorkScheduleListView.as_view(), name="work-schedule-list"),
    path(
        "work-schedules/<int:schedule_id>",
        work_schedule_views.WorkScheduleDetailView.as_view(),
        name="work-schedule-detail",
    ),
    path("manager-grants", grant_views.ManagerGrantListView.as_view(), name="manager-grant-list"),
    path(
        "manager-grants/<int:grant_id>",
        grant_views.ManagerGrantDetailView.as_view(),
        name="manager-grant-detail",
    ),
    # «الإعلانات الداخلية» — the send log route is listed before the publish
    # route only for readability; `log` is not an <int>, so the two never clash.
    path("announcements", announcement_views.AnnouncementListView.as_view(), name="announcement-list"),
    path("announcements/log", announcement_views.AnnouncementLogView.as_view(), name="announcement-log"),
    path(
        "announcements/<int:announcement_id>/publish",
        announcement_views.AnnouncementPublishView.as_view(),
        name="announcement-publish",
    ),
]
