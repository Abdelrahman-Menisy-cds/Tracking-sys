"""Accounts: identity, session auth endpoints, account activation state.

Owns identity only (approved architecture-security.md §3). Roles are
application roles (EMPLOYEE / MANAGER / HR) and are NOT Django superuser
status.
"""
from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("An email address is required.")
        email = self.normalize_email(email).lower()
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        # Operational break-glass only; not the HR path (constitution §3).
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", User.Role.HR)
        return self._create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    """Email-based custom user created BEFORE any initial migration."""

    class Role(models.TextChoices):
        EMPLOYEE = "EMPLOYEE", "Employee"
        MANAGER = "MANAGER", "Manager"
        HR = "HR", "HR"

    class Locale(models.TextChoices):
        ARABIC = "ar", "Arabic"
        ENGLISH = "en", "English"

    class Appearance(models.TextChoices):
        SYSTEM = "system", "System"
        LIGHT = "light", "Light"
        DARK = "dark", "Dark"

    email = models.EmailField("email address", unique=True, db_index=True)
    full_name = models.CharField("full name", max_length=150, blank=True)
    preferred_locale = models.CharField(max_length=2, choices=Locale.choices, default=Locale.ARABIC)
    appearance = models.CharField(max_length=6, choices=Appearance.choices, default=Appearance.SYSTEM)
    timezone_display = models.CharField(max_length=63, default="UTC")
    role = models.CharField(
        max_length=16,
        choices=Role.choices,
        default=Role.EMPLOYEE,
        db_index=True,
    )
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)  # Django admin break-glass only
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        verbose_name = "user"
        verbose_name_plural = "users"

    def __str__(self) -> str:
        return self.email

    def get_full_name(self) -> str:
        return self.full_name

    def get_short_name(self) -> str:
        return self.full_name or self.email


class EmployeeProfile(models.Model):
    """Organization-authoritative employee data (Story 1.3).

    Owns reporting line and employee-specific organization fields that are
    NOT identity: a nullable self-referencing manager FK, employee number,
    and job title. Role, active status, and full name stay on User so auth
    behavior remains unchanged. HR-only writes; profile.py owns the model
    contract per architecture-security.md §3.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="employee_profile",
    )
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="direct_reports",
    )
    employee_number = models.CharField(max_length=32, unique=True, null=True, blank=True)
    job_title = models.CharField(max_length=100, blank=True, default="")

    class Meta:
        verbose_name = "employee profile"
        verbose_name_plural = "employee profiles"

    def __str__(self) -> str:
        return f"{self.user.email} (#{self.employee_number or '-'})"


class AuditEvent(models.Model):
    """Append-only, HR-created audit record for employee administration.

    No update/delete through the app (policy item 11): actor, subject,
    UTC timestamp, actor request id, and before/after snapshots.
    """

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="audit_events_as_actor",
    )
    subject = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="audit_events_as_subject",
    )
    action = models.CharField(max_length=64)
    occurred_at = models.DateTimeField(default=timezone.now, db_index=True)
    request_id = models.CharField(max_length=128, blank=True, default="")
    before = models.JSONField(default=dict, blank=True)
    after = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-occurred_at", "-id"]
        verbose_name = "audit event"
        verbose_name_plural = "audit events"

    def __str__(self) -> str:
        return f"{self.action} on {self.subject_id} by {self.actor_id} at {self.occurred_at:%Y-%m-%dT%H:%M:%SZ}"
