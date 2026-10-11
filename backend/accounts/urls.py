from django.urls import path

from accounts import department_views, employee_views, grant_views, views

app_name = "accounts"

urlpatterns = [
    path("auth/csrf", views.CsrfBootstrapView.as_view(), name="auth-csrf"),
    path("auth/login", views.LoginView.as_view(), name="auth-login"),
    path("auth/signup", views.SignupView.as_view(), name="auth-signup"),
    path("auth/logout", views.LogoutView.as_view(), name="auth-logout"),
    path("auth/me", views.MeView.as_view(), name="auth-me"),
    path("employees", employee_views.EmployeeListView.as_view(), name="employee-list"),
    path("employees/<int:target_id>", employee_views.EmployeeDetailView.as_view(), name="employee-detail"),
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
