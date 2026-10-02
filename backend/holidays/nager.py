"""Nager.Date API client (https://date.nager.at/api/v3).

Deliberately Django-free (stdlib urllib only) so the client is testable
without the app registry and adds no dependency. One attempt per call —
no retry storm: callers (holidays.services) decide whether to degrade.
Failures raise the single NagerError type with a clear cause.
"""
import datetime
import json
import urllib.error
import urllib.request

BASE_URL = "https://date.nager.at/api/v3"
DEFAULT_TIMEOUT_SECONDS = 10

_USER_AGENT = "heya-fawda-tracking/1.0"


class NagerError(Exception):
    """Any failure talking to Nager.Date (network, HTTP status, payload)."""


def _get_json(path):
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        headers={"Accept": "application/json", "User-Agent": _USER_AGENT},
    )
    try:
        with urllib.request.urlopen(request, timeout=DEFAULT_TIMEOUT_SECONDS) as response:
            raw = response.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise NagerError(f"Nager.Date request failed: {exc}") from exc
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise NagerError("Nager.Date returned a non-JSON payload") from exc


def _clean_country_code(country_code):
    code = str(country_code).strip().upper() if country_code is not None else ""
    if len(code) != 2 or not code.isalpha() or not code.isascii():
        return None
    return code


def fetch_available_countries():
    """Return [{"country_code": "EG", "name": "Egypt"}, ...]."""
    data = _get_json("/AvailableCountries")
    if not isinstance(data, list):
        raise NagerError("Nager.Date AvailableCountries payload was not a list")
    countries = []
    for item in data:
        if not isinstance(item, dict):
            continue
        code = item.get("countryCode")
        if not isinstance(code, str) or not code.strip():
            continue
        name = item.get("name")
        countries.append(
            {
                "country_code": code.strip().upper(),
                "name": name.strip() if isinstance(name, str) else "",
            }
        )
    return countries


def fetch_public_holidays(year, country_code):
    """Return the normalized holiday list for (year, country)."""
    code = _clean_country_code(country_code)
    if code is None:
        raise NagerError("country_code must be a 2-letter ISO 3166-1 alpha-2 code")
    if not isinstance(year, int) or isinstance(year, bool):
        raise NagerError("year must be an integer")
    data = _get_json(f"/PublicHolidays/{year}/{code}")
    if not isinstance(data, list):
        raise NagerError("Nager.Date PublicHolidays payload was not a list")
    return _normalize_holidays(data, code)


def _normalize_holidays(payload, country_code):
    """Map Nager's payload to internal dicts, dropping malformed rows.

    Deliberately strict: a row without a usable calendar date or name
    cannot be keyed or displayed, so it is skipped rather than guessed.
    """
    holidays = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        raw_date = item.get("date")
        if not isinstance(raw_date, str):
            continue
        try:
            holiday_date = datetime.date.fromisoformat(raw_date)
        except ValueError:
            continue
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        local_name = item.get("localName")
        holidays.append(
            {
                "date": holiday_date.isoformat(),
                "name": name.strip(),
                "local_name": local_name.strip() if isinstance(local_name, str) else "",
                "country_code": item.get("countryCode") or country_code,
                "global": bool(item.get("global", True)),
                "counties": item.get("counties") or [],
                "types": item.get("types") or [],
                "launch_year": item.get("launchYear"),
            }
        )
    return holidays
