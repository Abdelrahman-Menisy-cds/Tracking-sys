"""Public holidays register (Stage H1): the server side of the HR
admin-suite holidays surface (frontend/docs/design/hr-admin-suite.md §1.3/§1.4).

Nager.Date (https://date.nager.at/api/v3) is the authority for OFFICIAL
holidays; the OpenCode Go LLM is a supplement only (Arabic localisation +
proposals for Islamic holidays Nager does not carry), stored with
needs_confirmation=True and never presented as official. See services.py.
"""
from uuid import uuid4

from django.db import models


class PublicHoliday(models.Model):
    """One holiday row for one country and year.

    Identity is (country_code, date, name): Eid Al-Adha legitimately spans
    five consecutive dates with the same name in Nager.Date's payload, so
    neither (country_code, date) nor name alone is a key.
    """

    class Source(models.TextChoices):
        NAGER = "NAGER", "Nager.Date"
        LLM = "LLM", "LLM proposal"
        MANUAL = "MANUAL", "Manual entry"

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    country_code = models.CharField(max_length=2, db_index=True)
    date = models.DateField(db_index=True)
    name = models.CharField(max_length=200)
    name_local = models.CharField(max_length=200, blank=True, default="")
    source = models.CharField(
        max_length=8,
        choices=Source.choices,
        default=Source.NAGER,
        db_index=True,
    )
    # HR edited this row by hand: the refresh never touches it.
    is_manual_override = models.BooleanField(default=False)
    # LLM-proposed row HR has not confirmed: never presented as official.
    needs_confirmation = models.BooleanField(default=False)
    is_recurring = models.BooleanField(default=False)
    # Nager's own stable id, when its payload carries one (currently null:
    # the upsert key is the natural triple below).
    external_id = models.CharField(max_length=120, null=True, blank=True)
    year = models.PositiveIntegerField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("date", "name")
        constraints = [
            models.UniqueConstraint(
                fields=["country_code", "date", "name"],
                name="uniq_holiday_country_date_name",
            )
        ]
        verbose_name = "public holiday"
        verbose_name_plural = "public holidays"

    def __str__(self) -> str:
        return f"{self.name} ({self.country_code} {self.date})"
