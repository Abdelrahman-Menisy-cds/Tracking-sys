"""OpenCode Go LLM client (server-side only) for the holidays register.

Credentials are read from the process environment (OPENCODE_GO_API_KEY /
OPENCODE_GO_BASE_URL / OPENCODE_GO_MODEL, loaded by config.settings from
the gitignored project .env). The key never leaves the server: it is not
logged, not returned in API responses, and must never carry a VITE_ prefix
(any VITE_* value is inlined verbatim into the public frontend bundle).

Provider quirks handled here (verified against the live API):
- The endpoint rejects requests without `x-opencode-session` (HTTP 400
  MissingSessionID): a fresh uuid4 is generated per request.
- glm-5.3-flash is a REASONING model: a small max_tokens budget is consumed
  by reasoning and returns content=null with finish_reason="length". That
  is a failure retried once with a larger budget — never an
  empty-but-valid answer.

Both public functions use strict JSON-only prompts and parse defensively:
code fences are stripped, json.loads runs in a try/except, shapes are
validated, and the functions return nothing rather than garbage when the
model misbehaves. A hallucinated value must never enter the register as if
it were official.
"""
import datetime
import json
import logging
import os
import re
import urllib.error
import urllib.request
import uuid

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1"
DEFAULT_MODEL = "glm-5.3-flash"
DEFAULT_TIMEOUT_SECONDS = 60
# The provider's edge (Cloudflare) rejects the DEFAULT Python-urllib UA with
# 403 error 1010 (TLS/UA bot rule); any explicit UA passes. Verified live:
# default UA -> 403/1010, explicit UA -> 200. This UA names the app honestly.
_LLM_USER_AGENT = "heya-fawda-tracking/1.0"
MIN_TOKEN_BUDGET = 1500
RETRY_TOKEN_BUDGET = 4000

# The only holiday names the proposal job may return; anything else the
# model produces is dropped here so only the requested Islamic holidays can
# ever reach the register.
ISLAMIC_HOLIDAY_NAMES = (
    "Ramadan Start",
    "Eid Al-Fitr",
    "Eid Al-Adha",
    "Islamic New Year",
    "Prophet Muhammad's Birthday",
)

_ARABIC_RE = re.compile("[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]")


class LLMUnavailableError(Exception):
    """The provider is unreachable or unconfigured; callers degrade."""


class LLMBadResponseError(Exception):
    """The provider answered but the answer cannot be trusted."""


class LLMEmptyContentError(LLMBadResponseError):
    """Reasoning budget exhausted (content is null); retry with a larger budget."""


def has_arabic_script(text) -> bool:
    """Cheap script check: does the string contain Arabic-block characters?"""
    return bool(text) and bool(_ARABIC_RE.search(text))


def normalize_name(name) -> str:
    """Case/spacing/punctuation-insensitive holiday-name form for matching."""
    return " ".join(str(name).lower().replace("'", "").split())


def _credentials():
    api_key = os.getenv("OPENCODE_GO_API_KEY", "").strip()
    if not api_key:
        # Fail loudly BEFORE sending an unauthenticated request.
        raise LLMUnavailableError("OPENCODE_GO_API_KEY is not configured")
    base_url = os.getenv("OPENCODE_GO_BASE_URL", DEFAULT_BASE_URL).strip().rstrip("/")
    model = os.getenv("OPENCODE_GO_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    return api_key, base_url, model


def _chat(messages, max_tokens):
    api_key, base_url, model = _credentials()
    request = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(
            {"model": model, "messages": messages, "max_tokens": max_tokens}
        ).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            # REQUIRED by the provider: HTTP 400 MissingSessionID without it.
            "x-opencode-session": str(uuid.uuid4()),
            "Content-Type": "application/json",
            # Cloudflare 1010: the DEFAULT urllib UA is blocked; see above.
            "User-Agent": _LLM_USER_AGENT,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=DEFAULT_TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise LLMBadResponseError("OpenCode Go returned a non-JSON body") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        # Never include request headers (the key) in errors or logs.
        raise LLMUnavailableError(f"OpenCode Go request failed: {exc}") from exc

    choices = body.get("choices") or []
    message = (choices[0].get("message") or {}) if choices else {}
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise LLMEmptyContentError(
            "LLM returned no content (reasoning budget exhausted or empty answer)"
        )
    return content


def _complete(messages):
    """One completion, retrying ONCE with a larger budget on empty content."""
    try:
        return _chat(messages, max_tokens=MIN_TOKEN_BUDGET)
    except LLMEmptyContentError:
        return _chat(messages, max_tokens=RETRY_TOKEN_BUDGET)


def _strip_code_fences(text):
    stripped = text.strip()
    match = re.match(r"^```[A-Za-z0-9_-]*\s*(.*?)\s*```$", stripped, flags=re.DOTALL)
    return match.group(1) if match else stripped


def _parse_json_object(content):
    """Defensively extract the outermost JSON object; None when unusable."""
    candidate = _strip_code_fences(content)
    start, end = candidate.find("{"), candidate.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(candidate[start : end + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


_TRANSLATE_PROMPT = (
    "You localise holiday names for an Egyptian HR system.\n"
    "Translate each English public-holiday name below into the Arabic name "
    "used in official Egyptian announcements.\n"
    'Answer with JSON ONLY (no prose, no code fences) in exactly this shape:\n'
    '{"translations": [{"en": "<input name>", "ar": "<arabic name>"}]}\n'
    "One entry per input name, same order. Every \"ar\" value MUST be Arabic script."
)


def localise_holiday_names(names):
    """Translate English holiday names to Arabic: {english: arabic}.

    Names the model could not translate into Arabic script are simply
    absent from the mapping — the caller keeps the source name rather than
    storing unusable output. Raises LLMUnavailableError /
    LLMBadResponseError when the provider itself is unusable.
    """
    clean, seen = [], set()
    for name in names or []:
        if isinstance(name, str) and name.strip() and name not in seen:
            seen.add(name)
            clean.append(name.strip())
    if not clean:
        return {}
    listing = "\n".join(f"- {name}" for name in clean)
    content = _complete([{"role": "user", "content": f"{_TRANSLATE_PROMPT}\n\n{listing}"}])
    data = _parse_json_object(content)
    if not data or not isinstance(data.get("translations"), list):
        # Model misbehaved: return nothing rather than garbage.
        return {}
    mapping = {}
    for entry in data["translations"]:
        if not isinstance(entry, dict):
            continue
        en, ar = entry.get("en"), entry.get("ar")
        if isinstance(en, str) and isinstance(ar, str) and ar.strip() and has_arabic_script(ar):
            mapping[en.strip()] = ar.strip()
    return mapping


def _canonical_islamic_name(raw):
    """Map a model-returned name onto the canonical list; None if foreign."""
    if not isinstance(raw, str):
        return None
    candidate = normalize_name(raw)
    if not candidate:
        return None
    for canonical in ISLAMIC_HOLIDAY_NAMES:
        if candidate == normalize_name(canonical) or normalize_name(canonical) in candidate:
            return canonical
    return None


def propose_missing_islamic_holidays(year, country_code, already_present=None):
    """Propose Gregorian dates for Islamic holidays for (year, country).

    Returns only entries whose name maps onto a canonical requested holiday
    and whose date parses as a real calendar date inside `year` — anything
    else the model invents (unknown holiday, malformed or out-of-year date)
    is dropped HERE so it can never reach the register. Rows are proposals:
    the service stores them source=LLM / needs_confirmation=True.
    """
    code = str(country_code).strip().upper()
    present = [str(name) for name in (already_present or []) if str(name).strip()]
    covered = ""
    if present:
        covered = (
            "\nThese are already registered for this country and year — do NOT include them:\n"
            + "\n".join(f"- {name}" for name in present)
        )
    prompt = (
        f"List the expected Gregorian dates of these Islamic public holidays in {code} "
        f"for the year {year}:\n"
        + "\n".join(f"- {name}" for name in ISLAMIC_HOLIDAY_NAMES)
        + covered
        + "\n\nAnswer with JSON ONLY (no prose, no code fences) in exactly this shape:\n"
        '{"holidays": [{"name": "<english name>", "name_local": "<official Arabic name>", '
        '"date": "YYYY-MM-DD"}]}\n'
        f"Every date MUST be a real calendar date within the year {year}. "
        "Omit any holiday you are not confident about for this country and year."
    )
    content = _complete([{"role": "user", "content": prompt}])
    data = _parse_json_object(content)
    if not data or not isinstance(data.get("holidays"), list):
        return []
    proposals = []
    for entry in data["holidays"]:
        if not isinstance(entry, dict):
            continue
        canonical = _canonical_islamic_name(entry.get("name"))
        if canonical is None:
            continue
        raw_date = entry.get("date")
        if not isinstance(raw_date, str):
            continue
        try:
            holiday_date = datetime.date.fromisoformat(raw_date.strip())
        except ValueError:
            continue
        if holiday_date.year != year:
            continue
        name_local = entry.get("name_local")
        proposals.append(
            {
                "name": canonical,
                "date": holiday_date.isoformat(),
                "name_local": name_local.strip() if isinstance(name_local, str) else "",
            }
        )
    return proposals
