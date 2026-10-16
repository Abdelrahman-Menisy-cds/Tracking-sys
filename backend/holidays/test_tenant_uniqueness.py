"""H30 R2 tests (§2.6 step 7): the holiday register is PER COMPANY.

The global natural-key constraint (country_code, date, name) flipped to
(company, country_code, date, name): two companies refresh the same country
independently; within one company the upsert key is unchanged.
"""

import datetime

import pytest
from django.db import IntegrityError, transaction

from accounts.models import Company
from holidays.models import PublicHoliday
from tenants.context import default_company

pytestmark = pytest.mark.django_db


def _holiday(company, name="Eid Al-Adha", date=None, country="EG"):
    return PublicHoliday.objects.create(
        company=company,
        country_code=country,
        date=date or datetime.date(2026, 5, 27),
        name=name,
        year=(date or datetime.date(2026, 5, 27)).year,
    )


def test_same_holiday_in_two_companies_is_legal():
    company_b = Company.objects.create(slug="hol-b", name="Holiday B")
    _holiday(default_company())
    _holiday(company_b)  # must NOT raise
    assert PublicHoliday.objects.filter(country_code="EG", name="Eid Al-Adha").count() == 2


def test_same_holiday_twice_in_one_company_is_rejected():
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _holiday(default_company())
            _holiday(default_company())


def test_same_holiday_different_countries_in_one_company_is_legal():
    _holiday(default_company(), country="EG")
    _holiday(default_company(), country="SA")  # different country: legal
    assert PublicHoliday.objects.count() == 2


def test_holiday_created_without_company_cannot_exist():
    """PublicHoliday has NO in-row anchor: a creator that forgets company is
    a hard IntegrityError, never a silent tenant-less row."""
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            PublicHoliday.objects.create(
                country_code="EG", date=datetime.date(2026, 5, 27), name="Anchorless", year=2026
            )
