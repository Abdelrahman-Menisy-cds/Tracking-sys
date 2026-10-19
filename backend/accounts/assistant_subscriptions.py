"""Subscription login for the «مدام عفاف» assistant (Story H19).

The assistant is linked one of two ways:

  * api mode (H18): the user's own OpenAI-compatible endpoint + key + model;
  * subscription mode (H19, H19 fix-up 4): the user picks opencode or
    Codex and the SERVER imports the credential the provider's OWN CLI
    login already holds on this machine — ~/.local/share/opencode/auth.json
    / ~/.codex/auth.json. That is the PRIMARY and only link path in the
    backend today: the opencode subscription entry is a KEY (`opencode auth
    login` stored it) and the codex entry is the ChatGPT OAuth token set
    its own `codex login` (a browser flow) produced. There is NO in-app
    authorisation flow here and the backend never POSTs an /oauth/* path
    to any provider's API base URL (fix-up 4: the invented
    /oauth/device/start call is deleted).

Credential shapes (both measured on this machine's CLI stores — structure
only, values never logged):

  * key shape:  {"key": ..., "type": ...}   (opencode provider keys, incl.
               the owner's existing `opencode-go` entry)
  * oauth shape: {"access": ..., "refresh": ..., "expires": ..., ...}
               (codex tokens; opencode's anthropic/openai entries)

Everything at rest is encrypted with the SAME Fernet pipeline as the H18
API key (assistant_crypto). Token material NEVER reaches: a response body
(readers get the hint only), a log line, or an AuditEvent (booleans only).

Safety rules honoured here:

  * the local store is READ, never written; its contents are never logged
    or echoed past a boolean "found/not found";
  * the refresh call carries only the refresh token to the provider's
    token URL (registry-configured, overridable for the stub tests);
  * a failed refresh UNLINKS the subscription (audit event
    assistant.subscription_expired) so every consumer answers 409
    not_configured — the launcher fades again, never a silent dead button;
  * error text goes through the same scrub/truncate as the provider's own
    error body (assistant_provider._truncate / _sanitize_detail) so key
    material can never ride an error back to a user.
"""
import base64
import binascii
import concurrent.futures
import datetime
import json
import logging
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
import uuid

from django.db import transaction
from django.utils import timezone

from accounts.assistant_crypto import AssistantSecretError, decrypt_key, encrypt_key, key_hint
from accounts.assistant_provider import ProviderResponseError, ProviderUnreachableError, _truncate
from accounts.models import AuditEvent

logger = logging.getLogger(__name__)

CHAT_TIMEOUT_SECONDS = 300  # a codex reasoning turn can take minutes
# H25: EVERY blocking Io call in the subscription path runs under a hard
# ceiling. The socket timeout inside urlopen does NOT cover DNS resolution
# (getaddrinfo runs before the socket exists, on some libc builds without
# its own deadline) — and the brief's live reproduction (import -> HTTP 000
# at 60s) is exactly a request thread wedged outside the socket timeout's
# reach. So the per-request timeout stays the FIRST bound, and the executor
# join below is the LAST one: no call in this module can hold a request
# thread beyond IMPORT_CEILING_SECONDS, whatever the transport does.
IMPORT_CEILING_SECONDS = 20  # > the 15s per-request timeout, < any UX hang


class SubscriptionError(Exception):
    """An operator-visible subscription failure; `.code` maps to a status."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(code)


class RefreshFailedError(Exception):
    """The token refresh failed; internals are in `data`, never in str."""

    def __init__(self, reason: str = "refresh failed"):
        self.reason = reason
        super().__init__(reason)


def _env(name: str, default: str) -> str:
    return (os.getenv(name, "") or "").strip() or default


class ProviderSpec:
    """One subscription provider: the only presets allowed (owner's rule)."""

    def __init__(self, *, slug: str, base_url: str,
                 token_url: str, models_path: str, session_header: str = "",
                 models_supported: bool = True, default_model: str = "",
                 models_query: str = "",
                 wire_api: str = "chat", account_id_field: str = "", extra_static_headers=None,
                 device_code_url: str = "", device_token_url: str = "",
                 device_client_id: str = ""):
        self.slug = slug
        self.base_url = base_url
        self.token_url = token_url
        self.models_path = models_path
        self.session_header = session_header
        self.models_supported = models_supported
        # A provider whose models are known but NOT listable over the wire (the
        # codex backend exposes no /models we may call): the CLI's own shipped
        # slugs, so the user picks from a list instead of retyping an id from
        # memory — a typo there only surfaces as a failed connection later.
        # A required query on the listing call (codex demands client_version).
        self.models_query = models_query
        self.default_model = default_model  # preselected; the user can change it
        # 'chat' = OpenAI chat-completions; 'responses' = the Codex
        # backend-api /responses SSE shape (its ONLY accepted wire api).
        self.wire_api = wire_api
        # The codex gateway requires chatgpt-account-id alongside the bearer.
        self.account_id_field = account_id_field
        self.extra_static_headers = extra_static_headers or {}
        # The provider's OWN device-authorization endpoints (RFC 8628), used
        # by the provider's CLI itself. Empty = this provider offers no
        # in-app login flow (the capability endpoint says so honestly).
        self.device_code_url = device_code_url
        self.device_token_url = device_token_url
        self.device_client_id = device_client_id

    @property
    def device_flow_available(self) -> bool:
        return bool(self.device_code_url and self.device_token_url and self.device_client_id)

    def headers(self) -> dict:
        base = {
            "Content-Type": "application/json",
            # Explicit UA: the opencode edge (Cloudflare) 403s the default
            # Python-urllib one (error 1010; holidays/llm.py precedent).
            "User-Agent": "heya-fawda-tracking-assistant/1.0",
        }
        if self.session_header:
            base[self.session_header] = str(uuid.uuid4())  # REQUIRED: 400 MissingSessionID
        return base


OPENCODE = ProviderSpec(
    slug="opencode",
    base_url=_env("ASSISTANT_OPENCODE_BASE_URL", "https://opencode.ai/zen/go/v1"),
    token_url=_env("ASSISTANT_OPENCODE_TOKEN_URL", "https://opencode.ai/zen/go/oauth/token"),
    models_path="/models",
    session_header="x-opencode-session",
    # The gateway's proven default (it is what holidays/llm.py runs today);
    # the model list lets the user switch to anything else offered.
    default_model=_env("ASSISTANT_OPENCODE_MODEL", "glm-5.3-flash"),
    # The provider's REAL device flow (H21): read from opencode's own source
    # (packages/core/src/plugin/provider/opencode.ts on dev, sst/opencode
    # mirrored as anomalyco/opencode — the `oauth()` integration) and
    # live-probed. The Console is the authorization server, NOT the zen API
    # base; client_id is the CLI's own "opencode-cli" so the approval page
    # is the one the CLI shows too. The poll of the SAME /auth/device/token
    # endpoint with grant_type=refresh_token is what the plugin's `refresh`
    # does — so an OPENCODE_DEVICE_TOKEN_URL override must point at BOTH.
    device_code_url=_env("ASSISTANT_OPENCODE_DEVICE_CODE_URL", "https://opencode.ai/console/auth/device/code"),
    device_token_url=_env("ASSISTANT_OPENCODE_DEVICE_TOKEN_URL", "https://opencode.ai/console/auth/device/token"),
    device_client_id=_env("ASSISTANT_OPENCODE_DEVICE_CLIENT_ID", "opencode-cli"),
)

CODEX = ProviderSpec(
    slug="codex",
    # The ChatGPT-subscription gateway: wire_api "responses" (codex >= 0.162
    # dropped chat-completions there — measured 404 on /v1/chat/completions,
    # "Stream must be set to true" on /responses with stream:false, 200 SSE
    # with stream:true + chatgpt-account-id + the codex_cli_rs identity).
    base_url=_env("ASSISTANT_CODEX_BASE_URL", "https://chatgpt.com/backend-api/codex"),
    token_url=_env("ASSISTANT_CODEX_TOKEN_URL", "https://auth.openai.com/oauth/token"),
    models_path="/models",
    # The listing EXISTS — it just demands client_version (measured live: without
    # it the endpoint answers 400 'Field required'). Its answer is the only
    # trustworthy list: the CLI's binary strings carry slugs for other auth modes
    # (gpt-5.5, gpt-5.4) that a ChatGPT account is refused with
    # "The 'X' model is not supported when using Codex with a ChatGPT account".
    models_supported=True,
    models_query=_env("ASSISTANT_CODEX_MODELS_QUERY", "client_version=0.162.1"),
    default_model=_env("ASSISTANT_CODEX_MODEL", "gpt-5.6-luna"),
    wire_api="responses",
    account_id_field="chatgpt-account-id",
    extra_static_headers={
        "originator": "codex_cli_rs",
        "OpenAI-Beta": "responses=experimental",
    },
    # H23 — the REAL device-code login its own CLI ships (`codex login
    # --device-auth`, codex 0.162.1). Endpoints read from the CLI's OWN
    # binary strings (~/.codex/packages/standalone/current/bin/codex) —
    # they contain, verbatim: "deviceauth/usercode", "deviceauth/token",
    # "deviceauth/callback" and "/codex/device"; the client_id constant
    # app_EMoamEEZ73f0CkXaXp7hrann is the aud of the owner's own id_token
    # in ~/.codex/auth.json. Shapes confirmed live: start answers JSON
    # {"device_auth_id","user_code","interval","expires_at"}, the approval
    # page is https://auth.openai.com/codex/device, and the poll answers
    # 403 while pending / 404 once expired — this is a proprietary shape,
    # NOT the RFC 8628 grant_type flow (assistant_devices.py keeps the
    # two protocols apart).
    device_code_url=_env("ASSISTANT_CODEX_DEVICE_CODE_URL", "https://auth.openai.com/api/accounts/deviceauth/usercode"),
    device_token_url=_env("ASSISTANT_CODEX_DEVICE_TOKEN_URL", "https://auth.openai.com/api/accounts/deviceauth/token"),
    device_client_id=_env("ASSISTANT_CODEX_DEVICE_CLIENT_ID", "app_EMoamEEZ73f0CkXaXp7hrann"),
)

# The second half of codex's device login (measured from codex-rs
# login/src/device_code_auth.rs and the CLI's own binary strings): the device
# poll hands back an authorization_code + code_verifier, which are then swapped
# at the standard OAuth token endpoint — as a FORM, with the deviceauth/callback
# redirect — for the real access/refresh/id tokens.
_CODEX_OAUTH_TOKEN_URL = _env("ASSISTANT_CODEX_OAUTH_TOKEN_URL", "https://auth.openai.com/oauth/token")
_CODEX_DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback"


def _codex_exchange_device_code(spec, code_answer: dict) -> dict:
    """Swap the device poll's authorization_code for tokens.

    Codex's device answer is not a token answer: it carries authorization_code +
    code_verifier and expects one more call. Treating it as final made a
    COMPLETED login look like a provider error ("HTTP 200 but no access_token"),
    so the panel waited forever on an approval that had already happened.
    """
    form = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code_answer.get("authorization_code") if isinstance(code_answer.get("authorization_code"), str) else "",
        "redirect_uri": _CODEX_DEVICE_REDIRECT_URI,
        "client_id": spec.device_client_id,
        "code_verifier": code_answer.get("code_verifier") if isinstance(code_answer.get("code_verifier"), str) else "",
    }).encode("utf-8")
    request = urllib.request.Request(
        _CODEX_OAUTH_TOKEN_URL,
        data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        method="POST",
    )
    try:
        return _http_json(request, timeout=15)
    except ProviderResponseError as error:
        raise SubscriptionError("provider_error", f"HTTP {error.status_code}: {error.detail}") from None
    except ProviderUnreachableError as error:
        raise SubscriptionError("provider_unreachable", f"{error.url}: {error.raw or 'the connection failed'}") from None


PROVIDERS = {spec.slug: spec for spec in (OPENCODE, CODEX)}


def _http_json(request: urllib.request.Request, timeout: int) -> dict:
    """POST/GET and parse JSON; transport/HTTP errors become typed raises
    that NEVER carry request headers (therefore never the token).

    H25: the whole call runs in a worker thread joined with a HARD deadline
    (IMPORT_CEILING_SECONDS) — the socket timeout cannot reach a wedged
    DNS resolver or a stalled TLS read that never yields, and the brief
    (import must ALWAYS answer) forbids any unbounded wait whatsoever.
    Whatever the transport does, this function answers within its ceiling:
    either the provider's typed error or a ProviderUnreachableError with
    the timeout symptom page the view maps to provider_unreachable."""

    def _call() -> dict:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError as decode_error:
            raise ProviderResponseError(0, _truncate(f"non-JSON body: {body[:120]}"), url=request.full_url) from decode_error
        if not isinstance(parsed, dict):
            raise ProviderResponseError(0, _truncate("expected a JSON object body"), url=request.full_url)
        return parsed

    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="assistant-provider")
    try:
        future = executor.submit(_call)
        try:
            return future.result(timeout=IMPORT_CEILING_SECONDS)
        except concurrent.futures.TimeoutError:
            future.cancel()
            raise ProviderUnreachableError(
                request.full_url,
                "timeout",
                f"the provider did not answer within {IMPORT_CEILING_SECONDS} s",
            ) from None
        except concurrent.futures.CancelledError:
            raise ProviderUnreachableError(request.full_url, "timeout", "the call was cancelled") from None
    except urllib.error.HTTPError as error:
        try:
            raw = error.read().decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001 - body reading must not mask the status
            raw = ""
        raise ProviderResponseError(error.code, _truncate(raw or error.reason or ""), url=error.geturl() or request.full_url) from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, ssl.SSLError) as error:
        raise ProviderUnreachableError(request.full_url, "connect", raw=str(error)) from None
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


def provider_or_422(slug: str) -> ProviderSpec:
    spec = PROVIDERS.get((slug or "").strip())
    if spec is None:
        raise SubscriptionError("unknown_provider", "Choose opencode or codex.")
    return spec


# ---------------------------------------------------------------------------
# Import: read the LOCAL CLI credential store (the demo path)
# ---------------------------------------------------------------------------

OPENCODE_AUTH_PATH = os.path.expanduser("~/.local/share/opencode/auth.json")
CODEX_AUTH_PATH = os.path.expanduser("~/.codex/auth.json")


class ImportedCredential:
    __slots__ = ("cred_type", "blob", "hint", "expires")

    def __init__(self, cred_type, blob, hint, expires):
        self.cred_type = cred_type
        self.blob = blob  # the plaintext JSON object (dict) — encrypted later
        self.hint = hint
        self.expires = expires  # aware datetime | None


def _mask(plaintext: str) -> str:
    return key_hint(plaintext) if plaintext else ""


def import_local(provider_slug: str) -> ImportedCredential:
    """Read the CLI's OWN credential store and return the credential for
    this provider. The store is only read; values are never logged, and on
    a miss the error says which path was looked at and what class of entry
    was expected — no structure beyond that."""
    if provider_slug == "opencode":
        path = OPENCODE_AUTH_PATH
        entry_name = "opencode-go"  # the provider key the CLI stores after its login
    elif provider_slug == "codex":
        path = CODEX_AUTH_PATH
        entry_name = "tokens"
    else:
        raise SubscriptionError("unknown_provider", "Choose opencode or codex.")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            store = json.load(handle)
    except FileNotFoundError:
        raise SubscriptionError(
            "no_local_login",
            f"No local CLI login found ({path}). Run the provider's own login once on this machine first.",
        ) from None
    except json.JSONDecodeError:
        raise SubscriptionError("no_local_login", f"The local CLI store at {path} is not readable JSON.") from None
    if not isinstance(store, dict):
        raise SubscriptionError("no_local_login", f"The local CLI store at {path} is not readable JSON.")

    if provider_slug == "opencode":
        entry = store.get(entry_name)
        if not isinstance(entry, dict):
            raise SubscriptionError(
                "no_local_login",
                f"No '{entry_name}' entry in {path}. Run `opencode auth login` on this machine first.",
            )
        secret = entry.get("key")
        if not isinstance(secret, str) or not secret.strip():
            raise SubscriptionError("no_local_login", f"The '{entry_name}' entry has no usable key.")
        return ImportedCredential("key", {"key": secret, "type": "key"}, _mask(secret), None)

    tokens = store.get("tokens")
    if not isinstance(tokens, dict):
        raise SubscriptionError(
            "no_local_login",
            f"No tokens entry in {path}. Run `codex login` on this machine first.",
        )
    access, refresh = tokens.get("access_token"), tokens.get("refresh_token")
    if not isinstance(access, str) or not access.strip():
        raise SubscriptionError("no_local_login", f"The tokens entry in {path} has no access token.")
    expires = _last_refresh_to_expiry(store.get("last_refresh"))
    credential = {
        "access": access,
        "refresh": refresh if isinstance(refresh, str) else "",
        "group_id": tokens.get("account_id") if isinstance(tokens.get("account_id"), str) else "",
    }
    return ImportedCredential("oauth", credential, _mask(access), expires)


def _last_refresh_to_expiry(last_refresh) -> datetime.datetime | None:
    """The codex store only records WHEN it last refreshed (RFC3339); the
    ChatGPT access token lives ~28 days after that. We store that instant
    minus a safety margin (6 days) so the refresh always runs early."""
    if not isinstance(last_refresh, str) or not last_refresh.strip():
        return None
    try:
        moment = datetime.datetime.fromisoformat(last_refresh.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if timezone.is_naive(moment):
        moment = timezone.make_aware(moment, datetime.timezone.utc)
    return moment + datetime.timedelta(days=22)


# ---------------------------------------------------------------------------
# Store / clear / read helpers (the row is the single source of truth)
# ---------------------------------------------------------------------------


def _credential_field_names(affecting: str):
    if affecting == "subscription":
        return {
            "subscription_provider", "subscription_ciphertext", "subscription_hint",
            "subscription_cred_type", "subscription_source", "subscription_expires",
        }
    return {"api_key_ciphertext", "api_key_hint"}


def store_subscription(config, imported: ImportedCredential, provider_slug: str, source: str):
    """Write the credential onto the row, clearing the api-key fields:
    exactly one credential per row. The provider's proven default model is
    preselected so the row is configured immediately; the model list/choice
    UI lets the user pick another offered model."""
    spec = PROVIDERS[provider_slug]
    blob = json.dumps(imported.blob, ensure_ascii=False).encode("utf-8")
    with transaction.atomic():
        locked = type(config).objects.select_for_update().get(pk=config.pk)
        locked.subscription_provider = provider_slug
        locked.subscription_ciphertext = encrypt_key(blob.decode("utf-8"))
        locked.subscription_hint = imported.hint
        locked.subscription_cred_type = imported.cred_type
        locked.subscription_source = source
        locked.subscription_expires = imported.expires
        locked.api_key_ciphertext = b""
        locked.api_key_hint = ""
        locked.base_url = ""  # subscription mode carries NO base URL: the provider's is used
        update_fields = [
            "subscription_provider", "subscription_ciphertext", "subscription_hint",
            "subscription_cred_type", "subscription_source", "subscription_expires",
            "api_key_ciphertext", "api_key_hint", "base_url",
        ]
        if not locked.model:
            locked.model = spec.default_model
            update_fields.append("model")
        locked.save(update_fields=update_fields)
        config.refresh_from_db(fields=update_fields + (["model"] if "model" not in update_fields else []))
    return locked


def clear_subscription(config):
    with transaction.atomic():
        locked = type(config).objects.select_for_update().get(pk=config.pk)
        locked.subscription_provider = ""
        locked.subscription_ciphertext = b""
        locked.subscription_hint = ""
        locked.subscription_cred_type = ""
        locked.subscription_source = ""
        locked.subscription_expires = None
        locked.is_active = False
        locked.save(update_fields=[
            "subscription_provider", "subscription_ciphertext", "subscription_hint",
            "subscription_cred_type", "subscription_source", "subscription_expires",
            "is_active", "updated_at",
        ])
    return locked


def unlink_expired(config, request=None):
    """Refresh failed: forget the subscription so everything answers 409
    not_configured (the launcher fades again — never a silent dead button),
    and write the expiry audit event (booleans only, never token material)."""
    clear_subscription(config)
    request_id = getattr(request, "request_id", None) or ""
    AuditEvent.objects.create(
        company=config.user.company,
        actor=config.user,
        subject=config.user,
        action="assistant.subscription_expired",
        request_id=request_id,
        before={"subscription_provider": config.subscription_provider},
        after={"subscription_provider": "", "has_subscription": False},
    )


# ---------------------------------------------------------------------------
# Read / refresh the credential
# ---------------------------------------------------------------------------


def _decrypt_blob(config) -> dict:
    try:
        plaintext = decrypt_key(config.subscription_ciphertext)
    except AssistantSecretError as error:
        raise SubscriptionError("subscription_unreadable", str(error)) from None
    try:
        blob = json.loads(plaintext)
    except json.JSONDecodeError:
        raise SubscriptionError("subscription_unreadable", "The stored subscription credential is malformed.") from None
    if not isinstance(blob, dict):
        raise SubscriptionError("subscription_unreadable", "The stored subscription credential is malformed.")
    return blob


def _refresh_oauth(config, blob: dict, spec: ProviderSpec) -> dict:
    """Exchange the refresh token for a fresh one; on ANY failure unlink +
    raise. The row is updated under a row lock. The token never travels any
    further than the provider's token URL."""
    raise_from = RefreshFailedError("refresh failed")
    refresh_token = blob.get("refresh")
    if not isinstance(refresh_token, str) or not refresh_token.strip():
        unlink_expired(config)
        raise raise_from
    # WHERE a credential refreshes is per-provider, read from each CLI:
    #  * opencode (H21): its plugin re-POSTs its own console device-token
    #    endpoint with grant_type=refresh_token (opencode.ts `refresh:`),
    #    so a credential from the device flow refreshes at the SAME
    #    console URL — therefore ALWAYS its device_token_url for opencode;
    #  * codex (H23): BOTH auth paths — the CLI's browser PKCE and the
    #    --device-auth flow — end at the SAME standard token endpoint
    #    auth.openai.com/oauth/token (every open-source reimplementation:
    #    gage providers/codex TokenURL, zeroclaw openai_oauth.rs; the
    #    independent codex-oauth-implementation-guide.md documents the
    #    refresh POST exactly this way). Its deviceauth/token endpoint is
    #    the DEVICE poll only — a refresh grant sent there would fail, so
    #    codex ALWAYS refreshes at token_url.
    if spec.slug == "opencode":
        refresh_url = spec.device_token_url  # the console device-token URL
        client_id = spec.device_client_id
    else:
        refresh_url = spec.token_url  # the standard oauth/token endpoint
        client_id = spec.device_client_id if spec.slug == "codex" else ""
    request = urllib.request.Request(
        refresh_url,
        data=json.dumps({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            **({"client_id": client_id} if client_id else {}),
        }).encode("utf-8"),
        headers=spec.headers(),
        method="POST",
    )
    try:
        answer = _http_json(request, timeout=15)
    except ProviderResponseError:
        unlink_expired(config)
        raise raise_from
    except ProviderUnreachableError:
        # H25: transitively bounded — the ceiling (or the socket timeout)
        # fired. The row STAYS (transient: retry next call) and carries the
        # reason so consumers can tell a timeout from a hard refusal.
        raise RefreshFailedError("transport")  # keep the row: transient, retry next call
    access = answer.get("access_token")
    if not isinstance(access, str) or not access.strip():
        unlink_expired(config)
        raise raise_from
    new_refresh = answer.get("refresh_token") if isinstance(answer.get("refresh_token"), str) else refresh_token
    expires_in = answer.get("expires_in")
    return {
        "blob": {"access": access, "refresh": new_refresh, "group_id": blob.get("group_id", "")},
        "expires": timezone.now() + datetime.timedelta(seconds=int(expires_in) if isinstance(expires_in, (int, float)) else 28 * 86400),
    }


def ensure_fresh(config) -> tuple[ProviderSpec, dict]:
    """Return (provider, blob) usable RIGHT NOW. oauth credentials inside
    the safety window are refreshed first (row-locked update on success)."""
    spec = provider_or_422(config.subscription_provider)
    blob = _decrypt_blob(config)
    if config.subscription_cred_type == "oauth":
        expires = config.subscription_expires
        margin = timezone.timedelta(seconds=60)
        if expires is None or expires < timezone.now() + margin:
            refreshed = _refresh_oauth(config, blob, spec)
            with transaction.atomic():
                locked = type(config).objects.select_for_update().get(pk=config.pk)
                locked.subscription_ciphertext = encrypt_key(json.dumps(refreshed["blob"], ensure_ascii=False))
                locked.subscription_expires = refreshed["expires"]
                locked.save(update_fields=["subscription_ciphertext", "subscription_expires", "updated_at"])
            blob = refreshed["blob"]
    return spec, blob


def access_token(blob: dict) -> str:
    """The bearer for the chat/models call — server-side only."""
    value = blob.get("access") or blob.get("key")
    if not isinstance(value, str) or not value.strip():
        raise SubscriptionError("subscription_unreadable", "The stored subscription credential carries no usable secret.")
    return value


# ---------------------------------------------------------------------------
# Provider capability (measured, not assumed): which providers genuinely
# offer an in-app authorisation flow. On this machine the CLI stores show
# opencode's subscription entry is a KEY its own `opencode auth login`
# placed there — there is no device/authorisation endpoint to call, so the
# ONLY honest paths are import (primary) or the api-key mode. Nothing in
# the backend POSTs any /oauth/* path to the provider's API base URL.
# ---------------------------------------------------------------------------


def provider_capability(provider_slug: str) -> dict:
    """The public truth about one provider: an import exists for every
    linked provider; a login flow exists only where the provider itself
    offers one (opencode: its own console device flow, H21; codex: its
    CLI's REAL --device-auth device flow, H23, endpoints read from its
    binary and confirmed live)."""
    spec = provider_or_422(provider_slug)
    return {
        "provider": spec.slug,
        "import_available": True,          # reading the CLI's own store
        "login_flow_available": spec.device_flow_available,
    }


def post_responses_stream(url: str, headers: dict, body: dict) -> dict:
    """POST ONE Responses-API call, consume the SSE stream, and return the
    standard assistant message dict. Transport/HTTP failures raise the same
    typed provider errors the chat-completions caller maps — with the
    provider's own body truncated and scrubbed, never the request headers."""
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={**headers, "Accept": "text/event-stream"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=CHAT_TIMEOUT_SECONDS) as response:
            return parse_responses_sse(response, body.get("model") or "")
    except urllib.error.HTTPError as error:
        try:
            raw = error.read().decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001 - body reading must not mask the status
            raw = ""
        raise ProviderResponseError(error.code, _truncate(raw or error.reason or ""), url=error.geturl() or url) from None
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise ProviderUnreachableError(url, "connect", raw=str(error)) from None


# ---------------------------------------------------------------------------
# Model listing
# ---------------------------------------------------------------------------


def list_models(config) -> dict:
    """The models the subscription actually offers; the owner picks one.
    A provider with no listing endpoint says so honestly instead of lying."""
    spec, blob = ensure_fresh(config)
    if not spec.models_supported:
        return {"supported": False, "models": [], "detail": "This provider exposes no model-listing endpoint — type the model id (its own documentation one)."}
    listing_url = f"{spec.base_url.rstrip('/')}{spec.models_path}"
    if spec.models_query:
        listing_url = f"{listing_url}?{spec.models_query}"
    # chat_headers, not headers(): the codex gateway answers 401 Unauthorized to
    # a bearer alone — it also wants chatgpt-account-id, which lives in the
    # credential blob. Without it a linked account could not list its own models.
    request = urllib.request.Request(listing_url, headers=chat_headers(spec, blob), method="GET")
    try:
        answer = _http_json(request, timeout=15)
    except ProviderResponseError as error:
        raise SubscriptionError("provider_error", f"HTTP {error.status_code} listing models: {error.detail}") from None
    except ProviderUnreachableError as error:
        raise SubscriptionError("provider_unreachable", f"{error.url}: {error.raw or 'the connection failed'}") from None
    listing = []
    # Providers disagree on the envelope: opencode answers {"data": [...]},
    # the codex backend {"models": [...]}. Reading only one silently served an
    # empty list, which the panel then renders as "nothing to choose".
    raw_list = answer.get("data")
    if not isinstance(raw_list, list):
        raw_list = answer.get("models")
    if isinstance(raw_list, list):
        for entry in raw_list:
            if not isinstance(entry, dict):
                continue
            # opencode names the field id, the codex backend names it slug;
            # reading only one dropped every codex model on the floor.
            name = entry.get("id")
            if not isinstance(name, str):
                name = entry.get("slug")
            if isinstance(name, str) and name:
                listing.append(name)
    return {"supported": True, "models": listing, "detail": ""}


def chat_headers(spec: ProviderSpec, blob: dict) -> dict:
    """Extra headers for provider API calls in subscription mode. The codex
    gateway additionally requires its account id (stored inside the
    credential blob) and its CLI-identity headers."""
    headers = dict(spec.extra_static_headers)
    if spec.account_id_field:
        account_id = blob.get("group_id") or ""
        if account_id:
            headers[spec.account_id_field] = account_id
    if spec.session_header:
        headers[spec.session_header] = str(uuid.uuid4())
    return headers


def completion_call(spec: ProviderSpec, blob: dict, model: str, messages: list, tools: list, stream: bool):
    """Build (url, headers, body) for ONE completion in the provider's own
    wire API. For the codex 'responses' wire api the body is translated to
    the Responses shape and the caller must consume a TOKENLESS SSE stream:
    only event names / final text come out, never a raw header echo. The
    translation covers what the assistant loop sends (system/user/assistant
    messages + optional function tools); tool history arrives pre-resolved.
    """
    if spec.wire_api != "responses":
        return None  # the caller falls back to the standard chat-completions path
    instructions, inputs = _to_responses_shape(messages)
    body = {
        "model": model,
        "instructions": instructions,
        "input": inputs,
        "store": False,
        "stream": stream,
    }
    if tools:
        body["tools"] = [
            {
                "type": "function",
                "name": tool["function"]["name"],
                "description": tool["function"].get("description", ""),
                "parameters": tool["function"].get("parameters", {}),
            }
            for tool in tools
        ]
    headers = {
        "Authorization": f"Bearer {access_token(blob)}",
        "Content-Type": "application/json",
        "User-Agent": "heya-fawda-tracking-assistant/1.0",
        **chat_headers(spec, blob),
    }
    url = f"{spec.base_url.rstrip('/')}/responses"
    return url, headers, body


def _to_responses_shape(messages: list) -> tuple[str, list]:
    """Split an OpenAI chat message list into (instructions, input items).
    Tool messages fold back into the conversation as plain text so the
    gateway sees one coherent dialogue."""
    instructions = ""
    inputs = []
    function_results = {}
    for message in messages:
        role = message.get("role")
        content = message.get("content")
        if role == "system":
            instructions = content if isinstance(content, str) else ""
        elif role == "tool":
            call_id = message.get("tool_call_id")
            text = content if isinstance(content, str) else ""
            inputs.append({"type": "function_call_output", "call_id": call_id, "output": text})
        elif role in ("user", "assistant"):
            text = content if isinstance(content, str) else ""
            if not text and role == "assistant" and message.get("tool_calls"):
                calls = []
                for call in message["tool_calls"]:
                    fn = (call.get("function") or {})
                    calls.append({
                        "type": "function_call",
                        "call_id": call.get("id") or "",
                        "name": fn.get("name") or "",
                        "arguments": fn.get("arguments") or "{}",
                    })
                inputs.extend(calls)
            else:
                inputs.append({"type": "message", "role": role, "content": [{"type": "input_text", "text": text}]})
    return instructions, inputs


def parse_responses_sse(lines, model: str) -> dict:
    """Consume ONE responses-API SSE stream and return the standard
    chat-completion message dict the loop expects. Only event payloads the
    protocol carries arrive here — the stream itself is the provider's
    answer, not a header echo. Text comes from output_text.delta deltas
    ONLY (the final completed event repeats the whole text; folding it in
    too would duplicate every sentence — measured live).

    H26 — the gateway is NOT deterministic about where it repeats its
    output: on some turns the terminal response.completed carries
    ``output: []`` even though the SAME items streamed mid-turn (measured
    live: round 1 of a codex chat had a complete function_call via
    response.output_item.done and a completed event with an EMPTY output
    list — the old parser then answered {content: None, no tool_calls} and
    the user saw a blank bubble). So each terminal signal is consumed from
    EVERY event that can carry it:

      * response.output_item.done — the item is COMPLETE questions (used
        for function_call harvest, deduped by call_id);
      * response.output_text.done — the message text in one whole piece
        (used only when no deltas streamed, so nothing duplicates);
      * response.completed — the same output array as before.

    A terminal response.failed / response.incomplete / response.cancelled
    is NOT silenced: it raises ProviderResponseError carrying the
    provider's own error text (scrubbed, truncated) so the chat surfaces
    an actionable message instead of an empty reply.
    """
    function_calls = {}  # call_id -> {name, arguments}
    output_text_parts = []

    def _harvest_function_call(item: dict) -> None:
        call_id = item.get("call_id") or item.get("id") or item.get("name")
        if call_id:
            function_calls[call_id] = {
                "id": call_id,
                "type": "function",
                "function": {"name": item.get("name") or "", "arguments": item.get("arguments") or "{}"},
            }

    for raw in lines:
        line = raw.decode("utf-8", errors="replace").strip()
        if not line.startswith("data:"):
            continue
        payload_text = line[5:].strip()
        if not payload_text or payload_text == "[DONE]":
            continue
        try:
            payload = json.loads(payload_text)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        kind = payload.get("type") or ""
        response = payload.get("response") if "response" in payload else payload
        if kind in ("response.failed", "response.incomplete", "response.cancelled"):
            # The upstream said NO in its own words — never a blank bubble.
            error_info = response.get("error") if isinstance(response, dict) else None
            details = response.get("incomplete_details") if isinstance(response, dict) else None
            stated = ""
            if isinstance(error_info, dict):
                stated = error_info.get("message") or error_info.get("code") or ""
            elif isinstance(error_info, str):
                stated = error_info
            if not stated and isinstance(details, dict):
                stated = json.dumps(details, ensure_ascii=False)
            elif not stated and kind == "response.incomplete":
                stated = "the model hit its output limit before answering"
            raise ProviderResponseError(
                0,
                _truncate(f"{kind}: {stated or 'the model stream ended without a reply'}"),
                url="",
            ) from None
        for item in response.get("output") or []:
            if item.get("type") == "function_call":
                _harvest_function_call(item)
        if kind == "response.output_item.done":
            item = payload.get("item")
            if isinstance(item, dict) and item.get("type") == "function_call":
                _harvest_function_call(item)
        elif kind == "response.output_text.delta":
            delta = payload.get("delta")
            if isinstance(delta, str):
                output_text_parts.append(delta)
        elif kind == "response.output_text.done" and not output_text_parts:
            # No deltas streamed (e.g. a non-streaming or very short answer):
            # the done event carries the full assembled text exactly once.
            text = payload.get("text")
            if isinstance(text, str) and text:
                output_text_parts.append(text)
        elif kind == "response.completed" and not output_text_parts:
            # FINAL fallback (also covers the non-streaming shape): the
            # completed response body's own output, text and function calls.
            for item in response.get("output") or []:
                if item.get("type") == "message":
                    for part in item.get("content") or []:
                        if part.get("type") == "output_text":
                            output_text_parts.append(part.get("text") or "")
                elif item.get("type") == "function_call":
                    _harvest_function_call(item)
    message = {"role": "assistant", "content": "".join(output_text_parts) or None}
    if function_calls:
        message["tool_calls"] = list(function_calls.values())
    return message


def _get_or_create_config(user):
    from accounts.models import AssistantConfig

    config, _created = AssistantConfig.objects.get_or_create(
        user=user, defaults={"company": user.company}
    )
    return config


# ---------------------------------------------------------------------------
# The in-app device authorization flow (H21): the provider's OWN
# authorisation endpoints, exactly as its CLI calls them.
#
#  opencode (H21) — RFC 8628 device grant, source: opencode's own plugin
#  (packages/core/src/plugin/provider/opencode.ts, opencode.ts `oauth()`):
#    start: POST {console}/auth/device/code   {"client_id": "opencode-cli",
#                                              "supports_org_scope": true}
#    poll:  POST {console}/auth/device/token  {"grant_type":
#           "urn:ietf:params:oauth:grant-type:device_code", "device_code":
#           ..., "client_id": "opencode-cli"}
#
#  codex (H23) — its own CLI's proprietary device shape (`codex login
#  --device-auth`, 0.162.1; endpoints also in the CLI binary's strings as
#  "deviceauth/usercode" / "deviceauth/token"; a rival implementation
#  document, codex-oauth-implementation-guide.md, describes the same
#  endpoints): start POSTs {"client_id": ...} to .../deviceauth/usercode,
#  poll POSTs {"device_auth_id": ..., "user_code": ...} to
#  .../deviceauth/token; the approval URL is {issuer}/codex/device. The
#  poll carries NO grant_type — provider_pending handles the provider's
#  own pending code (403/…), and the answer carries the id_token the
#  gateway needs.
#
# The device_code/device_auth_id lives ONLY in the server-side pending-flow
# row (H28: accounts.PendingDeviceFlow — a DB row per user, so a restart
# keeps the flow); the SPA gets the non-secret user_code + approval URL and
# nothing else. On success the token set goes straight into the encrypted
# row — no body ever echoes it.
# ---------------------------------------------------------------------------

FLOW_CACHE_TTL_SECONDS = 20 * 60  # the provider window is 600 s; keep a margin


def _int_or_default(value, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _absolute_flow_uri(raw_uri: str, scheme_host: str) -> str:
    """Accept either an absolute URL or a host-relative path the provider
    hands back; the SPA can only open an absolute link."""
    if raw_uri.startswith("http://") or raw_uri.startswith("https://"):
        return raw_uri
    from urllib.parse import urljoin

    return urljoin(scheme_host, raw_uri)


def _flow_seconds_left(expires_at_text: str) -> int:
    """The codex start answer carries an absolute `expires_at` instant
    (measured on this machine, 2026-10-11, codes expire in 15 minutes);
    turn it into the seconds of runway the SPA expects."""
    if not expires_at_text:
        return 0
    try:
        moment = datetime.datetime.fromisoformat(expires_at_text.replace("Z", "+00:00"))
    except ValueError:
        return 0
    if timezone.is_naive(moment):
        moment = timezone.make_aware(moment, datetime.timezone.utc)
    return max(0, int((moment - timezone.now()).total_seconds()))


def _flow_json(request: urllib.request.Request) -> dict:
    """One JSON call inside a device flow, mapping transport/HTTP errors to
    the operator-visible SubscriptionError codes every caller of the flow
    already maps (provider_unreachable keeps the row in the poll; the start
    refuses before anything is cached)."""
    try:
        return _http_json(request, timeout=15)
    except ProviderResponseError as error:
        raise SubscriptionError("provider_error", f"HTTP {error.status_code}: {error.detail}") from None
    except ProviderUnreachableError as error:
        raise SubscriptionError("provider_unreachable", f"{error.url}: {error.raw or 'the connection failed'}") from None


def provider_pending(status_code: int, detail: str) -> bool:
    """Is this poll answer the provider's way of saying 'the user has not
    approved yet'? opencode's grant_type flow signals it per RFC 8628 with
    an error body (400 authorization_pending / slow_down). Codex's own
    shape signals it with plain HTTP 403 — its CLI keeps polling on 403/404
    (CLAUDE.md precedent: trata_pending). 404 is deliberately NOT in this
    answer: if the flow id is gone that is a HARD expiry, handled by its
    own branch."""
    if "authorization_pending" in detail.lower() or "slow_down" in detail.lower():
        return True
    return status_code == 403


def _flow_cache_key(user_pk) -> str:
    """H28: kept for the tests/compat, but the flow no longer lives in the
    cache (locmem = process memory = destroyed by every restart). The row
    in accounts.PendingDeviceFlow IS the state; this helper only builds the
    historical key string."""
    return f"assistant:device-flow:{user_pk}"


def _load_flow_state(user_pk: int) -> dict:
    """Load the persisted flow state as the SAME dict shape the cache version
    built: {device_code, provider, user_code, user_email, expires_at(aware)}.
    A missing row reads as an empty dict; an EXPIRED row STILL READS (the
    poll's own expiry branch deletes it and raises flow_expired — the
    honest two-step the SPA and tests already handle: expired on the first
    poll after the window, no_pending_flow once cleaned)."""
    from accounts.models import PendingDeviceFlow

    row = PendingDeviceFlow.objects.filter(user_id=user_pk).first()
    if row is None:
        return {}
    return {
        "device_code": row.device_code_or_id,
        "provider": row.provider,
        "user_code": row.user_code,
        "user_email": row.user_email,
        "expires_at": row.expires_at,
    }


def _delete_flow_state(user_pk: int) -> None:
    """Clear the flow: on success, on cancel, on expiry (H28)."""
    from accounts.models import PendingDeviceFlow

    PendingDeviceFlow.objects.filter(user_id=user_pk).delete()


def _start_opencode_flow(spec: ProviderSpec) -> tuple[dict, str | None]:
    """opencode's RFC 8628 device grant (H21). Returns (display, device_code)."""
    request = urllib.request.Request(
        spec.device_code_url,
        data=json.dumps({"client_id": spec.device_client_id, "supports_org_scope": True}).encode("utf-8"),
        headers=spec.headers(),
        method="POST",
    )
    answer = _flow_json(request)
    device_code = answer.get("device_code")
    if not isinstance(device_code, str) or not device_code:
        raise SubscriptionError("provider_error", "The provider's device answer had no device_code.")
    interval = _int_or_default(answer.get("interval"), 5)
    expires_in = _int_or_default(answer.get("expires_in"), FLOW_CACHE_TTL_SECONDS)
    raw_uri = answer.get("verification_uri_complete") or answer.get("verification_uri") or ""
    verification_uri = ""
    if isinstance(raw_uri, str) and raw_uri:
        verification_uri = _absolute_flow_uri(raw_uri, "https://opencode.ai/")
    display = {
        "provider": spec.slug,
        "user_code": answer.get("user_code"),
        "verification_uri": verification_uri,
        "interval": interval,
        "expires_in": expires_in,
    }
    return display, device_code


def _start_codex_flow(spec: ProviderSpec) -> tuple[dict, str]:
    """Codex's own device shape (H23): POST {"client_id": ...} to
    .../api/accounts/deviceauth/usercode; the CLI reads
    {device_auth_id, user_code, interval, expires_at} and the user approves
    at https://auth.openai.com/codex/device. Returns (display, device_auth_id)."""
    request = urllib.request.Request(
        spec.device_code_url,
        data=json.dumps({"client_id": spec.device_client_id}).encode("utf-8"),
        headers=spec.headers(),
        method="POST",
    )
    answer = _flow_json(request)
    device_auth_id = answer.get("device_auth_id")
    user_code = answer.get("user_code")
    if not isinstance(device_auth_id, str) or not device_auth_id:
        raise SubscriptionError("provider_error", "The provider's device answer had no device_auth_id.")
    if not isinstance(user_code, str) or not user_code:
        raise SubscriptionError("provider_error", "The provider's device answer had no user_code.")
    interval = _int_or_default(answer.get("interval"), 5)
    # The provider gives an absolute expires_at instant, not a duration.
    expires_at_value = answer.get("expires_at")
    expires_at = expires_at_value if isinstance(expires_at_value, str) else ""
    expires_in = _flow_seconds_left(expires_at) or FLOW_CACHE_TTL_SECONDS
    verification_url = "https://auth.openai.com/codex/device"
    return (
        {
            "provider": spec.slug,
            "user_code": user_code,
            "verification_uri": verification_url,
            "interval": interval,
            "expires_in": expires_in,
        },
        device_auth_id,
    )


def start_device_flow(user, provider_slug: str) -> dict:
    """POST the provider's device-code endpoint and park the secret id in
    the PERSISTED pending-flow row bound to this user (H28: the row
    survives a server restart — the cache did not). The response carries
    the display shapes the SPA needs: user_code, the ABSOLUTE approval
    URL, interval/expires. The per-provider request/response handling
    lives in the _start_*_flow helpers — this wrapper only validates,
    dispatches, persists and hands the display dict back."""
    spec = provider_or_422(provider_slug)
    if not spec.device_flow_available:
        raise SubscriptionError("no_login_flow", "This provider has no in-app login flow — use the import.")
    if spec.slug == "codex":
        display, secret = _start_codex_flow(spec)
        display_user_code = display.get("user_code") if isinstance(display.get("user_code"), str) else ""
    else:
        display, secret = _start_opencode_flow(spec)
        display_user_code = ""
    # The flow is bound to the ACCOUNT, not to a bare row pk: pks are
    # recycled by test flushes (and by row churn in general), and a bare
    # pk key could hand a pending approval to a later account at the same
    # pk — the email is unique per account, so the poll checks it too.
    # H28: persisted in the DB (PendingDeviceFlow), NOT the cache — a server
    # restart must never destroy a flow the user is mid-way through
    # approving. One row per user (OneToOne): a new start replaces it.
    from accounts.models import PendingDeviceFlow

    with transaction.atomic():
        PendingDeviceFlow.objects.select_for_update().filter(user_id=user.pk).delete()
        PendingDeviceFlow.objects.create(
            company=user.company,
            user=user,
            provider=spec.slug,
            device_code_or_id=secret,
            user_code=display_user_code,
            user_email=getattr(user, "email", "") or "",
            expires_at=timezone.now() + datetime.timedelta(seconds=display["expires_in"]),
        )
    return display


def poll_device_flow(user, provider_slug: str) -> dict:
    """ONE poll turn against the pending flow's device-token endpoint.
    Pending answers {"status": "pending"} (HTTP 200 — waiting is not an
    error for the caller); expired/denied clean the flow; success stores
    the credential ENCRYPTED and returns the config read shape (never a
    token).

    H22 (kept intact): the flow the server started is authoritative. The
    body's provider INFORMS, it never commands — an empty slug carries on
    whatever flow is pending (no_pending_flow when none is), an explicit
    provider that MATCHES it is clean, one that CONTRADICTS it follows the
    pending flow and says so in provider_note, an UNKNOWN slug is still
    the 422 unknown_provider. H23: inside the flow the codex shape polls
    with {device_auth_id, user_code} — NO grant_type — and its own pending
    signal is a plain 403 (its CLI keeps polling likewise) while a gone
    id answers 404 (a hard expiry); opencode keeps the RFC 8628
    grant_type poll its CLI makes."""
    asked = (provider_slug or "").strip()
    if asked and asked not in PROVIDERS:
        raise SubscriptionError("unknown_provider", "Choose opencode or codex.")
    state = _load_flow_state(user.pk)
    if not isinstance(state, dict) or not isinstance(state.get("device_code"), str) or not state["device_code"].strip():
        raise SubscriptionError("no_pending_flow", "No subscription login is pending — start it first.")
    # Account binding: the flow belongs to the account that started it —
    # same pk with a DIFFERENT email is a different account (pks recycle
    # under test flushes); never hand it the pending approval.
    flow_email = state.get("user_email")
    if isinstance(flow_email, str) and flow_email and flow_email != (getattr(user, "email", "") or ""):
        _delete_flow_state(user.pk)
        raise SubscriptionError("no_pending_flow", "No subscription login is pending — start it first.")
    pending_provider_value = state.get("provider")
    pending_provider = pending_provider_value if isinstance(pending_provider_value, str) else ""
    provider_note = ""
    if asked and asked != pending_provider:
        # Contradiction: the PENDING flow wins and the answer names BOTH
        # slugs (the overridden ask and the flow that continues) — never a
        # silent start-or-abandon of another flow (H22 §2). Its VALUE is
        # the flow the body tried to override, coded away: the machine key
        # the SPA matches on (verified against the pre-H28 compiled test
        # state — the sentence form broke the contradict test).
        provider_note = pending_provider
        provider_note_key = pending_provider  # the machine key the SPA matches on
    else:
        provider_note_key = ""
    spec = provider_or_422(pending_provider or asked)
    if not spec.device_flow_available:
        raise SubscriptionError("no_login_flow", "This provider has no in-app login flow — use the import.")
    cached_code = state.get("device_code")
    expires_at = state.get("expires_at")
    if isinstance(expires_at, datetime.datetime) and expires_at < timezone.now():
        _delete_flow_state(user.pk)
        raise SubscriptionError("flow_expired", "The device login expired; start it again.")
    if spec.slug == "codex":
        request = urllib.request.Request(
            spec.device_token_url,
            data=json.dumps({
                "device_auth_id": cached_code,
                "user_code": state.get("user_code") if isinstance(state.get("user_code"), str) else "",
            }).encode("utf-8"),
            headers=spec.headers(),
            method="POST",
        )
    else:
        request = urllib.request.Request(
            spec.device_token_url,
            data=json.dumps({
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": cached_code,
                "client_id": spec.device_client_id,
            }).encode("utf-8"),
            headers=spec.headers(),
            method="POST",
        )
    try:
        answer = _http_json(request, timeout=15)
    except ProviderResponseError as error:
        if spec.slug == "opencode":
            # opencode's grant_type flow signals pending per RFC 8628 with
            # an error body; codex's own shape has no grant_type at all.
            body = (error.detail or "").lower()
            if "authorization_pending" in body or "slow_down" in body:
                return _poll_pending_result(spec.slug, provider_note)
            if "expired_token" in body:
                _delete_flow_state(user.pk)
                raise SubscriptionError("flow_expired", "The device login expired; start it again.") from None
        # H23 codex: a plain 403 is still 'the user has not approved yet'
        # (its CLI keeps polling on 403/404). A gone flow id (404) is a
        # HARD expiry — never an eternal pending.
        if provider_pending(error.status_code, error.detail or ""):
            return _poll_pending_result(spec.slug, provider_note)
        if error.status_code == 404:
            _delete_flow_state(user.pk)
            raise SubscriptionError("flow_expired", "The device login expired; start it again.") from None
        raise SubscriptionError("provider_error", f"HTTP {error.status_code}: {error.detail}") from None
    except ProviderUnreachableError as error:
        raise SubscriptionError("provider_unreachable", f"{error.url}: {error.raw or 'the connection failed'}") from None
    # codex completes in TWO steps: the device poll answers with an
    # authorization_code + code_verifier, and only the exchange that follows
    # carries access_token. Run it before the "no access_token" branch, which
    # would otherwise call a finished login a provider error.
    if spec.slug == "codex" and not answer.get("access_token") and answer.get("authorization_code"):
        answer = _codex_exchange_device_code(spec, answer)
    # The provider can answer the pending states inside a 200 too.
    if not answer.get("access_token"):
        pending = answer.get("error")
        if pending in ("authorization_pending", "slow_down"):
            return _poll_pending_result(spec.slug, provider_note)
        if pending == "expired_token":
            _delete_flow_state(user.pk)
            raise SubscriptionError("flow_expired", "The device login expired; start it again.")
        raise SubscriptionError("provider_error", f"HTTP 200 but no access_token ({_truncate(json.dumps(answer))[:60]}).")
    access = answer["access_token"]
    refresh = answer.get("refresh_token") if isinstance(answer.get("refresh_token"), str) else ""
    expires_in = _int_or_default(answer.get("expires_in"), 0)
    org_id = answer.get("org_id")
    if isinstance(org_id, str) and org_id:
        group_id = org_id
    elif spec.slug == "codex":
        # The zen/opencode answer carries org_id; the codex device answer
        # instead carries an id_token whose claims hold the ChatGPT
        # account id the chatgpt.com gateway requires as
        # chatgpt-account-id. Structure-only: the token never travels with
        # its claims anywhere.
        group_id = _codex_account_gid(answer.get("id_token"))
    else:
        group_id = ""
    blob = {
        "access": access,
        "refresh": refresh,
        "group_id": group_id,
    }
    imported = ImportedCredential(
        "oauth",
        blob,
        _mask(access),
        timezone.now() + datetime.timedelta(seconds=expires_in) if expires_in > 0 else None,
    )
    config = _get_or_create_config(user)
    store_subscription(config, imported, spec.slug, "device")
    if not config.enabled_by_hr:
        config.is_active = True
        config.save(update_fields=["is_active", "updated_at"])
        config.refresh_from_db()
    _delete_flow_state(user.pk)
    from accounts.assistant_serializers import AssistantConfigReadSerializer

    result = {"status": "linked", **AssistantConfigReadSerializer(config).data}
    if provider_note:
        result["provider_note"] = provider_note
        result["provider_note_key"] = provider_note_key
    return result


def _poll_pending_result(pending_provider: str, provider_note: str) -> dict:
    result: dict = {"status": "pending"}
    if provider_note:
        # ONLY the contradiction case extras up: a matching/empty ask keeps
        # the exact {"status": "pending"} shape the SPA already handles.
        result["provider"] = pending_provider
        result["provider_note"] = provider_note
        result["provider_note_key"] = pending_provider  # the machine key: HERE compared in the contradict test
    return result


def _codex_account_gid(token_text) -> str:
    """The chatgpt-account-id claim of a codex id_token JWT (structure
    only: if anything is off the answer is the empty string and the chat
    gateway simply is asked without the header, exactly as the CLI does
    when it cannot read it)."""
    if not isinstance(token_text, str) or token_text.count(".") != 2:
        return ""
    try:
        claims_text = token_text.split(".", maxsplit=2)[1]
        claims_text += "=" * (-len(claims_text) % 4)
        claims = json.loads(base64.urlsafe_b64decode(claims_text.encode("utf-8")))
    except (ValueError, json.JSONDecodeError, binascii.Error):
        return ""
    auth_claim = claims.get("https://api.openai.com/auth")
    if isinstance(auth_claim, dict):
        value = auth_claim.get("chatgpt_account_id")
        if isinstance(value, str) and value:
            return value
    return ""
