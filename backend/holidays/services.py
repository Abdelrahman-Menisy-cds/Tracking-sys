"""Holiday refresh service (Stage H1): Nager-authoritative, LLM-assisted.

refresh_public_holidays(year, country_code) is the single mutation behind
POST /api/v1/holidays/refresh and is idempotent in the same spirit as the
reqs idempotency records: running it twice re-derives the same rows.

- Nager.Date is the ONLY authority for official holidays. Official rows
  upsert on the natural key (country_code, date, name) — several rows
  legitimately share a name (Eid Al-Adha spans five dates), so neither
  (country_code, date) nor name alone is a key.
- Rows HR edited by hand (is_manual_override=True) are never touched and
  are reported preserved.
- The LLM supplements, never authorises: it fills Arabic names only where
  Nager's localName is not Arabic (ONE batched call for every such name,
  including proposals) and proposes Islamic holidays Nager does not carry.
  Proposals store source=LLM / needs_confirmation=True and are never
  presented as official.
- Degradation is honest: a dead LLM leaves the official import successful
  (llm_available=False and/or a warning); a dead Nager raises
  NagerUnavailableError so the view reports failure — nothing is written.
"""
import datetime
import logging

from django.db import transaction

from holidays.llm import (
    LLMBadResponseError,
    LLMEmptyContentError,
    LLMUnavailableError,
    has_arabic_script,
    localise_holiday_names,
    normalize_name,
    propose_missing_islamic_holidays,
)
from holidays.models import PublicHoliday
from holidays.nager import NagerError, fetch_public_holidays

logger = logging.getLogger(__name__)

NAME_MAX_LENGTH = 200


class NagerUnavailableError(Exception):
    """Nager.Date could not be reached; no rows were written."""


def _truncate(value):
    if not isinstance(value, str):
        return ""
    return value.strip()[:NAME_MAX_LENGTH]


def refresh_public_holidays(year, country_code, *, company):
    """Refresh one company's holiday register for (country, year).

    H30 §2.6 step 7: the register is PER COMPANY — ``company`` is the acting
    HR's company, threaded from the view (the only caller). Every read and
    write below is scoped to it, so two companies refreshing the same country
    never collide and never see each other's rows.
    """
    country_code = str(country_code).strip().upper()
    warnings = []

    # 1. Official import — Nager is the authority. Failure aborts before any write.
    try:
        rows = fetch_public_holidays(year, country_code)
    except NagerError as exc:
        raise NagerUnavailableError(str(exc)) from exc

    # 2. LLM proposals for the Islamic holidays Nager does not carry.
    try:
        proposals = propose_missing_islamic_holidays(
            year,
            country_code,
            already_present=[row.get("name") or "" for row in rows],
        )
        proposals_available = True
    except (LLMUnavailableError, LLMBadResponseError) as exc:
        proposals_available = False
        proposals = []
        warnings.append(f"Missing-holiday proposals skipped: {exc}")

    # 3. ONE batched translation call for every name that is not Arabic yet
    #    (Nager rows and proposals alike).
    needs_arabic = set()
    for row in rows:
        if row.get("name") and not has_arabic_script(row.get("local_name") or ""):
            needs_arabic.add(row["name"].strip())
    for proposal in proposals:
        if not has_arabic_script(proposal.get("name_local") or ""):
            needs_arabic.add(proposal["name"])
    translations = {}
    if needs_arabic:
        try:
            translations = localise_holiday_names(sorted(needs_arabic))
            if not translations:
                warnings.append(
                    "Arabic localisation returned nothing usable; source names kept."
                )
        except (LLMUnavailableError, LLMBadResponseError) as exc:
            warnings.append(f"Arabic localisation skipped: {exc}")

    for row in rows:
        arabic = translations.get((row.get("name") or "").strip())
        if arabic and not has_arabic_script(row.get("local_name") or ""):
            row["local_name"] = arabic
    for proposal in proposals:
        if not has_arabic_script(proposal.get("name_local") or ""):
            proposal["name_local"] = translations.get(proposal["name"], "")

    # 4. Upsert official rows (never touching manual overrides).
    added, updated, unchanged, manual_preserved = _upsert_official(rows, country_code, company)

    # 5. Store proposals — never as official rows.
    proposed_missing = _store_proposals(year, country_code, proposals, company)

    return {
        "year": year,
        "country": country_code,
        "added": added,
        "updated": updated,
        "unchanged": unchanged,
        "manual_preserved": manual_preserved,
        "proposed_missing": proposed_missing,
        "llm_available": proposals_available,
        "warnings": warnings,
    }


def _upsert_official(rows, country_code, company):
    """Upsert Nager rows keyed on (company, country_code, date, name).

    Rows HR edited by hand (is_manual_override=True) are left byte-for-byte
    untouched and reported preserved. An existing row's Arabic name_local is
    never downgraded to a non-Arabic value (a degraded refresh without the
    LLM keeps earlier localisation). Runs in one transaction; select_for_update
    serialises concurrent double-clicks, and the per-company unique constraint
    on the natural key arbitrates any residual race.
    """
    added = updated = unchanged = preserved = 0
    with transaction.atomic():
        for item in rows:
            name = _truncate(item.get("name") or "")
            if not name:
                continue
            try:
                holiday_date = datetime.date.fromisoformat(item.get("date"))
            except (TypeError, ValueError):
                continue
            new_local = _truncate(item.get("local_name") or "")
            current = (
                PublicHoliday.objects.select_for_update()
                .filter(company=company, country_code=country_code, date=holiday_date, name=name)
                .first()
            )
            if current is not None and current.is_manual_override:
                preserved += 1
                continue
            if current is None:
                PublicHoliday.objects.create(
                    company=company,
                    country_code=country_code,
                    date=holiday_date,
                    name=name,
                    name_local=new_local,
                    source=PublicHoliday.Source.NAGER,
                    needs_confirmation=False,
                    year=holiday_date.year,
                )
                added += 1
                continue
            # An Arabic name already on the row is never replaced. The LLM's
            # phrasing varies between runs, so allowing a fresh Arabic translation
            # to win would rewrite a handful of names every single night — churn
            # that reads as activity in the log while nothing actually changed.
            # The LLM fills gaps; a human corrects a bad name through the UI, and
            # that edit is a manual override this loop already skips.
            if has_arabic_script(current.name_local):
                new_local = current.name_local
            if current.name_local == new_local:
                unchanged += 1
            else:
                current.name_local = new_local
                current.save(update_fields=["name_local", "updated_at"])
                updated += 1
    return added, updated, unchanged, preserved


def _store_proposals(year, country_code, proposals, company):
    """Create LLM-proposed rows; never update or present them as official.

    A proposal is stored only when its name is not already in the COMPANY's
    register for the year (so the second refresh proposes nothing) and its
    exact per-company natural key is free. Malformed or out-of-year dates
    were already dropped by the LLM client; this is the belt-and-braces
    second gate.
    """
    if not proposals:
        return 0
    existing_names = {
        normalize_name(name)
        for name in PublicHoliday.objects.filter(
            company=company, country_code=country_code, year=year
        ).values_list("name", flat=True)
    }
    created = 0
    for proposal in proposals:
        name = _truncate(proposal.get("name") or "")
        if not name or normalize_name(name) in existing_names:
            continue
        try:
            holiday_date = datetime.date.fromisoformat(proposal.get("date"))
        except (TypeError, ValueError):
            continue
        if holiday_date.year != year:
            continue
        if PublicHoliday.objects.filter(
            company=company, country_code=country_code, date=holiday_date, name=name
        ).exists():
            continue
        PublicHoliday.objects.create(
            company=company,
            country_code=country_code,
            date=holiday_date,
            name=name,
            name_local=_truncate(proposal.get("name_local") or ""),
            source=PublicHoliday.Source.LLM,
            needs_confirmation=True,
            year=holiday_date.year,
        )
        existing_names.add(normalize_name(name))
        created += 1
    return created
