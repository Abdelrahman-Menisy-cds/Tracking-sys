"""Employee administration services — Story 1.3.

HR-only command logic for creating/updating/deactivating employees and
maintaining the reporting line. All mutations are transactional, allowlist-
bounded, raise field-level errors on manager problems before anything is
staged, and append an append-only AuditEvent with before/after snapshots
(policy items 1, 6, 11; epics.md lines 173-191).
"""
from django.db import transaction
from django.utils.translation import gettext_lazy as _

from accounts.models import AuditEvent, Department, EmployeeProfile, User
from accounts.services import deactivate_user

AUDIT_TRACKED_FIELDS = ("email", "full_name", "role", "is_active", "employee_number", "job_title", "manager", "department")


class EmployeeValidationError(ValueError):
    """Carries field-level errors for safe API translation."""

    def __init__(self, field, message):
        self.field = field
        self.message = message
        super().__init__(message)


def _snapshot(user, profile=None):
    return {
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
        "employee_number": profile.employee_number if profile else None,
        "job_title": profile.job_title if profile else "",
        "manager": profile.manager_id if profile else None,
        "department": profile.department_id if profile else None,
    }


def _normalized_email(user, raw_email):
    """Normalize a proposed email and reject duplicates with a field error."""
    email = raw_email.strip().lower()
    if email == user.email:
        return email
    if User.objects.filter(email=email).exists():
        raise EmployeeValidationError("email", "A user with this email already exists.")
    return email


def _normalize_email_for_compare(raw_email):
    # Emails are immutable identifiers here; strip + lower on both sides so
    # create and update apply the exact same comparison (case-insensitive).
    return raw_email.strip().lower()


def _normalize_employee_number(raw_number):
    # Duplicate policy for employee_number: strip surrounding whitespace and
    # casefold so 'EMP-001', ' emp-001 ' and 'emp-001' are the same number.
    # Both create and update must use this identical normalization — the DB
    # unique index is raw, so app-level comparison is the real contract gate.
    return raw_number.strip().casefold()


def _validate_employee_number_unique(*, profile_owner_pk, raw_number):
    """Raise a field error if another employee already holds this number."""
    normalized = _normalize_employee_number(raw_number)
    conflict = EmployeeProfile.objects.filter(
        employee_number__iexact=normalized
    ).exclude(user_id=profile_owner_pk).exists()
    if conflict:
        raise EmployeeValidationError(
            "employee_number", "An employee with this employee number already exists."
        )
    return raw_number.strip() or None


def _validate_manager(user, manager_pk):
    """Return the manager or None; raise field-level errors for bad ones."""
    if manager_pk is None:
        return None
    if manager_pk == user.pk:
        raise EmployeeValidationError("manager", "An employee cannot be their own manager.")
    try:
        manager = User.objects.get(pk=manager_pk)
    except (User.DoesNotExist, ValueError, TypeError):
        raise EmployeeValidationError("manager", "The proposed manager does not exist.") from None
    if not manager.is_active:
        raise EmployeeValidationError("manager", "The proposed manager must be an active user.")
    return manager


def _validate_department(department_pk):
    """Return the Department, or None; a bad id is a field error, never a 500."""
    if department_pk is None or department_pk == "":
        return None
    try:
        department = Department.objects.get(pk=department_pk)
    except (Department.DoesNotExist, ValueError, TypeError):
        raise EmployeeValidationError("department", "The proposed department does not exist.") from None
    if not department.is_active:
        raise EmployeeValidationError("department", "The proposed department is inactive.")
    return department


def _validate_manager_department(manager, department):
    """A manager must belong to the employee's department, or the pair is refused.

    Owner's rule (Story H16): a manager must never sit over somebody outside
    their own department. It only bites once the employee HAS a department —
    everybody who predates departments keeps the old reporting-line behaviour.
    """
    if manager is None or department is None:
        return
    manager_department_id = getattr(getattr(manager, "employee_profile", None), "department_id", None)
    if manager_department_id != department.pk:
        raise EmployeeValidationError(
            "manager",
            _("The manager is not a member of the employee's department."),
        )


def _would_create_cycle(user, manager):
    """Walk up from the proposed manager; reaching the employee is a cycle."""
    seen = set()
    current = manager
    while current is not None:
        if current.pk == user.pk:
            return True
        if current.pk in seen:
            return False
        seen.add(current.pk)
        try:
            current = current.employee_profile.manager
        except EmployeeProfile.DoesNotExist:
            return False
    return False


def _append_event(*, actor, subject, action, request_id, before, after):
    """Append-only audit write (policy item 11) — never updated or deleted."""
    return AuditEvent.objects.create(
        # H30 §2.6: the trail itself is tenant-scoped (the actor's company).
        company=actor.company,
        actor=actor,
        subject=subject,
        action=action,
        request_id=request_id or "",
        before=before,
        after=after,
    )


@transaction.atomic
def create_employee(*, actor, validated_data):
    """Create a user plus its profile atomically. HR-only, no superuser path."""
    request_id = validated_data.pop("request_id", "")
    manager_pk = validated_data.get("manager")
    user_fields = {
        f: validated_data[f]
        for f in ("email", "full_name", "role", "is_active")
        if f in validated_data
    }
    user_fields.setdefault("role", User.Role.EMPLOYEE)
    user_fields.setdefault("is_active", True)
    user_fields.setdefault("full_name", "")
    # H30 plan §2.2: cross-company creation is not a feature — the new user
    # belongs to the actor's (the HR's) company, and its profile inherits it.
    user_fields["company"] = actor.company
    user_fields["email"] = _normalize_email_for_compare(user_fields["email"])
    # Field-level duplicate checks run BEFORE anything is staged so a rejected
    # create never leaves a half-built user/profile (and never becomes a 500
    # IntegrityError). Create has no owner yet, so use a sentinel negative pk.
    if User.objects.filter(email=user_fields["email"]).exists():
        raise EmployeeValidationError("email", "A user with this email already exists.")
    if "employee_number" in validated_data:
        _validate_employee_number_unique(profile_owner_pk=-1, raw_number=validated_data["employee_number"])

    probe = User(**user_fields)
    manager = _validate_manager(probe, manager_pk)
    if manager is not None and _would_create_cycle(probe, manager):
        raise EmployeeValidationError("manager", "This reporting line would create a reporting cycle.")
    department = _validate_department(validated_data.get("department")) if "department" in validated_data else None
    _validate_manager_department(manager, department)

    profile_fields = {
        f: validated_data[f] for f in ("employee_number", "job_title") if f in validated_data
    }
    if "department" in validated_data:
        profile_fields["department"] = department

    # HR-created accounts receive an unusable-style random password; the
    # password issuance/reset flow is a separate story. No superuser is
    # ever created here (create_user only).
    from django.utils.crypto import get_random_string

    password = get_random_string(20)
    user = User.objects.create_user(password=password, **user_fields)
    profile = EmployeeProfile.objects.create(
        user=user, manager=manager, company=user.company, **profile_fields
    )

    _append_event(
        actor=actor,
        subject=user,
        action="employee.created",
        request_id=request_id,
        before={},
        after=_snapshot(user, profile),
    )
    return user, profile


@transaction.atomic
def update_employee(*, actor, user, validated_data):
    """Apply allowlisted authoritative changes inside one transaction.

    Manager validation runs before any field is staged so a rejected save
    leaves the prior relationship (and everything else) unchanged. An
    is_active=False transition routes through deactivate_user() so the
    target's server-side sessions are revoked.
    """
    request_id = validated_data.pop("request_id", "")

    if not user.is_active and validated_data.get("is_active") is False:
        # Already inactive: nothing left to revoke; still allow other fields.
        validated_data.pop("is_active", None)

    if "email" in validated_data:
        # Resolve to a normalized, unique email before anything is staged.
        validated_data["email"] = _normalized_email(user, validated_data["email"])

    if "manager" in validated_data:
        # Resolve to a validated manager instance before anything is staged.
        manager = _validate_manager(user, validated_data["manager"])
        if manager is not None and _would_create_cycle(user, manager):
            raise EmployeeValidationError("manager", "This reporting line would create a reporting cycle.")
    else:
        manager = user.employee_profile.manager if hasattr(user, "employee_profile") else None
    if "department" in validated_data:
        department = _validate_department(validated_data["department"])
    else:
        department = getattr(getattr(user, "employee_profile", None), "department", None)
    # The pair is checked against the EFFECTIVE values, so moving either side of
    # the relationship can never leave a manager outside the employee's department.
    # It only runs when one of the two is actually being changed: a reporting line
    # that predates this rule (or was set before a department move) must not make
    # the whole row uneditable — the unrelated fields have nothing to do with it.
    if "manager" in validated_data or "department" in validated_data:
        _validate_manager_department(manager, department)

    before = _snapshot(user, getattr(user, "employee_profile", None))
    user_fields = {
        f: validated_data[f]
        for f in ("email", "full_name", "role", "is_active")
        if f in validated_data and getattr(user, f) != validated_data[f]
    }
    profile_fields = {
        f: validated_data[f]
        for f in ("employee_number", "job_title")
        if f in validated_data
    }
    if "department" in validated_data:
        profile_fields["department"] = department
    if "employee_number" in profile_fields:
        if profile_fields["employee_number"] is None:
            pass
        else:
            # Mirror of _normalized_email(): a stripped/casefolded duplicate
            # collision on employee_number is a field error, not a 500.
            normalized = _normalize_employee_number(profile_fields["employee_number"])
            if normalized == _normalize_employee_number(
                getattr(getattr(user, "employee_profile", None), "employee_number", "") or ""
            ):
                # Same-value reassignment (any casing/spacing) is a normalized
                # no-op and intentionally allowed (documented contract test).
                profile_fields["employee_number"] = (profile_fields["employee_number"] or "").strip()
            else:
                _validate_employee_number_unique(
                    profile_owner_pk=user.pk, raw_number=profile_fields["employee_number"]
                )

    audit_changes = {}
    if user_fields:
        if "is_active" in user_fields and user_fields["is_active"] is False:
            # deactivate_user() persists is_active=False and revokes the
            # target's server-side sessions; sibling changed fields must be
            # persisted in the same transaction, so save them explicitly
            # alongside (never rely on deactivate_user to carry them).
            sibling_fields = [f for f in user_fields if f != "is_active"]
            for field, value in user_fields.items():
                setattr(user, field, value)
            if sibling_fields:
                user.save(update_fields=sibling_fields)
            deactivate_user(user=user)  # also revokes active sessions
        else:
            for field, value in user_fields.items():
                setattr(user, field, value)
            user.save(update_fields=list(user_fields))
        audit_changes.update(user_fields)
    if profile_fields or "manager" in validated_data:
        profile, _created = EmployeeProfile.objects.get_or_create(
            user=user, defaults={"company": user.company}
        )
        if "manager" in validated_data:
            if profile.manager_id != (manager.pk if manager else None):
                audit_changes["manager"] = manager.pk if manager else None
            profile.manager = manager
        for field, value in profile_fields.items():
            if getattr(profile, field) != value:
                # The audit row is stored as JSON, so a relation is recorded by
                # its key: writing the Department object itself raised
                # «Object of type Department is not JSON serializable» and turned
                # EVERY department change into a 500.
                audit_changes[field] = value.pk if field == "department" else value
            setattr(profile, field, value)
        profile.save()

    if audit_changes:
        _append_event(
            actor=actor,
            subject=user,
            action="employee.updated",
            request_id=request_id,
            before={f: before.get(f) for f in audit_changes},
            after=audit_changes,
        )
    return user
