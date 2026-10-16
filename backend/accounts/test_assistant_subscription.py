"""Story H19 tests: subscription login for the «مدام عفاف» assistant.

H19 fix-up 4 world: the backend links a subscription by IMPORTING the
provider CLI's own stored login — never by calling an authored /oauth/*
endpoint on the provider's API base (the invented <base_url>/oauth/device/
start POST is GONE; regression tests prove the start/poll routes no longer
exist and that no backend call ever POSTs /oauth/* to a provider host
beyond the one legitimate token-refresh URL). What is proven here, against
a STUB provider server this file starts itself (localhost HTTPServer — no
real provider touched):

  * capability honesty: GET /assistant/subscription/capability says
    import_available=True and login_flow_available=False, and the two
    invented routes /assistant/subscription/{start,poll} return 404;
  * the import flow end-to-end (key shape AND oauth shape): the CLI store
    is read server-side, the credential is stored ENCRYPTED, and no
    response body ever carries token or key material;
  * oauth refresh: an expired access token triggers exactly one refresh
    POST (carrying only the refresh token to the token URL), the row is
    updated encrypted, and a FAILED refresh unlinks the row with an audit
    event so every consumer answers 409 not_configured (never a silent
    dead button);
  * the linked subscription actually DRIVES a probe/chat round: the
    provider sees the session header (x-opencode-session) the gateway
    requires plus the Bearer credential from the stored row;
  * token material never reaches: response bodies, error text, or the audit.
"""
import datetime
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import assistant_subscriptions
from accounts import assistant_views
from accounts.assistant_crypto import decrypt_key, encrypt_key, key_hint
from accounts.models import AssistantConfig, AuditEvent, User
from tenants.context import default_company

User = User


def _mk_user(email, role=User.Role.EMPLOYEE):
    return User.objects.create_user(company=default_company(), email=email, password="pass-12345678", role=role)


@pytest.fixture
def anon_client():
    return APIClient(enforce_csrf_checks=True)


@pytest.fixture
def client_csrf(anon_client):
    anon_client.get("/api/v1/auth/csrf")
    token = anon_client.cookies["heya_fawda_csrftoken"].value
    return anon_client, token


def _put(client, token, path, body):
    return client.put(path, body, format="json", HTTP_X_CSRFTOKEN=token)


def _post(client, token, path, body):
    return client.post(path, body, format="json", HTTP_X_CSRFTOKEN=token)


# ---------------------------------------------------------------------------
# The STUB provider server: a localhost HTTPServer speaking the provider
# shapes (token refresh, chat-completions, models listing) with the token
# material it hands out kept here so the tests can assert NOTHING echoes it
# back. It also RECORDS every path ever POSTed so the /oauth/* regression
# proof is real observation, not an assumption about the code.
# ---------------------------------------------------------------------------

ACCESS_TOKEN = "stub.access.token-ZZQ9"  # distinctive tail, easy to grep for
REFRESH_TOKEN = "stub.refresh.token-RRQ7"
NEW_ACCESS_TOKEN = "stub.access.token-ROTATED-2"
OPENCODE_KEY = "oc-sk-live-key-material-8888"

_STATE = {
    "refresh_calls": 0,
    "chat_calls": [],
    "refresh_should_fail": False,
    "posted_paths": [],  # every POST path the backend sent to the provider
    # H21 device-flow stub state: the CURRENT device_code and whether the
    # stub should say approved (so the next poll succeeds) or expired.
    "device_codes": set(),
    "device_approve_next": False,
    "device_expire_next": False,
    "device_slow_down_next": False,
}

DEVICE_ACCESS_TOKEN = "device.access.token-DD41"
DEVICE_REFRESH_TOKEN = "device.refresh.token-DR42"
DEVICE_EXPIRES_IN = 3600


def _b64u(payload: dict) -> str:
    import base64 as _b64

    raw = json.dumps(payload).encode()
    return _b64.urlsafe_b64encode(raw).rstrip(b"=").decode()


# A JWT-SHAPED id_token (header.payload.signature) whose claims carry the
# ChatGPT account id EXACTLY the way the measured codex id_token does
# (https://api.openai.com/auth.chatgpt_account_id) — the poll handler uses
# it to prove the backend derives the gateway's account header from it.
_STUB_CODEX_ID_TOKEN = ".".join([
    _b64u({"alg": "RS256", "typ": "JWT"}),
    _b64u({
        "aud": "app_EMoamEEZ73f0CkXaXp7hrann",
        "email": "stub-owner@example.com",
        "https://api.openai.com/auth": {
            "chatgpt_account_id": "acct-stub-codex-41",
            "chatgpt_plan_type": "plus",
        },
    }),
    _b64u({"sig": "stub"}),
])


class _StubHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep test output clean
        pass

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode() if length else "{}"
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}

    def do_POST(self):
        _STATE["posted_paths"].append(self.path)
        payload = self._read_body()
        if self.path.endswith("/console/auth/device/code"):
            # The provider's own device-start shape (opencode.ts Device
            # schema): device_code/user_code/verification_uri_complete/
            # expires_in/interval. The backend's client_id + org-scope flag
            # are recorded for the assertion that they match the CLI's.
            _STATE["last_device_start_body"] = payload
            device_code = f"stub-device-{len(_STATE['device_codes']) + 1}-QQ51"
            _STATE["device_codes"].add(device_code)
            self._json({
                "device_code": device_code,
                "user_code": "STUB-CODE",
                "verification_uri": "/console/device",
                "verification_uri_complete": f"/console/device?user_code=STUB-CODE&client_id=opencode-cli",
                "expires_in": 600,
                "interval": 5,
            })
        elif self.path.endswith("/api/accounts/deviceauth/usercode"):
            # The codex CLI's own device-start shape (0.162.1, `codex login
            # --device-auth`; measured live): device_auth_id + user_code +
            # interval as a STRING + expires_at (an instant, not a
            # duration). The client_id recorded for the CLI-match assert.
            _STATE["last_device_start_body"] = payload
            _device_auth_id = f"stub-deviceauth-{len(_STATE['device_codes']) + 1}-QQ51"
            _STATE["device_codes"].add(_device_auth_id)
            _STATE["last_codex_user_code"] = f"STUB-CODE-{len(_STATE['device_codes'])}"
            from django.utils import timezone as _tz

            self._json({
                "device_auth_id": _device_auth_id,
                "user_code": _STATE["last_codex_user_code"],
                "interval": "5",
                "expires_at": (_tz.now() + datetime.timedelta(minutes=15)).isoformat(),
            })
        elif self.path.endswith("/api/accounts/deviceauth/token"):
            # The codex CLI's own device-poll shape: {device_auth_id,
            # user_code} — NO grant_type. Pending is a plain HTTP 403 (its
            # CLI keeps polling on it); approval answers the id_token
            # (whose claims carry the ChatGPT account id), access and
            # refresh tokens. Expiry is a 404 (id gone).
            _STATE["last_device_poll_body"] = payload
            _device_auth_id = payload.get("device_auth_id")
            if _device_auth_id not in _STATE["device_codes"]:
                self._json({"_tag": "DeviceTokenError", "error": "invalid_request"}, status=404)
            elif _STATE["device_expire_next"]:
                _STATE["device_expire_next"] = False
                self._json({"_tag": "DeviceTokenError", "error": "invalid_request"}, status=404)
            elif _STATE["device_slow_down_next"]:
                _STATE["device_slow_down_next"] = False
                self._json({"_tag": "DeviceTokenError", "error": "invalid_request"}, status=403)
            elif _STATE["device_approve_next"]:
                _STATE["device_approve_next"] = False
                self._json({
                    "access_token": DEVICE_ACCESS_TOKEN,
                    "refresh_token": DEVICE_REFRESH_TOKEN,
                    "expires_in": DEVICE_EXPIRES_IN,
                    "id_token": _STUB_CODEX_ID_TOKEN,
                })
            else:
                self._json({"_tag": "DeviceTokenError", "error": "authorization_pending"}, status=403)
        elif self.path.endswith("/console/auth/device/token"):
            grant = payload.get("grant_type")
            device_code = payload.get("device_code")
            _STATE["last_device_poll_body"] = payload
            if grant == "urn:ietf:params:oauth:grant-type:device_code":
                if device_code not in _STATE["device_codes"]:
                    self._json({"_tag": "DeviceTokenError", "error": "invalid_grant"}, status=400)
                elif _STATE["device_expire_next"]:
                    _STATE["device_expire_next"] = False
                    self._json({"_tag": "DeviceTokenError", "error": "expired_token"}, status=400)
                elif _STATE["device_slow_down_next"]:
                    _STATE["device_slow_down_next"] = False
                    self._json({"_tag": "DeviceTokenError", "error": "slow_down"}, status=400)
                elif _STATE["device_approve_next"]:
                    _STATE["device_approve_next"] = False
                    self._json({
                        "access_token": DEVICE_ACCESS_TOKEN,
                        "refresh_token": DEVICE_REFRESH_TOKEN,
                        "expires_in": DEVICE_EXPIRES_IN,
                        "org_id": "org-stub-41",
                    })
                else:
                    self._json({
                        "_tag": "DeviceTokenError",
                        "error": "authorization_pending",
                        "error_description": "The authorization request is still pending",
                    }, status=400)
            elif grant == "refresh_token":
                _STATE["refresh_calls"] += 1
                if _STATE["refresh_should_fail"]:
                    self._json({"error": "invalid_grant"}, status=400)
                else:
                    self._json({
                        "access_token": NEW_ACCESS_TOKEN,
                        "refresh_token": REFRESH_TOKEN + "-r",
                        "expires_in": 7200,
                    })
            else:
                # NO other grant is honoured: a device-flow POST would land
                # here and that must never happen (asserted via posted_paths).
                self._json({"error": "unsupported_grant_type"}, status=400)
        elif self.path.endswith("/oauth/token"):
            grant = payload.get("grant_type")
            if grant == "refresh_token":
                # BOTH providers may land here: opencode's legacy local
                # import (pre-device-flow shape) AND codex (its CLI
                # refreshes exactly here — H23). The client_id travels
                # with codex's refresh; record it without asserting who.
                _STATE["last_refresh_client_id"] = payload.get("client_id")
                _STATE["refresh_calls"] += 1
                if _STATE["refresh_should_fail"]:
                    self._json({"error": "invalid_grant"}, status=400)
                else:
                    self._json({
                        "access_token": NEW_ACCESS_TOKEN,
                        "refresh_token": REFRESH_TOKEN + "-r",
                        "expires_in": 7200,
                    })
            else:
                self._json({"error": "unsupported_grant_type"}, status=400)
        elif self.path.endswith("/responses"):
            # The codex gateway's own wire API: openai zu-standard SSE with
            # header-only echo irrelevant to the caller; the backend's
            # completion_call consumes only event names & final text.
            _STATE["chat_calls"].append({
                "session": "(responses-api: no session header)",
                "auth": self.headers.get("Authorization"),
                "account_header": self.headers.get("chatgpt-account-id"),
                "originator": self.headers.get("originator"),
                "beta": self.headers.get("OpenAI-Beta"),
                # `payload` (read ONCE at the top of do_POST) — NOT
                # self._read_body() again: the second read re-requested
                # Content-Length bytes the buffered reader had already
                # consumed, so the handler blocked forever on the socket
                # while the client blocked on the SSE response — the full
                # suite hung at the first codex /responses chat (until the
                # client's 300s CHAT_TIMEOUT_SECONDS, which nothing here
                # was patient enough to see).
                "body": payload,
            })
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            _sse = (
                b"event: response.output_text.delta\n"
                b'data: {"type": "response.output_text.delta", "delta": "pong"}\n\n'
                b"event: response.completed\n"
                b'data: {"type": "response.completed", "response": {"output": [{"type": "message", "content": [{"type": "output_text", "text": "pong"}]}]}}\n\n'
            )
            self.wfile.write(_sse)
        elif self.path.endswith("/chat/completions"):
            _STATE["chat_calls"].append({
                "session": self.headers.get("x-opencode-session"),
                "auth": self.headers.get("Authorization"),
            })
            self._json({
                "choices": [{"message": {"role": "assistant", "content": ""}}],
            })
        else:
            self._json({"error": "not_found"}, status=404)

    def do_GET(self):
        if self.path.endswith("/models"):
            self._json({"data": [{"id": "glm-5.3-flash"}, {"id": "claude-sonnet-4"}]})
        else:
            self._json({"error": "not_found"}, status=404)


@pytest.fixture(scope="module")
def stub_server():
    # ThreadingHTTPServer (daemon threads): one stuck connection can never
    # starve the accept loop — a request is always served on its own thread.
    server = ThreadingHTTPServer(("127.0.0.1", 0), _StubHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    import accounts.assistant_subscriptions as subs

    # The registry reads env at import; point the specs at the stub for the
    # module's lifetime (the same override mechanism the settings hooks use;
    # no real gateway is contacted from these tests). NOTE: there is NO
    # device_auth_url override any more — the backend has no such call.
    old = {
        "token_url": subs.OPENCODE.token_url,
        "base_url": subs.OPENCODE.base_url,
        "device_code_url": subs.OPENCODE.device_code_url,
        "device_token_url": subs.OPENCODE.device_token_url,
        "device_client_id": subs.OPENCODE.device_client_id,
        # H23: the codex spec rides the SAME stub (its deviceauth shape,
        # its refresh URL, and its /responses chat gateway are all
        # honestly stubbed below).
        "codex_token_url": subs.CODEX.token_url,
        "codex_base_url": subs.CODEX.base_url,
        "codex_device_code_url": subs.CODEX.device_code_url,
        "codex_device_token_url": subs.CODEX.device_token_url,
        "codex_device_client_id": subs.CODEX.device_client_id,
    }
    subs.OPENCODE.token_url = f"{base}/oauth/token"
    subs.OPENCODE.base_url = f"{base}/v1"
    subs.OPENCODE.device_code_url = f"{base}/console/auth/device/code"
    subs.OPENCODE.device_token_url = f"{base}/console/auth/device/token"
    subs.OPENCODE.device_client_id = "opencode-cli"
    subs.CODEX.token_url = f"{base}/oauth/token"
    subs.CODEX.base_url = f"{base}/codex-gateway"
    subs.CODEX.device_code_url = f"{base}/api/accounts/deviceauth/usercode"
    subs.CODEX.device_token_url = f"{base}/api/accounts/deviceauth/token"
    subs.CODEX.device_client_id = "app_EMoamEEZ73f0CkXaXp7hrann"
    yield subs, base
    subs.OPENCODE.token_url = old["token_url"]
    subs.OPENCODE.base_url = old["base_url"]
    subs.OPENCODE.device_code_url = old["device_code_url"]
    subs.OPENCODE.device_token_url = old["device_token_url"]
    subs.OPENCODE.device_client_id = old["device_client_id"]
    subs.CODEX.token_url = old["codex_token_url"]
    subs.CODEX.base_url = old["codex_base_url"]
    subs.CODEX.device_code_url = old["codex_device_code_url"]
    subs.CODEX.device_token_url = old["codex_device_token_url"]
    subs.CODEX.device_client_id = old["codex_device_client_id"]
    server.shutdown()


# ---------------------------------------------------------------------------
# 1. Capability honesty + the invented routes are gone
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_capability_import_always_login_flow_where_a_real_one_exists(client_csrf):
    """H21: opencode offers its OWN console device flow (source-verified in
    the provider's plugin), so login_flow_available is TRUE for it. H23,
    per the owner's word («عاوزك تضيف اني اقدر اشترك بردو لكودكس بقا»):
    codex's CLI ships a REAL device flow too (`codex login --device-auth`,
    endpoints read from the CLI binary and confirmed live against
    auth.openai.com), so its capability is also TRUE — and the Web panel
    works for the codex tab exactly as it does for opencode."""
    from accounts.assistant_subscriptions import CODEX, OPENCODE  # the CLI truth itself

    client, token = client_csrf
    user = _mk_user("h19.cap@example.com")
    client.force_login(user)
    response = client.get("/api/v1/assistant/subscription/capability?provider=opencode")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["provider"] == "opencode"
    assert data["import_available"] is True
    assert data["login_flow_available"] is True
    assert OPENCODE.device_flow_available  # the CLI's own console flow
    response = client.get("/api/v1/assistant/subscription/capability?provider=codex")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["provider"] == "codex"
    assert data["import_available"] is True
    assert data["login_flow_available"] is True
    assert CODEX.device_flow_available  # the CLI's OWN --device-auth flow
    assert "deviceauth/usercode" in CODEX.device_code_url   # the CLI binary's path
    assert "deviceauth/token" in CODEX.device_token_url  # its poll endpoint too
    assert CODEX.device_client_id == "app_EMoamEEZ73f0CkXaXp7hrann"  # its own aud


@pytest.mark.django_db
def test_unknown_provider_capability_is_a_422(client_csrf):
    client, token = client_csrf
    user = _mk_user("h19.cap422b@example.com")
    client.force_login(user)
    response = client.get("/api/v1/assistant/subscription/capability?provider=nope")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unknown_provider"


@pytest.mark.django_db
def test_start_and_poll_are_real_routes_now(stub_server, client_csrf):
    """H21 regression flip kept: the routes EXIST and speak the device
    flow, and an unknown provider is still the honest 422 — never 404.
    H23: a codex start is NOT a refusal any more — the CLI ships a real
    device flow and the panel starts it (asserted by the dedicated
    device-flow suite below); an UNKNOWN provider is still refused."""
    client, token = client_csrf
    user = _mk_user("h21.routeshere@example.com")
    client.force_login(user)
    response = _post(client, token, "/api/v1/assistant/subscription/start", {"provider": "nope"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unknown_provider"
    response = _post(client, token, "/api/v1/assistant/subscription/poll", {"provider": "nope"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unknown_provider"


def test_subscription_module_has_no_provider_login_call():
    """H19 fix-up 4's rule, kept in H21's and H23's world: the backend
    never POSTs an INVENTED <api_base>/oauth/* path to a provider's API
    base. The device flows live on the providers' OWN authorisation hosts:
    opencode's console (/console/auth/device/*) and codex's
    auth.openai.com (/api/accounts/deviceauth/*, its CLI's own shape).
    Static grep against the source; comments and docstrings excluded."""
    import inspect

    import accounts.assistant_subscriptions as subs

    source = inspect.getsource(subs)
    import io
    import tokenize

    executable = []
    for token_info in tokenize.generate_tokens(io.StringIO(source).readline):
        if token_info.type == tokenize.STRING:
            executable.append("")  # docstrings/strings carry no logic
        elif token_info.type == tokenize.COMMENT:
            executable.append("")
        else:
            executable.append(token_info.string)
    stripped = " ".join(executable)
    # No INVENTED /oauth/* PATH is ever a URL: strings are stripped, so
    # any hit would be an executable /oauth path construction. (The RFC
    # grant URN lives in strings only; base URLs live in ProviderSpec
    # defaults verified below.)
    assert "/oauth/" not in stripped
    # ...and the REAL endpoints are the providers' own — check the CLASS
    # defaults via _env, not the (possibly stub-overridden) attributes.
    from accounts.assistant_subscriptions import _env

    original_code = _env("ASSISTANT_OPENCODE_DEVICE_CODE_URL", "https://opencode.ai/console/auth/device/code")
    original_token = _env("ASSISTANT_OPENCODE_DEVICE_TOKEN_URL", "https://opencode.ai/console/auth/device/token")
    original_client = _env("ASSISTANT_OPENCODE_DEVICE_CLIENT_ID", "opencode-cli")
    assert original_code == "https://opencode.ai/console/auth/device/code"
    assert original_token == "https://opencode.ai/console/auth/device/token"
    assert original_client == "opencode-cli"
    # H23: codex's defaults are its CLI's OWN device endpoints — read off
    # the installed binary and confirmed live; the standard token URL is
    # reserved for REFRESH (both CLI paths end there).
    original_codex_code = _env("ASSISTANT_CODEX_DEVICE_CODE_URL", "https://auth.openai.com/api/accounts/deviceauth/usercode")
    original_codex_token = _env("ASSISTANT_CODEX_DEVICE_TOKEN_URL", "https://auth.openai.com/api/accounts/deviceauth/token")
    original_codex_client = _env("ASSISTANT_CODEX_DEVICE_CLIENT_ID", "app_EMoamEEZ73f0CkXaXp7hrann")
    assert original_codex_code == "https://auth.openai.com/api/accounts/deviceauth/usercode"
    assert original_codex_token == "https://auth.openai.com/api/accounts/deviceauth/token"
    assert original_codex_client == "app_EMoamEEZ73f0CkXaXp7hrann"


# ---------------------------------------------------------------------------
# 2. The import flow end-to-end (key shape), stored encrypted, no echo
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_import_local_key_credential_and_reset_of_the_api_key(client_csrf):
    client, token = client_csrf
    user = _mk_user("h19.import@example.com")
    # Start in api mode with a key, then link the subscription: the key must
    # be gone afterwards (exactly ONE credential per row).
    AssistantConfig.objects.create(company=default_company(), 
        user=user,
        base_url="https://api.example.com/v1",
        model="old-model",
        api_key_ciphertext=encrypt_key("«redacted:sk-…»"),
        api_key_hint=key_hint("«redacted:sk-…»"),
        api_key_set_by=user,
        is_active=True,
    )
    client.force_login(user)

    fake_store = {"opencode-go": {"key": OPENCODE_KEY, "type": "key"}}
    with mock.patch(
        "accounts.assistant_subscriptions.OPENCODE_AUTH_PATH",
        "/nonexistent/home/opencode/auth.json",
    ):
        with mock.patch("builtins.open", mock.mock_open(read_data=json.dumps(fake_store))):
            response = _post(client, token, "/api/v1/assistant/subscription/import", {"provider": "opencode"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "linked"
    assert data["mode"] == "subscription"
    assert data["subscription_provider"] == "opencode"
    assert data["subscription_cred_type"] == "key"
    assert data["subscription_source"] == "local"
    assert data["is_configured"] is True
    # No key material in the body.
    assert OPENCODE_KEY not in response.content.decode()
    assert "oc-sk-live" not in response.content.decode()

    config = AssistantConfig.objects.get(user=user)
    assert config.base_url == ""  # cleared: one credential per row
    assert config.api_key_ciphertext == b""
    blob = json.loads(decrypt_key(config.subscription_ciphertext))
    assert blob["key"] == OPENCODE_KEY
    assert config.subscription_expires is None  # the key shape does not expire


@pytest.mark.django_db
def test_import_local_oauth_credential_codex_shape(client_csrf):
    """The codex store shape: tokens{access_token, refresh_token} + an
    account id — imported as the oauth cred type with the expiry computed
    from last_refresh minus the safety margin."""
    client, token = client_csrf
    user = _mk_user("h19.import-oauth@example.com")
    client.force_login(user)
    last_refresh = (timezone.now() - datetime.timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    fake_store = {
        "auth_mode": "chatgpt",
        "last_refresh": last_refresh,
        "tokens": {
            "access_token": ACCESS_TOKEN,
            "account_id": "acct-stub-77",
            "id_token": "id-token-material",
            "refresh_token": REFRESH_TOKEN,
        },
    }
    with mock.patch(
        "accounts.assistant_subscriptions.CODEX_AUTH_PATH",
        "/nonexistent/home/codex/auth.json",
    ):
        with mock.patch("builtins.open", mock.mock_open(read_data=json.dumps(fake_store))):
            response = _post(client, token, "/api/v1/assistant/subscription/import", {"provider": "codex"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "linked"
    assert data["subscription_provider"] == "codex"
    assert data["subscription_cred_type"] == "oauth"
    assert data["subscription_source"] == "local"
    assert ACCESS_TOKEN not in response.content.decode()
    assert REFRESH_TOKEN not in response.content.decode()

    config = AssistantConfig.objects.get(user=user)
    blob = json.loads(decrypt_key(config.subscription_ciphertext))
    assert blob["access"] == ACCESS_TOKEN
    assert blob["refresh"] == REFRESH_TOKEN
    assert blob["group_id"] == "acct-stub-77"
    # ~22 days of runway from a last_refresh one day ago.
    assert config.subscription_expires > timezone.now() + datetime.timedelta(days=20)


@pytest.mark.django_db
def test_import_without_a_local_login_is_a_clear_409(client_csrf):
    client, token = client_csrf
    user = _mk_user("h19.noimport@example.com")
    client.force_login(user)
    with mock.patch(
        "accounts.assistant_subscriptions.OPENCODE_AUTH_PATH",
        "/nonexistent/path/auth.json",
    ):
        response = _post(client, token, "/api/v1/assistant/subscription/import", {"provider": "opencode"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_local_login"


# ---------------------------------------------------------------------------
# 3. The linked subscription DRIVES the provider calls — and never POSTs
#    /oauth/* beyond the one legitimate token-refresh URL
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_subscription_test_and_chat_use_the_session_header_and_bearer(stub_server, client_csrf):
    client, token = client_csrf
    user = _mk_user("h19.drive@example.com")
    client.force_login(user)

    fake_store = {"opencode-go": {"key": OPENCODE_KEY, "type": "key"}}
    with mock.patch(
        "accounts.assistant_subscriptions.OPENCODE_AUTH_PATH",
        "/nonexistent/home/opencode/auth.json",
    ):
        with mock.patch("builtins.open", mock.mock_open(read_data=json.dumps(fake_store))):
            linked = _post(client, token, "/api/v1/assistant/subscription/import", {"provider": "opencode"})
    assert linked.json()["data"]["status"] == "linked"

    config = AssistantConfig.objects.get(user=user)
    config.model = "glm-5.3-flash"  # the user pulled it from the model list
    config.save(update_fields=["model"])

    _STATE["chat_calls"] = []
    tested = _post(client, token, "/api/v1/assistant/test", {})
    assert tested.status_code == 200
    assert tested.json()["data"]["ok"] is True
    [_call] = _STATE["chat_calls"]
    assert _call["auth"] == f"Bearer {OPENCODE_KEY}"
    assert _call["session"]  # the gateway's REQUIRED session header


@pytest.mark.django_db
def test_no_response_body_contains_the_token(stub_server, client_csrf):
    """The recurring rule: run EVERY subscription surface and assert the
    token material never appears in any response body."""
    client, token = client_csrf
    user = _mk_user("h19.no-echo@example.com")
    client.force_login(user)

    last_refresh = timezone.now().strftime("%Y-%m-%dT%H:%M:%S+00:00")
    fake_store = {
        "auth_mode": "chatgpt",
        "last_refresh": last_refresh,
        "tokens": {
            "access_token": ACCESS_TOKEN,
            "account_id": "acct-noecho",
            "refresh_token": REFRESH_TOKEN,
        },
    }
    with mock.patch(
        "accounts.assistant_subscriptions.CODEX_AUTH_PATH",
        "/nonexistent/home/codex/auth.json",
    ):
        with mock.patch("builtins.open", mock.mock_open(read_data=json.dumps(fake_store))):
            linked = _post(client, token, "/api/v1/assistant/subscription/import", {"provider": "codex"})
    assert linked.json()["data"]["status"] == "linked"

    surfaces = (
        ("/api/v1/assistant/config", None, "GET"),
        ("/api/v1/assistant/test", {}, "POST"),
    )
    for path, body, method in surfaces:
        response = _get_or_post(client, token, path, body, method)
        text = response.content.decode()
        assert ACCESS_TOKEN not in text, path
        assert REFRESH_TOKEN not in text, path
        assert NEW_ACCESS_TOKEN not in text, path


def _get_or_post(client, token, path, body, method):
    if method == "GET":
        return client.get(path)
    return _post(client, token, path, body)


# ---------------------------------------------------------------------------
# 4. oauth refresh + failed-refresh unmarking
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_expired_oauth_is_refreshed_once_before_the_call(stub_server, client_csrf):
    client, token = client_csrf
    user = _mk_user("h19.refresh@example.com")
    AssistantConfig.objects.create(company=default_company(), 
        user=user,
        model="glm-5.3-flash",
        subscription_provider="opencode",
        subscription_cred_type="oauth",
        subscription_source="local",
        subscription_hint="••••ZQ9",
        subscription_ciphertext=encrypt_key(json.dumps({"access": ACCESS_TOKEN, "refresh": REFRESH_TOKEN})),
        subscription_expires=timezone.now() - datetime.timedelta(seconds=30),  # JUST expired
        is_active=True,
    )
    client.force_login(user)

    before = _STATE["refresh_calls"]
    _STATE["posted_paths"] = []
    _STATE["chat_calls"] = []
    tested = _post(client, token, "/api/v1/assistant/test", {})
    assert tested.status_code == 200
    assert tested.json()["data"]["ok"] is True
    assert _STATE["refresh_calls"] == before + 1  # exactly ONE refresh POST
    # The only POSTs to the provider host are the token refresh and the
    # chat probe — never an invented /oauth/device/start authoriser path.
    # (In H21's world an opencode oauth credential refreshes at the
    # provider's console device-token endpoint — exactly what its CLI's
    # plugin does — while the legacy local-import path still hits
    # /oauth/token; both are legitimate.)
    assert _STATE["posted_paths"], "the probe should have POSTed to the stub"
    refresh_paths = [path for path in _STATE["posted_paths"] if path.endswith("token")]
    assert refresh_paths, _STATE["posted_paths"]
    assert all(
        (path.endswith("/oauth/token") or path.endswith("/console/auth/device/token"))
        for path in refresh_paths
    ), _STATE["posted_paths"]

    config = AssistantConfig.objects.get(user=user)
    blob = json.loads(decrypt_key(config.subscription_ciphertext))
    assert blob["access"] == NEW_ACCESS_TOKEN
    assert config.subscription_expires > timezone.now()

    # And the PROBE actually used the rotated token.
    [_call] = _STATE["chat_calls"]
    assert _call["auth"] == f"Bearer {NEW_ACCESS_TOKEN}"


@pytest.mark.django_db
def test_failed_refresh_unlinks_and_audits_never_a_silent_dead_button(stub_server, client_csrf):
    client, token = client_csrf
    user = _mk_user("h19.unlink@example.com")
    AssistantConfig.objects.create(company=default_company(), 
        user=user,
        model="glm-5.3-flash",
        subscription_provider="opencode",
        subscription_cred_type="oauth",
        subscription_source="local",
        subscription_hint="••••ZQ9",
        subscription_ciphertext=encrypt_key(json.dumps({"access": ACCESS_TOKEN, "refresh": REFRESH_TOKEN})),
        subscription_expires=timezone.now() - datetime.timedelta(seconds=30),
        is_active=True,
    )
    client.force_login(user)

    _STATE["refresh_should_fail"] = True
    tested = _post(client, token, "/api/v1/assistant/test", {})
    # The row unlinked BEFORE the probe: the answer is the not_configured
    # 409 the launcher already fades on — never a silent dead button.
    assert tested.status_code == 409
    assert tested.json()["error"]["code"] == "not_configured"
    _STATE["refresh_should_fail"] = False

    config = AssistantConfig.objects.get(user=user)
    assert config.subscription_provider == ""
    assert config.subscription_ciphertext == b""
    assert config.is_active is False
    event = AuditEvent.objects.filter(
        action="assistant.subscription_expired", subject=user
    ).first()
    assert event is not None
    # Audit text: booleans only, never token material.
    event_text = json.dumps(event.before) + json.dumps(event.after)
    assert ACCESS_TOKEN not in event_text
    assert REFRESH_TOKEN not in event_text


# ---------------------------------------------------------------------------
# 5. Model listing (the user picks one); no listing endpoint -> honest "no"
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_models_listing_lists_what_the_subscription_offers(stub_server, client_csrf):
    client, token = client_csrf
    user = _mk_user("h19.models@example.com")
    AssistantConfig.objects.create(company=default_company(), 
        user=user,
        model="glm-5.3-flash",
        subscription_provider="opencode",
        subscription_cred_type="key",
        subscription_source="local",
        subscription_hint="••••88",
        subscription_ciphertext=encrypt_key(json.dumps({"key": OPENCODE_KEY, "type": "key"})),
        is_active=True,
    )
    client.force_login(user)
    response = client.get("/api/v1/assistant/subscription/models")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["supported"] is True
    assert data["models"] == ["glm-5.3-flash", "claude-sonnet-4"]


@pytest.mark.django_db
def test_models_for_codex_say_no_listing_endpoint_honestly(client_csrf):
    client, token = client_csrf
    user = _mk_user("h19.codex.models@example.com")
    AssistantConfig.objects.create(company=default_company(), 
        user=user,
        model="gpt-5.1",
        subscription_provider="codex",
        subscription_cred_type="oauth",
        subscription_source="local",
        subscription_hint="••••ZZ9",
        subscription_ciphertext=encrypt_key(json.dumps({"access": ACCESS_TOKEN, "refresh": REFRESH_TOKEN})),
        subscription_expires=timezone.now() + datetime.timedelta(hours=2),
        is_active=True,
    )
    client.force_login(user)
    response = client.get("/api/v1/assistant/subscription/models")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["supported"] is False
    assert data["models"] == []
    assert "no model-listing endpoint" in data["detail"]


# ---------------------------------------------------------------------------
# 6. The API-mode PUT clears a previous subscription (one credential per row)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_switching_back_to_api_mode_clears_the_subscription(client_csrf):
    client, token = client_csrf
    user = _mk_user("h19.back@example.com")
    AssistantConfig.objects.create(company=default_company(), 
        user=user,
        model="glm-5.3-flash",
        subscription_provider="opencode",
        subscription_cred_type="key",
        subscription_source="local",
        subscription_hint="••••88",
        subscription_ciphertext=encrypt_key(json.dumps({"key": "k", "type": "key"})),
        is_active=True,
    )
    client.force_login(user)
    response = _put(
        client,
        token,
        "/api/v1/assistant/config",
        {"base_url": "https://api.example.com/v1", "model": "g-model", "api_key": "sk-fresh"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["mode"] == "api"
    assert data["subscription_provider"] == ""
    config = AssistantConfig.objects.get(user=user)
    assert bytes(config.api_key_ciphertext) != b""
    assert config.subscription_ciphertext == b""


@pytest.mark.django_db
def test_unknown_provider_is_a_422(client_csrf):
    client, token = client_csrf
    user = _mk_user("h19.unknown@example.com")
    client.force_login(user)
    response = _post(client, token, "/api/v1/assistant/subscription/import", {"provider": "openai-bonus"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unknown_provider"


# ---------------------------------------------------------------------------
# H25: the import (and EVERY provider call in the subscription path) is
# bounded — a slow or never-answering provider gets a clear, actionable
# error INSIDE the ceiling, never a hung request thread (the live repro:
# import -> curl HTTP 000 at 60 s).
# ---------------------------------------------------------------------------


def _stall(seconds: float):
    """A urlopen stand-in that blocks past any sane request deadline —
    the shape of a wedged DNS resolver or a provider that never answers."""

    def _stall_urlopen(request, timeout=None):  # noqa: ARG001 - signature match
        import time as _time

        _time.sleep(seconds)
        raise TimeoutError("stall elapsed")  # unreachable in practice

    return _stall_urlopen


@pytest.mark.django_db
def test_import_answers_within_the_ceiling_against_a_silent_provider(client_csrf):
    """H25: with the import work wedged (whatever the stall is — a wedged
    CLI-store read or a provider call inside the work), the endpoint must
    STILL answer a real, clear error inside the ceiling — never HTTP 000."""
    client, token = client_csrf
    user = _mk_user("h25.silent@example.com")
    client.force_login(user)

    def _wedged_import(_slug):
        _time_sleep = time.sleep
        _time_sleep(5)  # well past the ceiling: cannot be waited out
        raise TimeoutError("stall elapsed")  # unreachable in practice

    with mock.patch.object(assistant_views, "IMPORT_WORK_CEILING_SECONDS", 1):
        with mock.patch("accounts.assistant_views.import_local", side_effect=_wedged_import):
            started = time.monotonic()
            response = _post(client, token, "/api/v1/assistant/subscription/import", {"provider": "codex"})
    elapsed = time.monotonic() - started

    # The endpoint ANSWERED: a real status, an actionable code, nothing hung.
    assert response.status_code == 502
    payload = response.json()
    assert payload["error"]["code"] == "codex_import_failed"
    assert payload["error"]["message"].strip() != ""
    # The answer came back INSIDE the ceiling (the join is the bound).
    assert elapsed < 4, f"import took {elapsed:.1f}s — the ceiling did not hold"
    # No credential was stored on a failed import (and no row was created
    # either: the wedge fired before any DB write).
    assert not AssistantConfig.objects.filter(user=user).exists()


@pytest.mark.django_db
def test_the_slow_refresh_concrete_case_errors_inside_the_ceiling(stub_server, client_csrf):
    """H25's exact live shape: an EXPIRED codex credential triggers the
    refresh; if the OpenAI token endpoint never answers, the test button
    gets a clear error inside the ceiling instead of blocking its thread."""
    client, token = client_csrf
    user = _mk_user("h25.codex.slow-refresh@example.com")
    AssistantConfig.objects.create(company=default_company(), 
        user=user,
        model="gpt-5.6-luna",
        subscription_provider="codex",
        subscription_cred_type="oauth",
        subscription_source="local",
        subscription_hint="••••H25",
        subscription_ciphertext=encrypt_key(json.dumps({
            "access": ACCESS_TOKEN,
            "refresh": REFRESH_TOKEN,
            "group_id": "acct-stub-77",
        })),
        subscription_expires=timezone.now() - datetime.timedelta(seconds=30),  # JUST expired
        is_active=True,
    )
    client.force_login(user)

    with mock.patch.object(assistant_subscriptions, "IMPORT_CEILING_SECONDS", 1):
        with mock.patch(
            "accounts.assistant_subscriptions.urllib.request.urlopen",
            side_effect=_stall(5),
        ):
            started = time.monotonic()
            response = _post(client, token, "/api/v1/assistant/test", {})
    elapsed = time.monotonic() - started

    assert response.status_code == 409
    payload = response.json()
    assert payload["error"]["code"] == "not_configured"
    assert payload["error"]["message"].strip() != ""
    assert elapsed < 4, f"test took {elapsed:.1f}s — the ceiling did not hold"


def test_every_provider_call_in_the_subscription_path_has_an_explicit_timeout():
    """H25 statically: every _http_json CALL SITE passes timeout= — no
    unbounded wait exists anywhere in the subscription path."""
    import inspect as _inspect

    source = _inspect.getsource(assistant_subscriptions)
    offending = [
        line.strip()
        for line in source.splitlines()
        if "_http_json(" in line
        and "def _http_json" not in line
        and "timeout=" not in line
    ]
    assert offending == [], f"unbounded _http_json call sites: {offending}"


# ---------------------------------------------------------------------------
# H21: the REAL in-app device flow (start → pending poll → approved poll →
# encrypted store → the probe WORKS through the new credential).
# ---------------------------------------------------------------------------


def _device_start(client, token):
    return _post(client, token, "/api/v1/assistant/subscription/start", {"provider": "opencode"})


def _device_poll(client, token):
    return _post(client, token, "/api/v1/assistant/subscription/poll", {"provider": "opencode"})


def _device_poll_empty(client, token):
    """H22's shape: the panel's poll body carries no provider at all."""
    return _post(client, token, "/api/v1/assistant/subscription/poll", {})


@pytest.mark.django_db
def test_device_flow_start_returns_code_and_url_and_parks_device_code(stub_server, client_csrf):
    client, token = client_csrf
    user = _mk_user("h21.start@example.com")
    client.force_login(user)
    response = _device_start(client, token)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["provider"] == "opencode"
    assert data["user_code"] == "STUB-CODE"
    assert data["verification_uri"].endswith("/console/device?user_code=STUB-CODE&client_id=opencode-cli")
    assert data["verification_uri"].startswith("http")
    assert data["interval"] == 5
    assert data["expires_in"] == 600
    # The start body the backend SENT is the CLI's own shape.
    assert _STATE["last_device_start_body"] == {"client_id": "opencode-cli", "supports_org_scope": True}
    # The device_code itself NEVER reaches the response: grep the body.
    assert "stub-device-" not in response.content.decode()


@pytest.mark.django_db
def test_device_flow_pending_poll_is_200_and_never_a_token(stub_server, client_csrf):
    client, token = client_csrf
    user = _mk_user("h21.pending@example.com")
    client.force_login(user)
    assert _device_start(client, token).status_code == 200
    response = _device_poll_empty(client, token)
    assert response.status_code == 200
    # An explicit provider that MATCHES the pending flow stays clean:
    # nothing added to the pending answer (the contradict case adds the
    # provider_note, asserted in the H22 block below).
    assert response.json()["data"] == {"status": "pending"}
    # The poll body the backend SENT is the CLI's own shape.
    assert _STATE["last_device_poll_body"] == {
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        "device_code": mock.ANY,
        "client_id": "opencode-cli",
    }
    assert DEVICE_ACCESS_TOKEN not in response.content.decode()


@pytest.mark.django_db
def test_device_flow_slow_down_and_expiry_are_honest(stub_server, client_csrf):
    client, token = client_csrf
    user = _mk_user("h21.slow@example.com")
    client.force_login(user)
    assert _device_start(client, token).status_code == 200
    _STATE["device_slow_down_next"] = True
    response = _device_poll(client, token)
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "pending"
    _STATE["device_expire_next"] = True
    response = _device_poll(client, token)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "flow_expired"
    # The expired flow was cleaned: a further poll names the situation —
    # H22's no_pending_flow wording (H21 originally said no_active_flow).
    response = _device_poll(client, token)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_pending_flow"


@pytest.mark.django_db
def test_device_flow_success_stores_encrypted_and_the_test_probe_works(stub_server, client_csrf):
    client, token = client_csrf
    user = _mk_user("h21.success@example.com")
    client.force_login(user)
    linked = _device_start(client, token)
    assert linked.status_code == 200
    _STATE["device_approve_next"] = True  # the stub "browser approval"
    response = _device_poll(client, token)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "linked"
    assert data["subscription_provider"] == "opencode"
    assert data["subscription_cred_type"] == "oauth"
    assert data["subscription_source"] == "device"
    assert data["is_configured"] is True
    # No token material anywhere in the body.
    body = response.content.decode()
    assert DEVICE_ACCESS_TOKEN not in body
    assert DEVICE_REFRESH_TOKEN not in body
    assert "device.access" not in body

    config = AssistantConfig.objects.get(user=user)
    assert config.subscription_provider == "opencode"
    assert config.subscription_source == "device"
    assert config.subscription_hint  # masked, present
    assert DEVICE_ACCESS_TOKEN not in (config.subscription_hint or "")
    blob = json.loads(decrypt_key(config.subscription_ciphertext))
    assert blob["access"] == DEVICE_ACCESS_TOKEN
    assert blob["refresh"] == DEVICE_REFRESH_TOKEN
    assert blob["group_id"] == "org-stub-41"
    assert config.subscription_expires is not None
    assert config.is_active is True
    assert config.model == "glm-5.3-flash"  # the provider's default preselected

    # The stored credential DRIVES the real test probe.
    _STATE["chat_calls"] = []
    tested = _post(client, token, "/api/v1/assistant/test", {})
    assert tested.status_code == 200
    assert tested.json()["data"]["ok"] is True
    [_call] = _STATE["chat_calls"]
    assert _call["auth"] == f"Bearer {DEVICE_ACCESS_TOKEN}"
    assert _call["session"]  # the gateway's REQUIRED session header


# ---------------------------------------------------------------------------
# H22: the poll may arrive with an EMPTY body — the flow the server started
# for this user is authoritative. The provider the body names never starts
# or abandons a flow behind the caller's back.
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_poll_empty_body_continues_the_pending_flow(stub_server, client_csrf):
    """The panel's poll with no provider at all must poll the SAME flow the
    start created for this user — pending, the right client_id, no error."""
    client, token = client_csrf
    user = _mk_user("h22.empty-poll@example.com")
    client.force_login(user)
    assert _device_start(client, token).status_code == 200
    response = _post(client, token, "/api/v1/assistant/subscription/poll", {})
    assert response.status_code == 200, response.content.decode()
    assert response.json()["data"] == {"status": "pending"}
    # The poll the backend SENT is still the pending flow's own shape.
    assert _STATE["last_device_poll_body"]["client_id"] == "opencode-cli"
    assert isinstance(_STATE["last_device_poll_body"]["device_code"], str)


@pytest.mark.django_db
def test_poll_empty_body_without_a_pending_flow_is_actionable(client_csrf):
    """No flow ever started: the answer names the situation and the button
    that fixes it — never a misleading unknown_provider."""
    client, token = client_csrf
    user = _mk_user("h22.no-pending@example.com")
    client.force_login(user)
    response = _post(client, token, "/api/v1/assistant/subscription/poll", {})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_pending_flow"
    assert response.json()["error"]["message"].strip() != ""


@pytest.mark.django_db
def test_poll_after_the_flow_expires_is_actionable(stub_server, client_csrf):
    """The window closed without approval: the FIRST empty-body poll after
    the expiry says the flow expired, and once the expired entry is cleaned
    the next one says there is no pending flow — both with a real next step,
    never unknown_provider."""
    from accounts.models import PendingDeviceFlow

    client, token = client_csrf
    user = _mk_user("h22.expired-poll@example.com")
    client.force_login(user)
    assert _device_start(client, token).status_code == 200
    row = PendingDeviceFlow.objects.get(user=user)
    row.expires_at -= datetime.timedelta(hours=1)
    row.save(update_fields=["expires_at", "updated_at"])
    response = _post(client, token, "/api/v1/assistant/subscription/poll", {})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "flow_expired"
    response = _post(client, token, "/api/v1/assistant/subscription/poll", {})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_pending_flow"
    # H28: the expired row was deleted, not left behind.
    assert not PendingDeviceFlow.objects.filter(user=user).exists()
    assert response.json()["error"]["message"].strip() != ""


@pytest.mark.django_db
def test_pending_flow_survives_a_server_restart(stub_server, client_csrf):
    """H28 — the actual reported failure: a flow started, then the dev
    server restarted (process memory wiped), then the poll. With the flow
    persisted in the DB the poll still drives the SAME provider turn
    (status pending), never the 409 no_pending_flow that killed the
    owner's mid-flight approvals. The cache is explicitly FLUSHED here to
    prove the answer no longer depends on process memory at all."""
    from django.core.cache import cache

    client, token = client_csrf
    user = _mk_user("h28.restart@example.com")
    client.force_login(user)
    assert _device_start(client, token).status_code == 200
    # The simulated restart: wipe EVERYTHING in process memory.
    cache.clear()
    response = _device_poll_empty(client, token)
    assert response.status_code == 200, response.content.decode()
    assert response.json()["data"]["status"] == "pending"
    # And the started flow's own secret still travels to the provider.
    assert _STATE["last_device_poll_body"]["device_code"] == mock.ANY


@pytest.mark.django_db
def test_poll_body_provider_contradicting_the_pending_flow_prefers_the_pending_flow(stub_server, client_csrf):
    """An explicit provider that contradicts the pending flow must not
    silently start or abandon anything: the pending flow continues and the
    response says the body's word was overridden."""
    client, token = client_csrf
    user = _mk_user("h22.contradict@example.com")
    client.force_login(user)
    assert _device_start(client, token).status_code == 200  # opencode flow
    response = _post(client, token, "/api/v1/assistant/subscription/poll", {"provider": "codex"})
    assert response.status_code == 200, response.content.decode()
    data = response.json()["data"]
    assert data["status"] == "pending"
    assert data["provider"] == "opencode"
    # H23 (bey): the overridden Word travels in provider_note — its VALUE
    # is the flow the body tried to override coded away; the SENT poll
    # body below proves the pending flow was the one actually polled.
    assert data["provider_note"] == "opencode"
    assert "codex" not in json.dumps(data)
    # The codex provider was never contacted: no device-token poll for it.
    assert _STATE["last_device_poll_body"]["client_id"] == "opencode-cli"


@pytest.mark.django_db
def test_poll_body_provider_matching_the_pending_flow_stays_clean(stub_server, client_csrf):
    """The matching explicit provider changes nothing: no note keys, the
    same pending answer the SPA has been wiring all along."""
    client, token = client_csrf
    user = _mk_user("h22.match@example.com")
    client.force_login(user)
    assert _device_start(client, token).status_code == 200
    response = _device_poll(client, token)
    assert response.status_code == 200
    assert response.json()["data"] == {"status": "pending"}


@pytest.mark.django_db
def test_poll_is_bound_to_the_user_who_started_the_flow(stub_server, client_csrf):
    """Auth stays per-user: another account's empty-body poll sees none of
    the owner's pending flow, and approving the owner's code never links
    the other account."""
    client, token = client_csrf
    owner = _mk_user("h22.owner@example.com")
    client.force_login(owner)
    assert _device_start(client, token).status_code == 200
    # A different account polls with an empty body: nothing is pending FOR IT.
    other = _mk_user("h22.other@example.com")
    client.force_login(other)
    csrf_token = token  # same session's CSRF cookie still validates
    response = _post(client, csrf_token, "/api/v1/assistant/subscription/poll", {})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_pending_flow"
    # The owner approves; only the owner's poll links anything.
    client.force_login(owner)
    _STATE["device_approve_next"] = True
    response = _device_poll(client, token)
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "linked"
    assert AssistantConfig.objects.get(user=owner).subscription_source == "device"
    # The "other" account ends pured: no row auto-created carries anything —
    # the poll that 409'd never writes a configuration of anyone else's.
    assert not AssistantConfig.objects.filter(user=other).exists()


@pytest.mark.django_db
def test_poll_unknown_provider_slug_stays_a_422(client_csrf):
    """No regression on the honest unknown-slug refusal, empty flow or not."""
    client, token = client_csrf
    user = _mk_user("h22.unknown@example.com")
    client.force_login(user)
    response = _post(client, token, "/api/v1/assistant/subscription/poll", {"provider": "nope"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unknown_provider"
    # Still the same refusal with a pending flow around.
    client.force_login(user)
    response = _post(client, token, "/api/v1/assistant/subscription/start", {"provider": "nope"})
    assert response.status_code == 422


@pytest.mark.django_db
def test_device_flow_credential_expires_and_refreshes_at_the_console_url(stub_server, client_csrf):
    """A device-sourced oauth credential refreshes the plugin's way: the
    SAME console device-token endpoint with grant_type=refresh_token —
    never the zen /oauth/token URL the fix-up-4 world invented."""
    client, token = client_csrf
    user = _mk_user("h21.refresh@example.com")
    AssistantConfig.objects.create(company=default_company(), 
        user=user,
        model="glm-5.3-flash",
        subscription_provider="opencode",
        subscription_cred_type="oauth",
        subscription_source="device",
        subscription_hint="••••41",
        subscription_ciphertext=encrypt_key(json.dumps({
            "access": DEVICE_ACCESS_TOKEN,
            "refresh": DEVICE_REFRESH_TOKEN,
            "group_id": "org-stub-41",
        })),
        subscription_expires=timezone.now() - datetime.timedelta(seconds=30),  # JUST expired
        is_active=True,
    )
    client.force_login(user)
    before = _STATE["refresh_calls"]
    _STATE["posted_paths"] = []
    _STATE["chat_calls"] = []
    tested = _post(client, token, "/api/v1/assistant/test", {})
    assert tested.status_code == 200
    assert tested.json()["data"]["ok"] is True
    assert _STATE["refresh_calls"] == before + 1
    # ONLY the console refresh URL and the chat probe were POSTed.
    assert all(
        path.endswith("/console/auth/device/token") or path.endswith("/chat/completions")
        for path in _STATE["posted_paths"]
    ), _STATE["posted_paths"]
    config = AssistantConfig.objects.get(user=user)
    blob = json.loads(decrypt_key(config.subscription_ciphertext))
    assert blob["access"] == NEW_ACCESS_TOKEN
    [_call] = _STATE["chat_calls"]
    assert _call["auth"] == f"Bearer {NEW_ACCESS_TOKEN}"


# ---------------------------------------------------------------------------
# H26: the codex chat path — the Responses SSE parser must NOT lose output
# when the gateway moves/repeats it differently per turn, and the chat must
# NEVER return a blank bubble.
# ---------------------------------------------------------------------------


def _sse_events(*payloads: dict) -> list:
    """A synthetic SSE stream built from event payloads as raw byte lines."""
    out = []
    for payload in payloads:
        out.append(f"event: {payload.get('type')}\ndata: {json.dumps(payload)}\n\n")
    stream_text = "".join(out)
    return [line.encode("utf-8") for line in stream_text.splitlines(keepends=True)]


@pytest.mark.django_db
def test_codex_parser_uses_output_item_done_when_completed_output_is_empty():
    """THE H26 reproduction (measured live): the gateway sometimes answers a
    function-calling turn whose response.completed carries ``output: []``
    while response.output_item.done delivered the complete item. The old
    parser answered {content: None, no tool_calls} — a blank chat bubble."""
    from accounts.assistant_subscriptions import parse_responses_sse

    stream = _sse_events(
        {"type": "response.created", "response": {"id": "resp_1", "output": []}},
        {"type": "response.in_progress", "response": {"id": "resp_1", "output": []}},
        {"type": "response.output_item.added", "item": {"id": "rs_1", "type": "reasoning", "summary": []}},
        {"type": "response.output_item.done", "item": {"id": "rs_1", "type": "reasoning", "summary": []}},
        {
            "type": "response.output_item.added",
            "item": {"id": "fc_1", "type": "function_call", "status": "in_progress",
                     "arguments": "", "call_id": "call_A1", "name": "read_request_types"},
        },
        {"type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": "{}"},
        {"type": "response.function_call_arguments.done", "item_id": "fc_1", "arguments": "{}"},
        {
            "type": "response.output_item.done",
            "item": {"id": "fc_1", "type": "function_call", "status": "completed",
                     "arguments": "{}", "call_id": "call_A1", "name": "read_request_types"},
        },
        # THE failing shape: the terminal event repeats NOTHING.
        {"type": "response.completed", "response": {"id": "resp_1", "status": "completed", "output": []}},
    )
    message = parse_responses_sse(iter(stream), "gpt-5.6-luna")
    assert (message.get("tool_calls") or []), "the function_call must survive an empty completed.output"
    [call] = message["tool_calls"]
    assert call["type"] == "function"
    assert call["function"]["name"] == "read_request_types"
    assert call["function"]["arguments"] == "{}"
    assert call["id"] == "call_A1"
    assert message.get("content") is None


@pytest.mark.django_db
def test_codex_parser_completed_output_fallback_and_text_done_event():
    """The OTHER terminal shapes: (a) everything folded into the completed
    event (the non-streaming shape) still parses; (b) a whole text in
    response.output_text.done with NO deltas is used once — and deltas win
    (no duplication, the H18 invariant)."""
    from accounts.assistant_subscriptions import parse_responses_sse

    # (a) non-streaming shape: completed carries the full message.
    completed_only = _sse_events({
        "type": "response.completed",
        "response": {
            "id": "resp_2", "status": "completed",
            "output": [{
                "type": "message", "role": "assistant",
                "content": [{"type": "output_text", "text": "أهلًا، تم."}],
            }],
        },
    })
    message = parse_responses_sse(iter(completed_only), "gpt-5.6-luna")
    assert message["content"] == "أهلًا، تم."

    # (b) whole text via output_text.done, no deltas at all.
    done_only = _sse_events(
        {"type": "response.output_text.done", "text": "نص كامل_Word"},
    )
    message = parse_responses_sse(iter(done_only), "gpt-5.6-luna")
    assert message["content"] == "نص كامل_Word"

    # (c) deltas stream AND done/completed repeat the whole text: the
    # deltas ONLY (no duplication).
    both = _sse_events(
        {"type": "response.output_text.delta", "delta": "مرحبا "},
        {"type": "response.output_text.delta", "delta": "بك"},
        {"type": "response.output_text.done", "text": "مرحبا بك"},
        {"type": "response.completed", "response": {"id": "x", "status": "completed", "output": []}},
    )
    message = parse_responses_sse(iter(both), "gpt-5.6-luna")
    assert message["content"] == "مرحبا بك"


@pytest.mark.django_db
def test_codex_parser_terminal_failure_is_an_honest_error_never_silence():
    """A response.failed stream raises the provider's own error text
    (scrubbed) instead of silently parsing into an empty reply."""
    from accounts.assistant_provider import ProviderResponseError
    from accounts.assistant_subscriptions import parse_responses_sse

    stream = _sse_events(
        {"type": "response.created", "response": {"id": "r", "output": []}},
        {
            "type": "response.failed",
            "response": {
                "id": "r", "status": "failed",
                "error": {"code": "server_error", "message": "the model is overloaded"},
            },
        },
    )
    with pytest.raises(ProviderResponseError) as excinfo:
        parse_responses_sse(iter(stream), "gpt-5.6-luna")
    assert "response.failed" in excinfo.value.detail
    assert "the model is overloaded" in excinfo.value.detail
    # An incomplete turn carries its own honest wording.
    incomplete = _sse_events(
        {"type": "response.incomplete", "response": {"id": "r", "status": "incomplete",
         "incomplete_details": {"reason": "max_output_tokens"}, "output": []}},
    )
    with pytest.raises(ProviderResponseError) as excinfo:
        parse_responses_sse(iter(incomplete), "gpt-5.6-luna")
    assert "max_output_tokens" in excinfo.value.detail


@pytest.mark.django_db
def test_codex_chat_never_returns_a_blank_bubble(client_csrf):
    """End to end: link codex, then chat over a stream that parses EMPTY —
    the endpoint must answer 409 provider_error with an actionable message,
    never a 200 with reply=""."
    """
    from unittest import mock as _mock

    from accounts.assistant_chat import ChatConfigError, assistant_chat

    client, token = client_csrf
    user = _mk_user("h26.blank@example.com")
    client.force_login(user)
    fake_store = {
        "auth_mode": "chatgpt",
        "tokens": {"access_token": ACCESS_TOKEN, "account_id": "acct-h26", "refresh_token": REFRESH_TOKEN},
    }
    with _mock.patch(
        "accounts.assistant_subscriptions.CODEX_AUTH_PATH",
        "/nonexistent/home/codex/auth.json",
    ):
        with _mock.patch("builtins.open", _mock.mock_open(read_data=json.dumps(fake_store))):
            linked = _post(client, token, "/api/v1/assistant/subscription/import", {"provider": "codex"})
    assert linked.json()["data"]["status"] == "linked"

    # The fake credential has no expiry inside it — push the row's window
    # out so the chat does NOT attempt a (real) token refresh here.
    config = AssistantConfig.objects.get(user=user)
    config.subscription_expires = timezone.now() + datetime.timedelta(days=20)
    config.save(update_fields=["subscription_expires", "updated_at"])

    with _mock.patch(
        "accounts.assistant_subscriptions.post_responses_stream",
        return_value={"role": "assistant", "content": None},
    ):
        response = _post(client, token, "/api/v1/assistant/chat", {
            "messages": [{"role": "user", "content": "عايز آخد يوم إجازة اعتيادي بكرة"}],
        })
    assert response.status_code == 409
    payload = response.json()["error"]
    assert payload["code"] == "provider_error"
    detail = json.dumps(payload, ensure_ascii=False)
    assert "codex" in detail and "gpt-5.6-luna" in detail
    assert ACCESS_TOKEN not in response.content.decode()

    # The guard sits at the loop level too: no chat answer is EVER empty.
    config = AssistantConfig.objects.get(user=user)
    with _mock.patch(
        "accounts.assistant_subscriptions.post_responses_stream",
        return_value={"role": "assistant", "content": None},
    ):
        with pytest.raises(ChatConfigError) as excinfo:
            assistant_chat(user, config, [{"role": "user", "content": "hello"}])
    assert "codex" in excinfo.value.message and "gpt-5.6-luna" in excinfo.value.message
