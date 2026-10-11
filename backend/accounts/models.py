"""Accounts: identity, session auth endpoints, account activation state.

Owns identity only (approved architecture-security.md §3). Roles are
application roles (EMPLOYEE / MANAGER / HR) and are NOT Django superuser
status.
"""
from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.db.models import F
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


class Department(models.Model):
    """A workforce department and the manager responsible for it (Story H16).

    Departments are FLAT — one level, no parent — because the org asked for one
    level and nothing has needed a tree. ``manager`` is a User with role MANAGER
    who also belongs to this department; the service layer enforces both, the
    model keeps the columns honest. Membership itself lives on
    ``EmployeeProfile.department`` so a person holds at most one department.

    Deleting a row must never delete people: ``EmployeeProfile.department`` is
    SET_NULL, and the service deactivates (``is_active``) instead of deleting.
    """

    code = models.CharField(max_length=32, unique=True)
    name_ar = models.CharField(max_length=120)
    name_en = models.CharField(max_length=120, blank=True, default="")
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="managed_departments",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["code"]
        verbose_name = "department"
        verbose_name_plural = "departments"

    def __str__(self) -> str:
        return f"{self.name_ar or self.name_en} ({self.code})"


class EmployeeProfile(models.Model):
    """Organization-authoritative employee data (Story 1.3).

    Owns reporting line and employee-specific organization fields that are
    NOT identity: a nullable self-referencing manager FK, a nullable department
    FK (Story H16), employee number, and job title. Role, active status, and
    full name stay on User so auth behavior remains unchanged. HR-only writes;
    profile.py owns the model contract per architecture-security.md §3.
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
    # Nullable so the migration cannot break a single existing row: everyone who
    # predates departments simply has none until HR assigns one.
    department = models.ForeignKey(
        "Department",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="members",
    )

    class Meta:
        verbose_name = "employee profile"
        verbose_name_plural = "employee profiles"

    def __str__(self) -> str:
        return f"{self.user.email} (#{self.employee_number or '-'})"


class ManagerGrant(models.Model):
    """HR-granted scope for ONE employee, issued to ONE manager (Story H16).

    The default rule is the department: a manager reads and decides only for the
    people in their own department, and a call touching anybody else answers the
    shared 404-style envelope rather than disclosing that the person exists.

    HR can widen that rule per (manager, employee) — and per the owner's explicit
    decision a grant widens BOTH read and management (approve/reject) for that
    one employee, never for anyone else and never across departments.

    One row per (manager, employee, scope). Rows are DEACTIVATED, never deleted,
    so the audit trail and the HR screen can both show the history.
    """

    class Scope(models.TextChoices):
        REQUESTS = "requests", "Requests"
        TIMESHEETS = "timesheets", "Timesheets"
        ATTENDANCE = "attendance", "Attendance"
        REPORTS = "reports", "Reports"

    #: The closed list HR may hand out; anything else is rejected at validation.
    ALL_SCOPES = tuple(scope.value for scope in Scope)

    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="grants_as_manager",
    )
    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="grants_as_employee",
    )
    scope = models.CharField(max_length=16, choices=Scope.choices, db_index=True)
    is_active = models.BooleanField(default=True)
    # PROTECT mirrors AuditEvent: who granted what outlives the granting account.
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="grants_issued",
    )
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        verbose_name = "manager grant"
        verbose_name_plural = "manager grants"
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["manager", "employee", "scope"],
                name="uniq_manager_grant_scope",
            ),
            models.CheckConstraint(
                condition=~models.Q(manager=models.F("employee")),
                name="manager_grant_is_not_self",
            ),
        ]
        indexes = [models.Index(fields=["manager", "employee", "is_active"])]

    def __str__(self) -> str:
        return f"{self.manager_id}->{self.employee_id}:{self.scope}"


class SubscriptionCode(models.Model):
    """Self-service signup code for HR accounts (Story H14).

    One operator-issued code admits new HR users: while ``is_active`` a code
    is REUSABLE (several subscribers may use the same code) — there are no
    single-use semantics. The plaintext value is stored so an operator can
    read it back and hand it to a subscriber; uniqueness and indexing live
    on the column. Matching is done through :meth:`check_code`, which
    resolves the candidate row by exact lookup and then confirms it with
    ``hmac.compare_digest`` so a timing probe cannot narrow the value.
    """

    code = models.CharField(max_length=128, unique=True)
    label = models.CharField(max_length=200, blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    use_count = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "subscription code"
        verbose_name_plural = "subscription codes"

    def __str__(self) -> str:
        return f"{self.code} ({'active' if self.is_active else 'inactive'})"

    @classmethod
    def check_code(cls, value: str):
        """Return the active SubscriptionCode matching ``value`` or None.

        Constant-time-safe: the candidate row is fetched by unique index
        lookup, then the comparison is confirmed with
        ``hmac.compare_digest`` instead of ``==`` so byte-length / prefix
        timing cannot be used to probe the stored value.
        """
        import hmac

        candidate = cls.objects.filter(code__iexact=value).first()
        if candidate is None or not candidate.is_active:
            return None
        if not hmac.compare_digest(candidate.code, value):
            return None
        return candidate

    def record_use(self) -> None:
        """Count one successful signup against this code (reusable code)."""
        type(self).objects.filter(pk=self.pk).update(
            use_count=F("use_count") + 1, last_used_at=timezone.now()
        )


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
