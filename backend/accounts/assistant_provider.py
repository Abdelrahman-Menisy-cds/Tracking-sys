"""Provider calls for the «مدام عفاف» assistant (Story H18).

One OpenAI-compatible request shape, three entry points:

  * probe_endpoint: the Test button — a 1-token chat completion whose ONLY
    job is proving the connection; returns the provider's own status and
    message on failure, never a generic one.
  * chat_round: ONE round of the conversation loop — messages + the tool
    definitions in, the provider's message (content and/or tool_calls) out.
    The loop itself lives in assistant_tools.assistant_chat.

The key travels ONLY in the Authorization header of the outgoing request:
it is never logged, never returned in any response, never carried in an
error message. Error text carries the provider's own status/message (the
brief requires it) after being stripped of anything that smells like key
material.

URL shape (H18 fix-up 3): gateways disagree on whether the chat path is
{base}/chat/completions or {base}/v1/chat/completions. The client obeys
the saved URL verbatim — it never rewrites or saves anything itself — and
tolerates a base written without a trailing /v1 the only pull way: when
{base}/chat/completions answers a 404/405 (the shape that means "this is
not a route here") it sends ONE more request to {base}/v1/chat/
completions. Every detail carries the exact URL the request actually
used, so a base/path mismatch is visible instead of a bare status against
an unexplained address.

urllib (stdlib) on purpose — same pattern holidays/llm.py already uses;
no new dependency. Short timeout (the Test button is interactive; the
chat round is a single turn) and no retry loop: a confused provider
answer must not multiply into provider spend.
"""
import json
import logging
import re
import socket
import ssl
import time
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)

PROBE_TIMEOUT_SECONDS = 15
CHAT_TIMEOUT_SECONDS = 60
# The Test button is exactly one token: enough to prove the model speaks,
# minimal spend. (glm-style reasoning models may still report finish_reason
# "length" with empty content on a probe; the probe asserts on the STATUS,
# not on the content, so an ok status is ok.)
PROBE_MAX_TOKENS = 1
CHAT_MAX_TOKENS = 2000

USER_AGENT = "heya-fawda-tracking-assistant/1.0"

MAX_ERROR_BODY_CHARS = 300  # the provider's own error body, truncated in details


class ProviderResponseError(Exception):
    """The provider answered with a non-2xx status.

    Carries the provider's own status, message, and the exact URL that was
    called (brief AC 5 + fix-up 3); the key is never in the message.
    """

    def __init__(self, status_code: int, detail: str, url: str = ""):
        self.status_code = status_code
        self.detail = detail
        self.url = url
        super().__init__(f"provider status {status_code}")


class ProviderUnreachableError(Exception):
    """Connection-level failure (DNS resolution, connect, TLS, timeout).

    Carries the exact URL that was attempted and the classified transport
    symptom (dns / connect / tls / timeout), never a bare generic word.
    """

    def __init__(self, url: str, symptom: str, raw: str = ""):
        self.url = url
        self.symptom = symptom
        self.raw = raw
        super().__init__(f"{url}: {symptom}")


class ProviderBadBodyError(Exception):
    """2xx, but the body is not a usable OpenAI-compatible chat completion."""

    def __init__(self, message: str, url: str = ""):
        self.url = url
        super().__init__(message)


def _auth_headers(api_key: str, extra_headers: dict | None = None) -> dict:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    }
    if extra_headers:
        # Subscription mode (H19): provider-specific headers (e.g.
        # x-opencode-session) ride along; the Authorization value stays
        # server-side only, never logged, never echoed in an error.
        headers.update(extra_headers)
    return headers


def _sanitize_detail(raw: str) -> str:
    """Defensive scrub: a provider echo of its own Authorization header is
    the one known way key material can re-enter an error message."""
    scrubbed = re.sub(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [redacted]", raw or "")
    return scrubbed


def _one_line(raw: str) -> str:
    return " ".join((raw or "").split())


def _truncate(raw: str) -> str:
    raw = _sanitize_detail(raw or "")
    total = len(raw)
    if total <= MAX_ERROR_BODY_CHARS:
        return raw
    return f"{raw[:MAX_ERROR_BODY_CHARS]}…(truncated, {total} chars total)"


def _underlying_cause(error: BaseException) -> BaseException:
    """The concrete socket-land cause: urllib errors carry the original
    socket exception in ``reason``; a bare OSError IS the cause itself."""
    reason = getattr(error, "reason", None)
    if isinstance(reason, BaseException):
        return reason
    return error


def _classify_transport(error: BaseException) -> tuple[str, str]:
    """(symptom key, human clause) for one connection-level failure."""
    cause = _underlying_cause(error)
    text = _one_line(str(cause))
    if isinstance(cause, TimeoutError):
        return "timeout", f"the connection timed out ({text})"
    if isinstance(cause, urllib.error.URLError):
        return _classify_transport(cause)
    if isinstance(cause, ssl.SSLError):
        return "tls", f"the TLS handshake failed ({text})"
    if isinstance(cause, socket.gaierror):
        return "dns", f"the host name could not be resolved ({text})"
    if isinstance(cause, (ConnectionRefusedError, ConnectionResetError, ConnectionAbortedError)):
        return "connect", f"the connection was refused or reset ({text})"
    if isinstance(cause, OSError):
        return "connect", f"the connection failed ({text})"
    return "connect", f"the connection failed ({text or type(cause).__name__})"


def _post_chat_once(payload: dict, url: str, api_key: str, timeout: int, extra_headers: dict | None = None) -> dict:
    """One POST to exactly ``url``; returns the parsed body, or raises.

    Raises ProviderResponseError (non-2xx: the provider's own status and
    message plus the URL), ProviderUnreachableError (transport failure,
    classified, with the URL), or ProviderBadBodyError (2xx with a body
    that is not a usable chat completion, also with the URL). The URL is
    used verbatim — no host allowlist, no preset: a free-form
    OpenAI-compatible endpoint.
    """
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=_auth_headers(api_key, extra_headers),
        method="POST",
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            status_code = response.status
            final_url = response.geturl() if hasattr(response, "geturl") else url
            raw_error_body = None
    except urllib.error.HTTPError as error:
        # A non-2xx answer is a real provider answer: keep its own body
        # (truncated, key-scrubbed). Never include request headers (the
        # key) in errors or logs.
        try:
            raw_error_body = error.read().decode("utf-8", errors="replace")
        except Exception:
            raw_error_body = ""
        if not raw_error_body:
            raw_error_body = error.reason or "provider error"
        raise ProviderResponseError(
            error.code, _truncate(raw_error_body), url=error.geturl() or url
        ) from None
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        symptom, _clause = _classify_transport(error)
        raise ProviderUnreachableError(
            url, symptom, raw=_one_line(str(_underlying_cause(error)))
        ) from None
    elapsed = time.monotonic() - started
    logger.info(
        "provider chat call completed status=%s elapsed_ms=%d url=%s",
        status_code,
        elapsed * 1000,
        final_url,
    )

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as error:
        raise ProviderBadBodyError(
            f"expected the OpenAI chat-completion JSON body, got something else ({_truncate(body)})", url=final_url
        ) from error
    if not isinstance(parsed, dict):
        raise ProviderBadBodyError("expected a JSON object body (chat-completion shape)", url=final_url)
    return parsed


def _chat_completion_url(base_url: str) -> str:
    """The chat-completions URL built exactly from the given base URL."""
    return f"{base_url.rstrip('/')}/chat/completions"


def _is_route_miss(status_code: int) -> bool:
    return status_code in (404, 405)


def _post_chat(payload: dict, base_url: str, api_key: str, timeout: int, extra_headers: dict | None = None) -> dict:
    """POST the chat completion under the given base URL, tolerating a base
    written without a trailing /v1 (H18 fix-up 3). Pull only: the saved
    base URL is obeyed verbatim; no URL is rewritten or stored back by
    this module. ``extra_headers`` (H19 subscription mode) ride every hop.

    First attempt: {base}/chat/completions (the shape every
    OpenAI-compatible client builds). Only when that answers 404/405 —
    the shape that means "not a route here" — does a second request go to
    {base}/v1/chat/completions, and ONLY for a base that does not already
    end in /v1 (a /v1 base has no second shape: its refusal is surfaced
    verbatim, never rewritten). The exact URL of the request that failed
    is in every error, so the mismatch is visible; the fallback refusal
    carries the fallback's own provider body, mismarks nothing.
    """
    primary_url = _chat_completion_url(base_url)
    try:
        return _post_chat_once(payload, primary_url, api_key, timeout, extra_headers)
    except ProviderResponseError as primary_error:
        if not _is_route_miss(primary_error.status_code):
            raise
        slug = base_url.rstrip("/")
        if slug.endswith("/v1"):
            # The base already IS the /v1 shape: appending /v1 again would
            # call a path the user never asked for. Surface the refusal.
            raise
        fallback_url = f"{slug}/v1/chat/completions"
        try:
            return _post_chat_once(payload, fallback_url, api_key, timeout, extra_headers)
        except ProviderResponseError as fallback_error:
            if _is_route_miss(fallback_error.status_code):
                # Both shapes refused this caller. Report the fallback URL
                # explicitly so the mismatch is visible, with the
                # provider's own body for that URL (scrubbed + truncated).
                raise ProviderResponseError(
                    fallback_error.status_code,
                    fallback_error.detail
                    or f"HTTP {fallback_error.status_code} for both the saved base URL and its /v1 shape",
                    url=fallback_url,
                ) from None
            raise


def _unreachable_detail(error: ProviderUnreachableError) -> str:
    return f"{error.url} is unreachable ({error.symptom}): {error.raw or 'no further detail from the system'}"


def _bad_body_detail(error: ProviderBadBodyError) -> str:
    location = f" from {error.url}" if error.url else ""
    return f"the provider answered{location}, but the body is not a usable chat completion: {error.args[0]}"


def _response_error_detail(error: ProviderResponseError) -> str:
    location = f" from {error.url}" if error.url else ""
    body = error.detail or "no response body"
    return f"HTTP {error.status_code}{location}: {body}"


def probe_endpoint(*, base_url: str, api_key: str, model: str, extra_headers: dict | None = None) -> tuple[bool, int, str]:
    """The Test button. (ok, latency_ms, detail).

    Success: any 2xx that parses as the OpenAI shape — content may be empty
    (a 1-token budget on reasoning models), the STATUS is the proof.
    Failure: the provider's own status and message, a classified transport
    symptom, or a malformed-body report — never a bare generic word, and
    always naming the exact URL that was used (fix-up 3).
    """
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": PROBE_MAX_TOKENS,
    }
    started = time.monotonic()
    try:
        _post_chat(payload, base_url, api_key, timeout=PROBE_TIMEOUT_SECONDS, extra_headers=extra_headers)
    except ProviderUnreachableError as error:
        return False, int((time.monotonic() - started) * 1000), _unreachable_detail(error)
    except ProviderBadBodyError as error:
        return False, int((time.monotonic() - started) * 1000), _bad_body_detail(error)
    except ProviderResponseError as error:
        return False, int((time.monotonic() - started) * 1000), _response_error_detail(error)
    return True, int((time.monotonic() - started) * 1000), "connection ok"


def chat_round(*, base_url: str, api_key: str, model: str, messages: list, tools: list, extra_headers: dict | None = None) -> dict:
    """ONE round: messages + tool definitions in, the provider's message out.

    Returns the ``message`` dict of choices[0] ({"role", "content", possibly
    "tool_calls"}). The caller applies the tool loop bounds.
    """
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": CHAT_MAX_TOKENS,
    }
    if tools:
        payload["tools"] = tools
    parsed = _post_chat(payload, base_url, api_key, timeout=CHAT_TIMEOUT_SECONDS, extra_headers=extra_headers)
    choices = parsed.get("choices") or []
    if not choices:
        raise ProviderBadBodyError(
            "provider returned no choices", url=_chat_completion_url(base_url)
        )
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ProviderBadBodyError(
            "provider returned no assistant message", url=_chat_completion_url(base_url)
        )
    return message
