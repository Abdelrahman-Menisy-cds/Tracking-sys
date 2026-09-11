from django.urls import path

from accounts import views

app_name = "accounts"

urlpatterns = [
    path("auth/csrf", views.CsrfBootstrapView.as_view(), name="auth-csrf"),
    path("auth/login", views.LoginView.as_view(), name="auth-login"),
    path("auth/logout", views.LogoutView.as_view(), name="auth-logout"),
    path("auth/me", views.MeView.as_view(), name="auth-me"),
]
