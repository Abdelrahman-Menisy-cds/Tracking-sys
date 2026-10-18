"""Leave balances (أرصدة الإجازات): HR's entitlement per employee, leave type, year.

The HR settings panel «استحقاقات الإجازات - لكل موظف» had no endpoint behind
it, so it said so honestly. This is the model half of that panel.

TWO STORED NUMBERS, ONE DERIVED. ``entitled_days`` and ``carried_over_days``
are HR's configured entitlement — the only figures HR sets. ``used_days`` is
NOT stored: it is derived at read time from the APPROVED leave requests that
already exist in ``reqs`` (see services.used_days_map). The request rows ARE
the consumption record, so a second hand-maintained counter here would be a
second truth that drifts the moment a request is approved, returned, or
cancelled. remaining = entitled + carried_over − used, always recomputed.

Every row is tenant-anchored (``company``) and every query filters by it, so
one company's balances can never be read or written from another's session.
Adjustments are HR-only, versioned, idempotent, and append-only audited
(LeaveBalanceAdjustment + AuditEvent) — a stale write is refused, never
silently applied.
"""
from uuid import uuid4

from django.conf import settings
from django.db import models


class LeaveBalance(models.Model):
    """One employee's entitlement for ONE leave type in ONE year (H49 follow-up).

    The unique key is (employee, request_type, year): a leave type may only be
    configured once per person per year, so an adjustment updates the row it
    belongs to instead of forking a second one.
    """

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    # H30 §2.6: the tenant anchor. Mirrored from the acting HR at write time and
    # filtered on every read — never a bare, cross-company queryset.
    company = models.ForeignKey("accounts.Company", on_delete=models.PROTECT)
    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="leave_balances",
    )
    # The "leave type" IS a RequestType (the app has one request-type vocabulary;
    # services.leave_types pins the leave subset by name, matching the assistant).
    request_type = models.ForeignKey(
        "reqs.RequestType",
        on_delete=models.PROTECT,
        related_name="leave_balances",
    )
    year = models.PositiveIntegerField(db_index=True)
    entitled_days = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    carried_over_days = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    # Optimistic concurrency: a client sends the version it last saw; a stale
    # value is refused (services.VersionConflict -> 409) rather than winning.
    version = models.IntegerField(default=1)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="leave_balances_set",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("employee_id", "request_type__name")
        constraints = [
            models.UniqueConstraint(
                fields=("employee", "request_type", "year"),
                name="uniq_leavebalance_employee_type_year",
            ),
        ]
        verbose_name = "leave balance"
        verbose_name_plural = "leave balances"

    def __str__(self) -> str:
        return f"{self.employee_id} {self.request_type_id} {self.year}"


class LeaveBalanceAdjustment(models.Model):
    """Append-only ledger: one row per HR adjustment of a balance.

    The balance row is the current state; THIS is the audited history behind
    it. Nothing updates or deletes a ledger row, so "who changed what, why"
    outlives any later change to the balance. ``entitled_before``/``after``
    and ``carried_before``/``after`` are kept rather than a single delta so the
    history renders the actual movement either way.
    """

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    balance = models.ForeignKey(
        LeaveBalance,
        on_delete=models.CASCADE,
        related_name="adjustments",
    )
    # H30 §2.6: tenant anchor mirrored from the parent balance.
    company = models.ForeignKey("accounts.Company", on_delete=models.PROTECT)
    # PROTECT mirrors AuditEvent: who adjusted what outlives the acting account.
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="leave_balance_adjustments",
    )
    entitled_before = models.DecimalField(max_digits=6, decimal_places=2)
    entitled_after = models.DecimalField(max_digits=6, decimal_places=2)
    carried_before = models.DecimalField(max_digits=6, decimal_places=2)
    carried_after = models.DecimalField(max_digits=6, decimal_places=2)
    reason = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("-created_at", "-id")
        verbose_name = "leave balance adjustment"
        verbose_name_plural = "leave balance adjustments"

    def __str__(self) -> str:
        return f"adjust {self.balance_id} by {self.actor_id}"


class LeaveBalanceIdempotencyRecord(models.Model):
    """Stored adjust idempotency: key hash + payload hash + response snapshot.

    Same pattern the rest of the API uses (reqs.decision_services): the
    lookup AND insert run inside the locked adjustment transaction, and the
    (key_hash, user) unique constraint arbitrates concurrent same-key writes —
    identical payload replays the winner's response, a differing payload is a
    409. Scoped per user, so a key guessed by another HR is simply unknown to
    them and never leaks one adjuster's stored snapshot to another.
    """

    key_hash = models.CharField(max_length=64, db_index=True)
    payload_hash = models.CharField(max_length=64)
    response_snapshot = models.JSONField()
    # H30 §2.6: tenant anchor mirrored from the adjusting HR.
    company = models.ForeignKey("accounts.Company", on_delete=models.PROTECT)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="leave_balance_idempotency_records",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["key_hash", "user"],
                name="uniq_leavebalance_idem_key_user",
            )
        ]
        verbose_name = "leave balance idempotency record"
        verbose_name_plural = "leave balance idempotency records"

    def __str__(self) -> str:
        return f"idem {self.key_hash[:12]}… by {self.user_id}"
