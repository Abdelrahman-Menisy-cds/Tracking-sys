from django.urls import path

from accounts import assistant_views, company_views, department_views, employee_views, grant_views, views

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
    path(
        "departments/<int:department_id>",
        department_views.DepartmentDetailView.as_view(),
        name="department-detail",
    ),
    path("manager-grants", grant_views.ManagerGrantListView.as_view(), name="manager-grant-list"),
    path(
        "manager-grants/<int:grant_id>",
        grant_views.ManagerGrantDetailView.as_view(),
        name="manager-grant-detail",
    ),
]
