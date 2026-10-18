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
        # H30 plan §2.2: a superuser binds to a company too — the default
        # company unless the caller passes one explicitly (break-glass only).
        if extra_fields.get("company") is None:
            from tenants.context import default_company

            extra_fields["company"] = default_company()
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
    # H30 plan §2.2: one user belongs to exactly one company. Nullable through
    # the 0011 step, backfilled in 0012, hard (null=False) from 0013 on.
    company = models.ForeignKey(
        "Company",
        on_delete=models.PROTECT,
        related_name="users",
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


class Company(models.Model):
    """The tenant anchor (H30 plan §2.1).

    One row per company; every tenant table carries a ``company`` FK back to
    it and every scoped read goes through ``tenants.managers.TenantManager``.
    ``slug`` is the stable generated identifier; ``__default__`` is the home
    of every row that predates per-company signup (the §2.6 data migration).
    The FIRST user of a company is its HR — today's ``sign_up`` grants
    ``role=HR`` and that stays the company-founder shape.
    """

    slug = models.SlugField(max_length=64, unique=True)
    name = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        verbose_name = "company"
        verbose_name_plural = "companies"

    def __str__(self) -> str:
        return f"{self.name} ({self.slug})"


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

    company = models.ForeignKey("Company", on_delete=models.PROTECT)
    # H30 §2.6 step 5: department codes are company-internal — per-company
    # uniqueness (uniq_department_company_code), not global.
    code = models.CharField(max_length=32)
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
        constraints = [
            models.UniqueConstraint(fields=["company", "code"], name="uniq_department_company_code"),
        ]

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

    # H30 plan §2.6: the tenant anchor, denormalized from ``user.company``;
    # creation paths (employee_service) keep the two in agreement.
    company = models.ForeignKey("Company", on_delete=models.PROTECT)
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
    # H30 §2.6 step 5: employee numbers are company-internal — per-company
    # uniqueness, conditional on the number being set at all.
    employee_number = models.CharField(max_length=32, null=True, blank=True)
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
        constraints = [
            models.UniqueConstraint(
                fields=["company", "employee_number"],
                condition=models.Q(employee_number__isnull=False),
                name="uniq_employeeprofile_company_employee_number",
            ),
        ]

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

    company = models.ForeignKey("Company", on_delete=models.PROTECT)
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


class CompanyProfile(models.Model):
    """Company identity, ONE row per company (Story H17; per-company since H30).

    H30 §2.4 replaced the pk=1 forced singleton with a ``company`` OneToOne
    (``related_name="profile"``): the row is created on the company's first
    save, and every reader resolves it through the caller's company (readers
    answer None / ``needs_profile`` until then). The old
    ``chk_company_profile_singleton`` check is gone with the singleton.

    Required fields (name/activity/address/phone) stay blank-forbidden at the
    model level AND are re-checked as a merged set by the view, so a PATCH
    that would blank one is refused at the API boundary too. Optional fields
    (email/website/logo …) are blank by design — the owner asked for only a
    subset up front. ``logo_data_url`` keeps the resized data: URL produced by
    the frontend; the server validates its shape and size but never decodes
    or serves it (the SPA renders it directly).
    """

    REQUIRED_FIELDS = ("name", "activity", "address", "phone")

    company = models.OneToOneField(
        "Company",
        on_delete=models.PROTECT,
        related_name="profile",
    )
    name = models.CharField(max_length=200)
    activity = models.CharField(max_length=200)
    address = models.CharField(max_length=300)
    phone = models.CharField(max_length=32)

    email = models.EmailField(blank=True, default="")
    website = models.URLField(blank=True, default="")
    logo_data_url = models.TextField(blank=True, default="")
    commercial_register = models.CharField(max_length=64, blank=True, default="")
    tax_card = models.CharField(max_length=64, blank=True, default="")
    contact_name = models.CharField(max_length=120, blank=True, default="")
    contact_role = models.CharField(max_length=120, blank=True, default="")
    contact_phone = models.CharField(max_length=32, blank=True, default="")

    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="company_profile_updates",
    )

    class Meta:
        verbose_name = "company profile"
        verbose_name_plural = "company profile"

    def __str__(self) -> str:
        return self.name


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
    # H30 plan §2.3/§2.5: NULL only for operator-issued bootstrap "create
    # company" codes — this FK deliberately STAYS nullable (0013 does not
    # harden it); every existing code backfills into the default company.
    company = models.ForeignKey(
        "Company",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="signup_codes",
    )
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


class PendingDeviceFlow(models.Model):
    """H28 — the in-app subscription device-login flow, persisted.

    The flow used to live in django.core.cache (locmem): process memory, so
    every server restart destroyed a flow the owner was mid-way through
    approving (measured: poll answered 409 no_pending_flow after the
    dev-server restart). The row IS that state now, keyed by user (one
    pending flow per account), so a restart loses nothing.

    ``device_code_or_id`` is the SECRET the provider's poll needs (opencode:
    device_code; codex: device_auth_id) — server-side only, never in any
    response; ``user_code`` is the display code the SPA already shows.

    H30 §2.6: tenant-scoped — ``company`` mirrors the user's.
    """

    company = models.ForeignKey("Company", on_delete=models.PROTECT)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="pending_device_flow",
    )
    provider = models.CharField(max_length=32)
    device_code_or_id = models.CharField(max_length=512)
    user_code = models.CharField(max_length=64, blank=True, default="")
    user_email = models.CharField(max_length=254, blank=True, default="")
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "pending device flow"
        verbose_name_plural = "pending device flows"

    def __str__(self) -> str:
        return f"flow:{self.user_id} ({self.provider})"

    @classmethod
    def expired_pks(cls):
        return list(cls.objects.filter(expires_at__lt=timezone.now()).values_list("pk", flat=True))


class AuditEvent(models.Model):
    """Append-only, HR-created audit record for employee administration.

    No update/delete through the app (policy item 11): actor, subject,
    UTC timestamp, actor request id, and before/after snapshots. The trail
    itself is tenant-scoped: ``company`` is the actor's company (H30 §2.6).
    """

    company = models.ForeignKey("Company", on_delete=models.PROTECT)
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


class AssistantConfig(models.Model):
    """Per-user provider link for the «مدام عفاف» assistant (Story H18).

    ONE row per user (the settings live on the employee's /profile and HR's
    /admin/people/<id>; there is never a reason for a second row). The API key
    is stored ENCRYPTED AT REST (cryptography.fernet; see
    assistant_crypto.py) and is NEVER returned by any endpoint — responses
    carry only ``api_key_hint``. Whoever supplied the key is kept in
    ``api_key_set_by`` so ``key_source`` can be derived honestly:

      * key set through the user's own /profile PUT -> "self"
      * key set by HR in the employee's file        -> "hr"

    The owner's rule: the employee cannot READ an HR-set key, but MAY replace
    it. A replacement (self PUT) overwrites the ciphertext and re-marks the
    row "self" — the old key's origin no longer exists to disclose.

    ``is_active`` is the single switch that gates chat/test: HR toggles it
    (``enabled_by_hr`` records that they did). ``is_configured`` is derived,
    not stored: base_url + model + a key present.

    No provider presets anywhere: plain OpenAI-compatible free-form endpoint
    fields, per the owner's explicit decision.

    H30 §2.6: the row is tenant-scoped — ``company`` mirrors the user's.
    """

    company = models.ForeignKey("Company", on_delete=models.PROTECT)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="assistant_config",
    )
    base_url = models.URLField(blank=True, default="")
    api_key_ciphertext = models.BinaryField(blank=True, default=b"")
    api_key_hint = models.CharField(max_length=32, blank=True, default="")
    api_key_set_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assistant_keys_set",
    )
    model = models.CharField(max_length=120, blank=True, default="")
    is_active = models.BooleanField(default=False)
    enabled_by_hr = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    # --- Story H19: subscription link (opencode / Codex), not just a key ---
    # Exactly ONE credential per row: linking a subscription clears the
    # api-key fields and vice versa. The credential material (a provider key
    # blob {"key","type"} or an oauth set {"access","refresh","expires"})
    # is stored encrypted with the same Fernet pipeline as the API key
    # (assistant_crypto), never returned by any endpoint (only the hint),
    # never logged, never in AuditEvent (booleans only).
    subscription_provider = models.CharField(max_length=32, blank=True, default="")
    subscription_ciphertext = models.BinaryField(blank=True, default=b"")
    subscription_hint = models.CharField(max_length=64, blank=True, default="")
    subscription_cred_type = models.CharField(max_length=8, blank=True, default="")
    subscription_source = models.CharField(max_length=16, blank=True, default="")
    subscription_expires = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "assistant config"
        verbose_name_plural = "assistant configs"

    def __str__(self) -> str:
        owner_id = getattr(self, "user_id", None)
        return f"assistant:{owner_id} ({'active' if self.is_active else 'inactive'})"

    @property
    def key_source(self):
        """'"self"' | '"hr"' | None, derived from who set the key."""
        if self.api_key_ciphertext or self.api_key_hint:
            if self.api_key_set_by_id is None:
                return None
            # Derive from WHO the config belongs to, not the setter's role: an
            # HR user linking their OWN key must read "self" (brief H18).
            return "self" if self.api_key_set_by_id == self.user_id else "hr"
        return None

    @property
    def is_configured(self) -> bool:
        """base_url and model present and a key stored (brief table) — OR,
        subscription mode (H19): provider + model + an encrypted credential."""
        if self.subscription_provider:
            return bool(self.model and self.subscription_ciphertext)
        return bool(self.base_url and self.model and (self.api_key_ciphertext or self.api_key_hint))

    @property
    def mode(self) -> str:
        """'subscription' when a provider is linked, else 'api' (derived —
        one source of truth, no extra flag)."""
        return "subscription" if self.subscription_provider else "api"


class WorkSchedule(models.Model):
    """The organization's official work week (Story H39, phase 1).

    The enterprise-settings card had nothing to read or write — no model, no
    endpoint — so it honestly reported "no schedule, no version history".
    This is the server half of that card.

    ``company`` is mandatory: every row belongs to exactly one tenant and
    every read is filtered by it (the cb74a25 lesson — an unscoped settings
    read crossed tenants).

    One ACTIVE schedule per company at any time (brief H39): enforced by the
    partial unique index below and kept consistent by the service, which
    deactivates the previous active inside the same transaction as the new
    activation. Deactivation (the DELETE endpoint) flips ``is_active`` and
    KEEPS the row — the settings card explicitly wants a version trail, and
    an inactive schedule is exactly that history.
    """

    company = models.ForeignKey("Company", on_delete=models.PROTECT, related_name="work_schedules")
    name = models.CharField(max_length=120)
    effective_from = models.DateField()
    # Open-ended until HR sets an end (e.g. the Ramadan variant ends, the
    # official schedule does not).
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=False, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="work_schedules_created",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_active", "-created_at", "-id"]  # the active row first
        verbose_name = "work schedule"
        verbose_name_plural = "work schedules"
        constraints = [
            models.UniqueConstraint(
                fields=["company"],
                condition=models.Q(is_active=True),
                name="uniq_workschedule_company_active",
            ),
            # NULL end (open-ended) can never violate the range: SQL compares
            # NULL as unknown, so the isnull branch is required, not cosmetic.
            models.CheckConstraint(
                condition=models.Q(effective_to__isnull=True)
                | models.Q(effective_from__lte=models.F("effective_to")),
                name="workschedule_effective_range",
            ),
        ]

    def __str__(self) -> str:
        state = "active" if self.is_active else "inactive"
        return f"{self.name} ({self.company.slug}, {state})"


class WorkScheduleDay(models.Model):
    """One weekday row of a WorkSchedule (Story H39).

    ``weekday`` follows the brief's convention — 0=Sunday … 6=Saturday, the
    JS ``getDay()`` order the SPA already uses — NOT Python's ``weekday()``
    (Monday-first). The check constraint pins 0-6 so the convention is
    stored, not just documented.

    A working day carries start/end (end strictly after start — the
    serializer rejects otherwise); a rest day carries none, and a PATCH that
    marks a day non-working normalizes its times to NULL rather than keeping
    a contradictory pair.
    """

    schedule = models.ForeignKey("WorkSchedule", on_delete=models.PROTECT, related_name="days")
    weekday = models.PositiveSmallIntegerField()
    is_working_day = models.BooleanField(default=True)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    break_minutes = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["weekday"]
        verbose_name = "work schedule day"
        verbose_name_plural = "work schedule days"
        constraints = [
            models.UniqueConstraint(
                fields=["schedule", "weekday"],
                name="uniq_workscheduleday_schedule_weekday",
            ),
            models.CheckConstraint(
                condition=models.Q(weekday__gte=0) & models.Q(weekday__lte=6),
                name="workscheduleday_weekday_0_6",
            ),
            models.CheckConstraint(
                condition=models.Q(is_working_day=False)
                | (models.Q(start_time__isnull=False) & models.Q(end_time__isnull=False)),
                name="workscheduleday_working_has_times",
            ),
        ]

    def __str__(self) -> str:
        kind = "working" if self.is_working_day else "rest"
        return f"{self.schedule_id} day {self.weekday} ({kind})"


class AttendanceEvent(models.Model):
    """One clock-in or clock-out. The day's state is derived from these, never stored.

    Storing a derived status would drift the moment an event is corrected; the
    schedule plus the events is the whole truth.
    """

    class Kind(models.TextChoices):
        CLOCK_IN = "CLOCK_IN", "Clock in"
        CLOCK_OUT = "CLOCK_OUT", "Clock out"

    company = models.ForeignKey("Company", on_delete=models.CASCADE, related_name="attendance_events")
    user = models.ForeignKey("User", on_delete=models.CASCADE, related_name="attendance_events")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    occurred_at = models.DateTimeField()
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["occurred_at"]
        verbose_name = "attendance event"
        verbose_name_plural = "attendance events"
        indexes = [
            models.Index(fields=["company", "user", "occurred_at"], name="attend_company_user_time"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} {self.kind} @ {self.occurred_at:%Y-%m-%d %H:%M}"


class Task(models.Model):
    """One piece of work: created by someone, assigned to someone.

    «مهامي» and «مهام أنشأتها» are the two sides of the same row, which is why the
    owner and the assignee are separate columns rather than one.
    """

    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        DONE = "DONE", "Done"

    company = models.ForeignKey("Company", on_delete=models.CASCADE, related_name="tasks")
    owner = models.ForeignKey(
        "User", on_delete=models.CASCADE, related_name="tasks_created"
    )
    assignee = models.ForeignKey(
        "User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tasks_assigned",
    )
    title = models.CharField(max_length=200)
    details = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN)
    due_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "task"
        verbose_name_plural = "tasks"
        indexes = [
            models.Index(fields=["company", "assignee"], name="task_company_assignee"),
            models.Index(fields=["company", "owner"], name="task_company_owner"),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.status})"
