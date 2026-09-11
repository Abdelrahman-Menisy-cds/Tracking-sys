from django.urls import path

from accounts import employee_views, views

app_name = "accounts"

urlpatterns = [
    path("auth/csrf", views.CsrfBootstrapView.as_view(), name="auth-csrf"),
    path("auth/login", views.LoginView.as_view(), name="auth-login"),
    path("auth/logout", views.LogoutView.as_view(), name="auth-logout"),
    path("auth/me", views.MeView.as_view(), name="auth-me"),
    path("employees", employee_views.EmployeeListView.as_view(), name="employee-list"),
    path("employees/<int:target_id>", employee_views.EmployeeDetailView.as_view(), name="employee-detail"),
]
