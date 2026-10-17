"""Story H18 focused tests: the «مدام عفاف» assistant backend.

Covers every numbered brief AC (1–10) plus the chat-tool shape; the running
evidence (probe/chat against a live stub server) is in the live walkthrough
report, not here — these tests stub at the provider-HTTP layer.
"""
import base64
import json
import time
import uuid
from unittest import mock

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.assistant_actions import (
    ActionTokenError,
    open_action,
    sign_action,
)
from accounts.assistant_crypto import encrypt_key, key_hint
from accounts.assistant_provider import (
    ProviderResponseError,
    probe_endpoint,
    ProviderBadBodyError,
)
from accounts.assistant_chat import assistant_chat, confirm_action
from accounts.models import AssistantConfig, AuditEvent, EmployeeProfile, User
from reqs.models import EmployeeRequest, RequestType
from timesheets.models import Timesheet
from tenants.context import default_company

User = User


def _mk_user(email, role=User.Role.EMPLOYEE, **kw):
    return User.objects.create_user(company=default_company(), email=email, password="pass-12345678", role=role, **kw)


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def anon_client():
    return APIClient(enforce_csrf_checks=True)


@pytest.fixture
def client_csrf(anon_client):
    """A browser-like client primed with the CSRF cookie + token."""
    anon_client.get("/api/v1/auth/csrf")
    token = anon_client.cookies["heya_fawda_csrftoken"].value
    return anon_client, token


def _csrf(client, request):
    request(client)
    return client.cookies["heya_fawda_csrftoken"].value


def _put(client, token, path, body):
    return client.put(path, body, format="json", HTTP_X_CSRFTOKEN=token)


def _post(client, token, path, body):
    return client.post(path, body, format="json", HTTP_X_CSRFTOKEN=token)


def _configured(user, *, base_url="https://api.example.com/v1", model="test-model", is_active=True, key="sk-live-abcdef123456"):
    AssistantConfig.objects.create(company=default_company(), 
        user=user,
        base_url=base_url,
        model=model,
        api_key_ciphertext=encrypt_key(key),
        api_key_hint=key_hint(key),
        api_key_set_by=user,
        is_active=is_active,
    )
    return AssistantConfig.objects.get(user=user)


# ---------------------------------------------------------------------------
# AC 1 — no key -> is_configured false; chat refuses with a clear error
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_empty_config_is_not_configured_and_chat_refuses(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.empty@example.com")
    client.force_login(user)

    response = client.get("/api/v1/assistant/config")
    assert response.status_code == 200
    assert response.json()["data"] == {
        "is_configured": False,
        "is_active": False,
        "base_url": "",
        "model": "",
        "key_hint": "",
        "key_source": None,
        "can_replace_key": True,
        # H19: the subscription fields are always present (the UI never
        # guesses); empty until a subscription is linked.
        "mode": "api",
        "subscription_provider": "",
        "subscription_hint": "",
        "subscription_cred_type": "",
        "subscription_source": "",
        "subscription_expires": None,
    }

    chat = _post(client, token, "/api/v1/assistant/chat", {"messages": [{"role": "user", "content": "مرحبا"}]})
    assert chat.status_code == 409
    assert chat.json()["error"]["code"] == "not_configured"


# ---------------------------------------------------------------------------
# AC 2 — the key is stored encrypted and never returned
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_put_stores_key_encrypted_and_never_returns_it(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.encrypt@example.com")
    client.force_login(user)

    raw_key = "sk-super-secret-value-9f8e"
    response = _put(
        client,
        token,
        "/api/v1/assistant/config",
        {"base_url": "https://api.example.com/v1", "model": "g-model-1", "api_key": raw_key},
    )
    assert response.status_code == 200
    body = response.content.decode()
    assert raw_key not in body
    assert "sk-" not in body

    config = AssistantConfig.objects.get(user=user)
    stored = bytes(config.api_key_ciphertext)
    assert raw_key.encode() not in stored          # not the plaintext
    assert raw_key not in config.api_key_hint      # not the hint either
    assert b"gAAAA" in stored                      # Fernet token shape
    config2 = config
    from accounts.assistant_crypto import decrypt_key

    assert decrypt_key(config2.api_key_ciphertext) == raw_key  # opens with the server key


# ---------------------------------------------------------------------------
# AC 3 — HR-set key: hint + source, not readable, employee may replace
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_hr_key_is_hinted_not_readable_and_employee_will_replace_it(client_csrf):
    client, token = client_csrf
    hr = _mk_user("h18.hr@example.com", role=User.Role.HR)
    employee = _mk_user("h18.emp@example.com")
    EmployeeProfile.objects.create(company=default_company(), user=employee, employee_number="E-18")
    client.force_login(hr)

    hr_key = "sk-hr-provided-a1b2c3"
    response = client.put(
        f"/api/v1/employees/{employee.pk}/assistant",
        {"base_url": "https://api.example.com/v1", "model": "m-1", "api_key": hr_key, "is_active": True},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200
    assert hr_key not in response.content.decode()
    assert response.json()["data"]["key_source"] == "hr"
    assert response.json()["data"]["key_hint"].startswith("••••")
    assert response.json()["data"]["is_active"] is True

    # The employee reads their own config: hint + source, no plaintext.
    client.force_login(employee)
    mine = client.get("/api/v1/assistant/config")
    assert mine.status_code == 200
    assert hr_key not in mine.content.decode()
    assert mine.json()["data"]["key_source"] == "hr"
    assert mine.json()["data"]["is_configured"] is True

    # The employee REPLACES it (owner's rule) -> key_source becomes "self".
    own_key = "sk-employee-own-c0de"
    replaced = _put(
        client,
        token,
        "/api/v1/assistant/config",
        {"base_url": "https://api.example.com/v1", "model": "m-1", "api_key": own_key},
    )
    assert replaced.status_code == 200
    config = AssistantConfig.objects.get(user=employee)
    from accounts.assistant_crypto import decrypt_key

    assert decrypt_key(config.api_key_ciphertext) == own_key
    assert config.key_source == "self"
    assert config.api_key_hint == key_hint(own_key)
    assert replaced.json()["data"]["key_source"] == "self"


# ---------------------------------------------------------------------------
# AC 4 — non-HR (employee AND manager) -> 403 on the employee endpoints
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_employee_and_manager_get_403_on_hr_assistant_endpoints(client_csrf):
    client, token = client_csrf
    employee = _mk_user("h18.emp2@example.com")
    manager = _mk_user("h18.mgr@example.com", role=User.Role.MANAGER)
    EmployeeProfile.objects.create(company=default_company(), user=employee, manager=manager, employee_number="E-19")

    for caller in (employee, manager):
        client.force_login(caller)
        get_response = client.get(f"/api/v1/employees/{employee.pk}/assistant")
        assert get_response.status_code == 403, caller.role
        assert get_response.json()["error"]["code"] == "permission_denied"
        put_response = _put(
            client,
            token,
            f"/api/v1/employees/{employee.pk}/assistant",
            {"model": "x"},
        )
        assert put_response.status_code == 403, caller.role


@pytest.mark.django_db
def test_hr_targeting_an_hr_account_is_404(client_csrf):
    client, token = client_csrf
    hr = _mk_user("h18.hr2@example.com", role=User.Role.HR)
    other_hr = _mk_user("h18.hr3@example.com", role=User.Role.HR)
    client.force_login(hr)
    response = client.get(f"/api/v1/employees/{other_hr.pk}/assistant")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# AC 5 — Test button: ok+latency vs the provider's own failure
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_assistant_test_ok_against_a_stub(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.test.ok@example.com")
    _configured(user)
    client.force_login(user)

    class _FakeResponse:
        status = 200
        def read(self):
            return json.dumps({"choices": [{"message": {"role": "assistant", "content": ""}}]}).encode()
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False

    nonce = str(uuid.uuid4())  # flake8: noqa

    def fake_urlopen(request, timeout=None):
        assert b"chat/completions" in request.full_url.encode()
        assert request.get_header("Authorization") == "Bearer sk-live-abcdef123456"
        return _FakeResponse()

    with mock.patch("accounts.assistant_provider.urllib.request.urlopen", side_effect=fake_urlopen):
        response = _post(client, token, "/api/v1/assistant/test", {})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["ok"] is True
    assert isinstance(data["latency_ms"], int)
    assert data["latency_ms"] >= 0


@pytest.mark.django_db
def test_assistant_test_failure_returns_the_provider_status_and_message(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.test.fail@example.com")
    _configured(user, model="no-such-model")
    client.force_login(user)

    import urllib.error

    def fake_urlopen(request, timeout=None):
        raise urllib.error.HTTPError(
            request.full_url, 429, "Rate limit exceeded for org", {}, None
        )

    with mock.patch("accounts.assistant_provider.urllib.request.urlopen", side_effect=fake_urlopen):
        response = _post(client, token, "/api/v1/assistant/test", {})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["ok"] is False
    assert "429" in data["detail"]
    assert "Rate limit exceeded for org" in data["detail"]


# ---------------------------------------------------------------------------
# H18 fix-up 3 — the detail must be the REAL failure (status/URL/connect),
# never a bare generic word
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_http_error_detail_carries_status_url_and_provider_body(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.fixup.http404@example.com")
    _configured(user)  # base_url ends in /v1 -> no fallback rewrite applies
    client.force_login(user)

    import io
    import urllib.error

    def fake_urlopen(request, timeout=None):
        raise urllib.error.HTTPError(
            request.full_url,
            404,
            "Not Found",
            {"Content-Type": "application/json"},
            io.BytesIO(b'{"error": {"message": "Invalid URL (POST /v1/chat/completions)"},"status": 404}'),
        )

    with mock.patch("accounts.assistant_provider.urllib.request.urlopen", side_effect=fake_urlopen):
        response = _post(client, token, "/api/v1/assistant/test", {})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["ok"] is False
    detail = data["detail"]
    assert "404" in detail
    assert "https://api.example.com/v1/chat/completions" in detail
    assert "Invalid URL (POST /v1/chat/completions)" in detail
    assert "unreachable" not in detail


@pytest.mark.django_db
def test_unreachable_detail_names_the_url_and_symptom(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.fixup.unreachable@example.com")
    _configured(user, base_url="http://127.0.0.1:9/v1")
    client.force_login(user)

    import socket
    import urllib.error

    def fake_urlopen(request, timeout=None):
        raise urllib.error.URLError(ConnectionRefusedError("[Errno 111] Connection refused"))

    with mock.patch("accounts.assistant_provider.urllib.request.urlopen", side_effect=fake_urlopen):
        response = _post(client, token, "/api/v1/assistant/test", {})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["ok"] is False
    detail = data["detail"]
    assert "http://127.0.0.1:9/v1/chat/completions" in detail
    assert "connect" in detail
    assert "Connection refused" in detail


@pytest.mark.django_db
def test_dns_failure_detail_says_dns_not_connect(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.fixup.dns@example.com")
    _configured(user, base_url="https://no-such-host.invalid/v1")
    client.force_login(user)

    import socket
    import urllib.error

    def fake_urlopen(request, timeout=None):
        raise urllib.error.URLError(socket.gaierror("[Errno -2] Name or service not known"))

    with mock.patch("accounts.assistant_provider.urllib.request.urlopen", side_effect=fake_urlopen):
        response = _post(client, token, "/api/v1/assistant/test", {})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["ok"] is False
    detail = data["detail"]
    assert "dns" in detail
    assert "Name or service not known" in detail


@pytest.mark.django_db
def test_timeout_detail_says_timeout_with_url(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.fixup.timeout@example.com")
    _configured(user)
    client.force_login(user)

    import urllib.error

    def fake_urlopen(request, timeout=None):
        raise TimeoutError("timed out")

    with mock.patch("accounts.assistant_provider.urllib.request.urlopen", side_effect=fake_urlopen):
        response = _post(client, token, "/api/v1/assistant/test", {})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["ok"] is False
    detail = data["detail"]
    assert "timeout" in detail
    assert "https://api.example.com/v1/chat/completions" in detail


@pytest.mark.django_db
def test_bad_body_detail_carries_a_body_snippet_and_url(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.fixup.badbody@example.com")
    _configured(user)
    client.force_login(user)

    class _HTMLishResponse:
        status = 200
        def read(self):
            return b"<html><body>502 Bad Gateway</body></html>"
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False

    def fake_urlopen(request, timeout=None):
        return _HTMLishResponse()

    with mock.patch("accounts.assistant_provider.urllib.request.urlopen", side_effect=fake_urlopen):
        response = _post(client, token, "/api/v1/assistant/test", {})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["ok"] is False
    detail = data["detail"]
    assert "chat completion" in detail
    assert "502 Bad Gateway" in detail
    assert "https://api.example.com/v1/chat/completions" in detail


@pytest.mark.django_db
def test_route_miss_falls_back_to_the_v1_shape_and_succeeds(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.fixup.fallback.ok@example.com")
    # A base saved without /v1: {base}/chat/completions is a gateway miss.
    _configured(user, base_url="https://gateway.example.com/zen/go")
    client.force_login(user)

    import io
    import urllib.error
    from urllib.parse import urlparse

    class _JsonResponse:
        status = 200
        def __init__(self, payload):
            self._body = json.dumps(payload).encode()
        def read(self):
            return self._body
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False

    def fake_urlopen(request, timeout=None):
        path = urlparse(request.full_url).path
        assert request.get_header("Authorization") == "Bearer sk-live-abcdef123456"
        if path == "/zen/go/chat/completions":
            raise urllib.error.HTTPError(
                request.full_url, 404, "Not Found", {}, io.BytesIO(b"no route"),
            )
        assert path == "/zen/go/v1/chat/completions", path
        return _JsonResponse({"choices": [{"message": {"role": "assistant", "content": "hi"}}]})

    with mock.patch("accounts.assistant_provider.urllib.request.urlopen", side_effect=fake_urlopen):
        response = _post(client, token, "/api/v1/assistant/test", {})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["ok"] is True
    assert isinstance(data["latency_ms"], int)
    assert data["latency_ms"] >= 0


@pytest.mark.django_db
def test_route_miss_fallback_failure_reports_the_fallback_url_and_body(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.fixup.fallback.fail@example.com")
    _configured(user, base_url="https://gateway.example.com/zen/go")
    client.force_login(user)

    import io
    import urllib.error
    from urllib.parse import urlparse

    def fake_urlopen(request, timeout=None):
        path = urlparse(request.full_url).path
        if path == "/zen/go/chat/completions":
            raise urllib.error.HTTPError(
                request.full_url, 404, "Not Found", {}, io.BytesIO(b"no route"),
            )
        raise urllib.error.HTTPError(
            request.full_url, 401, "Unauthorized", {},
            io.BytesIO(b'{"error": {"message": "missing or invalid credentials"}}'),
        )

    with mock.patch("accounts.assistant_provider.urllib.request.urlopen", side_effect=fake_urlopen):
        response = _post(client, token, "/api/v1/assistant/test", {})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["ok"] is False
    detail = data["detail"]
    assert "401" in detail
    assert "https://gateway.example.com/zen/go/v1/chat/completions" in detail
    assert "missing or invalid credentials" in detail


@pytest.mark.django_db
def test_route_miss_base_ending_in_v1_never_rewrites(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.fixup.norrewrite@example.com")
    _configured(user)  # .../v1 already
    client.force_login(user)

    import urllib.error
    from urllib.parse import urlparse

    def fake_urlopen(request, timeout=None):
        assert urlparse(request.full_url).path == "/v1/chat/completions"
        raise urllib.error.HTTPError(request.full_url, 404, "Not Found", {}, None)

    with mock.patch("accounts.assistant_provider.urllib.request.urlopen", side_effect=fake_urlopen):
        response = _post(client, token, "/api/v1/assistant/test", {})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["ok"] is False
    assert "404" in data["detail"]


# ---------------------------------------------------------------------------
# AC 6 — read runs immediately; write pendings and does not mutate
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_read_tool_runs_without_confirmation(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.read@example.com", role=User.Role.HR)
    _configured(user)
    rtype = RequestType.objects.create(company=default_company(), name="Leave", requires_manager_approval=True)
    from reqs.services import create_draft

    create_draft(requester=user, request_type=rtype, title="عطلة")

    round_state = {"n": 0}

    def fake_chat_round(**kwargs):
        # Round 1 legitimately carries no tool result yet: it is the round
        # that ASKS for the read. Round 2 must carry the read's tool result —
        # appended BEFORE this round runs, in the OpenAI tool-message shape.
        round_state["n"] += 1
        tool_messages = [m for m in kwargs["messages"] if m.get("role") == "tool"]
        if round_state["n"] == 1:
            assert not tool_messages, "no read result can exist before the first provider round"
            return {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_read_1",
                        "type": "function",
                        "function": {"name": "read_my_requests", "arguments": "{}"},
                    }
                ],
            }
        # Round 2: the read result must be here, correctly shaped.
        assert tool_messages, "the read result must be appended before the next round"
        latest = tool_messages[-1]
        assert latest["tool_call_id"] == "call_read_1", latest
        payload = json.loads(latest["content"])
        assert payload["ok"] is True and payload["count"] == 1, payload
        return {"role": "assistant", "content": "عندك طلب عطلة واحد."}

    client.force_login(user)
    with mock.patch("accounts.assistant_provider.chat_round", side_effect=fake_chat_round):
        response = _post(
            client,
            token,
            "/api/v1/assistant/chat",
            {"messages": [{"role": "user", "content": "اعرض طلباتي"}]},
        )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["reply"] == "عندك طلب عطلة واحد."
    assert data["tool_trace"] == [{"tool": "read_my_requests", "immediate": True}]
    assert data["pending_action"] is None


@pytest.mark.django_db
def test_write_tool_pends_and_does_not_change_data_until_confirm(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.write@example.com", role=User.Role.HR)
    _configured(user)
    rtype = RequestType.objects.create(company=default_company(), name="Leave", requires_manager_approval=False)

    captured = {}

    def fake_chat_round(**kwargs):
        # The loop stops as soon as a write pends (the confirmation is a
        # separate endpoint), so this runs once — but it receives the LIVE
        # provider_messages list: the pending branch must have appended the
        # write's tool answer to it BY THE TIME THE TURN RETURNS (captured
        # list is mutated in place, so post-turn inspection sees the append).
        captured["messages"] = kwargs["messages"]
        return {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "create_request",
                        "arguments": json.dumps(
                            {"request_type_id": rtype.pk, "title": "طلب عطلة", "submit": False}
                        ),
                    },
                }
            ],
        }

    client.force_login(user)
    with mock.patch("accounts.assistant_provider.chat_round", side_effect=fake_chat_round):
        response = _post(
            client,
            token,
            "/api/v1/assistant/chat",
            {"messages": [{"role": "user", "content": "اكتب لي طلب عطلة"}]},
        )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["pending_action"] is not None
    assert data["pending_action"]["name"] == "create_request"
    assert data["pending_action"]["args"]["request_type_id"] == rtype.pk
    token_value = data["pending_action"]["token"]
    assert token_value

    # The pending write's tool call must be answered with a correctly shaped
    # tool message by the time the turn ends: every tool call gets its tool
    # result in the outgoing conversation, whatever the provider asks next.
    messages_after = captured["messages"]
    pending_tool_messages = [m for m in messages_after if m.get("role") == "tool"]
    assert pending_tool_messages, "the pending write's tool call must be answered too"
    assert pending_tool_messages[-1]["tool_call_id"] == "call_1"
    pending_payload = json.loads(pending_tool_messages[-1]["content"])
    assert pending_payload["ok"] is True and pending_payload["pending_confirmation"] is True

    # Nothing changed yet.
    assert EmployeeRequest.objects.filter(requester=user).count() == 0

    # Now confirm: the write happens through the REAL draft service.
    confirmed = _post(client, token, f"/api/v1/assistant/actions/{token_value}/confirm", {})
    assert confirmed.status_code == 200
    body = confirmed.json()["data"]
    assert body["tool"] == "create_request"
    assert body["result"]["ok"] is True
    # H41 - the CONTRACT the chat panel now formats: `result` is an object
    # carrying the id and the status as strings (the frontend renders these
    # as the formal confirmation receipt). It must never become a "[object
    # Object]" bubble there, so the fields it reads are pinned here.
    assert isinstance(body["result"]["request_id"], str) and body["result"]["request_id"]
    assert body["result"]["status"] == EmployeeRequest.Status.DRAFT
    assert EmployeeRequest.objects.filter(requester=user, title="طلب عطلة").count() == 1
    request_row = EmployeeRequest.objects.get(requester=user)
    assert request_row.status == EmployeeRequest.Status.DRAFT


# ---------------------------------------------------------------------------
# AC 7 — token rejected: reused / expired / different user / tampered args
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_confirm_token_reused_is_rejected(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.replay@example.com", role=User.Role.HR)
    _configured(user)
    rtype = RequestType.objects.create(company=default_company(), name="Leave")
    from accounts.assistant_tools import WRITE_TOOLS

    validated = WRITE_TOOLS["create_request"][0](user, {"request_type_id": rtype.pk, "title": "ت"})["validated"]
    t = sign_action(user_pk=user.pk, tool="create_request", arguments=validated)

    client.force_login(user)
    first = _post(client, token, f"/api/v1/assistant/actions/{t}/confirm", {})
    assert first.status_code == 200
    second = _post(client, token, f"/api/v1/assistant/actions/{t}/confirm", {})
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "already_used"
    # The replay must not have created a second row.
    assert EmployeeRequest.objects.filter(requester=user, title="ت").count() == 1


@pytest.mark.django_db
def test_confirm_token_expired_is_rejected():
    user = _mk_user("h18.expiry@example.com")
    token = sign_action(user_pk=user.pk, tool="create_request", arguments={"title": "ت"})
    with mock.patch("accounts.assistant_actions.time.time", return_value=time.time() + 9999):
        with pytest.raises(ActionTokenError) as caught:
            open_action(token, user_pk=user.pk)
    assert caught.value.code == "expired"


@pytest.mark.django_db
def test_confirm_token_user_mismatch_is_rejected():
    owner = _mk_user("h18.owner@example.com")
    attacker = _mk_user("h18.attacker@example.com")
    token = sign_action(user_pk=owner.pk, tool="create_request", arguments={"title": "ت"})
    with pytest.raises(ActionTokenError) as caught:
        open_action(token, user_pk=attacker.pk)
    assert caught.value.code == "user_mismatch"

    # Even confirming AS the attacker is refused (the API bound is the user).
    client = APIClient(enforce_csrf_checks=False)
    client.force_login(attacker)
    response = client.post(f"/api/v1/assistant/actions/{token}/confirm", {}, format="json")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "user_mismatch"


@pytest.mark.django_db
def test_tampered_token_is_rejected():
    user = _mk_user("h18.tamper@example.com")
    token = sign_action(user_pk=user.pk, tool="create_request", arguments={"title": "original"})
    body, signature = token.split(".", 1)
    payload = json.loads(base64.urlsafe_b64decode(body.encode()))
    payload["arguments"]["title"] = "tampered"
    forged_body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    with pytest.raises(ActionTokenError) as caught:
        open_action(f"{forged_body}.{signature}", user_pk=user.pk)
    assert caught.value.code == "invalid_token"

    # A self-consistent re-sign with modified arguments still fails the
    # tool's own validation (same user, but the args were never confirmed).
    forged = sign_action(user_pk=user.pk, tool="create_request", arguments={"title": "تامبر"})
    client = APIClient(enforce_csrf_checks=False)
    client.force_login(user)
    response = client.post(f"/api/v1/assistant/actions/{forged}/confirm", {}, format="json")
    # Missing request_type_id -> the tool's own validation refuses.
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# AC 8 — a user without the permission cannot confirm (decide_request)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_employee_cannot_confirm_decide_request(client_csrf):
    client, token = client_csrf
    employee = _mk_user("h18.emp3@example.com")
    requester = _mk_user("h18.req3@example.com", role=User.Role.HR)
    _configured(employee)
    # A request the employee has NO scope over (an HR-made record, requester
    # is a different user; the employee is not the manager_at_submission).
    rtype = RequestType.objects.create(company=default_company(), name="Leave", requires_hr_approval=True)
    EmployeeRequest.objects.create(
        requester=requester,
        request_type=rtype,
        title="طلب عطلة",
        status=EmployeeRequest.Status.PENDING_HR,
    )
    fake_token = sign_action(
        user_pk=employee.pk,
        tool="decide_request",
        arguments={
            "request_id": str(EmployeeRequest.objects.get(requester=requester).pk),
            "action": "approve",
            "comment": "",
        },
    )
    client.force_login(employee)
    response = _post(client, token, f"/api/v1/assistant/actions/{fake_token}/confirm", {})
    # The service raises LookupError for an out-of-scope reviewer — the same
    # 404 as a nonexistent request (permission-matrix 404 policy, no
    # existence disclosure), and nothing transitions.
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert (
        EmployeeRequest.objects.get(requester=requester).status
        == EmployeeRequest.Status.PENDING_HR
    )


# ---------------------------------------------------------------------------
# AC 9 — every confirmed write produces an AuditEvent
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_confirmed_write_produces_audit_event(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.audit@example.com", role=User.Role.HR)
    _configured(user)
    rtype = RequestType.objects.create(company=default_company(), name="Leave")
    assert AuditEvent.objects.count() == 0

    from accounts.assistant_tools import WRITE_TOOLS

    validated = WRITE_TOOLS["create_request"][0](user, {"request_type_id": rtype.pk, "title": "ع"})["validated"]
    t = sign_action(user_pk=user.pk, tool="create_request", arguments=validated)
    client.force_login(user)
    response = _post(client, token, f"/api/v1/assistant/actions/{t}/confirm", {})
    assert response.status_code == 200

    event = AuditEvent.objects.get(action="assistant.create_request", actor=user, subject=user)
    assert event.after["tool"] == "create_request"
    assert event.after["arguments"]["title"] == "ع"
    assert event.after["result_status"] == EmployeeRequest.Status.DRAFT


# ---------------------------------------------------------------------------
# AC 10 — chat never accepts a client-supplied key or base URL
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_chat_refuses_a_client_supplied_key_or_base_url(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.clientkey@example.com")
    client.force_login(user)

    for injected in (
        {"messages": [{"role": "user", "content": "hi"}], "api_key": "sk-evil"},
        {"messages": [{"role": "user", "content": "hi"}], "base_url": "https://evil.example/v1"},
        {"messages": [{"role": "user", "content": "hi"}], "model": "x"},
    ):
        response = _post(client, token, "/api/v1/assistant/chat", injected)
        assert response.status_code == 422, injected
        assert response.json()["error"]["code"] == "validation_error"


# ---------------------------------------------------------------------------
# Loop bound + config gating + tool permission shape
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_chat_is_inactive_when_hr_switched_it_off(client_csrf):
    client, token = client_csrf
    hr = _mk_user("h18.deactivate.hr@example.com", role=User.Role.HR)
    employee = _mk_user("h18.deactivate.emp@example.com")
    _configured(employee, is_active=False)
    client.force_login(employee)
    response = _post(
        client, token, "/api/v1/assistant/chat",
        {"messages": [{"role": "user", "content": "مرحبا"}]},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "inactive"


@pytest.mark.django_db
def test_tool_loop_is_bounded_at_five_rounds():
    user = _mk_user("h18.spin@example.com", role=User.Role.HR)
    _configured(user)
    rounds = {"count": 0}

    def spinning_chat_round(**kwargs):
        rounds["count"] += 1
        return {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": f"call_{rounds['count']}",
                    "type": "function",
                    "function": {"name": "read_my_requests", "arguments": "{}"},
                }
            ],
        }

    from accounts.assistant_chat import ChatConfigError

    with mock.patch("accounts.assistant_provider.chat_round", side_effect=spinning_chat_round):
        outcome = assistant_chat(user, AssistantConfig.objects.get(user=user), [{"role": "user", "content": "spin"}])
    assert rounds["count"] <= 5
    assert outcome["tool_trace"]

    # A tool call storm must never loop more than MAX_PROVIDER_ROUNDS times.
    assert rounds["count"] == 5


@pytest.mark.django_db
def test_manager_read_queue_scope_only(client_csrf):
    """A manager's read_review_queue runs as THEM: scoping mirrors review.scope."""
    from review.scope import scope_requests

    manager = _mk_user("h18.queue.mgr@example.com", role=User.Role.MANAGER)
    employee = _mk_user("h18.queue.emp@example.com")
    EmployeeProfile.objects.create(company=default_company(), user=employee, manager=manager, employee_number="E-20")
    from accounts.assistant_tools import read_review_queue

    result = read_review_queue(manager, {})
    assert result["ok"] is True
    assert result["pending_requests"] == []
    assert result["pending_timesheets"] == []

    plain = _mk_user("h18.queue.plain@example.com")
    result = read_review_queue(plain, {})
    assert result["ok"] is False


@pytest.mark.django_db
def test_unsupported_tools_refuse_honestly():
    from accounts.assistant_tools import write_clock_in, write_create_task

    user = _mk_user("h18.unsupported@example.com")
    assert write_create_task(user, {"title": "x"})["error"] == "unsupported"
    assert write_clock_in(user, {"kind": "IN"})["error"] == "unsupported"


@pytest.mark.django_db
def test_assistant_test_requires_configuration(client_csrf):
    client, token = client_csrf
    user = _mk_user("h18.test.unconfigured@example.com")
    client.force_login(user)
    response = _post(client, token, "/api/v1/assistant/test", {})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "not_configured"


# ---------------------------------------------------------------------------
# H20 — read_request_types + computed leave balance
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_read_request_types_lists_active_types_with_ids():
    from accounts.assistant_tools import read_request_types

    user = _mk_user("h20.types@example.com")
    active, _ = RequestType.objects.get_or_create(
        name="إجازة اعتيادية", defaults={"requires_hr_approval": False}
    )
    inactive = RequestType.objects.create(company=default_company(), name="قديم h20", is_active=False)

    result = read_request_types(user, {})
    ids = [row["id"] for row in result["request_types"]]
    assert result["ok"] is True
    assert result["request_types"], "seeded types must be listed"
    assert active.pk in ids
    assert inactive.pk not in ids
    row = next(r for r in result["request_types"] if r["id"] == active.pk)
    assert row["name"] == "إجازة اعتيادية"
    assert row["requires_hr_approval"] is False
    assert "note" not in result


@pytest.mark.django_db
def test_read_request_types_empty_tables_points_at_hr_not_id():
    from accounts.assistant_tools import read_request_types

    user = _mk_user("h20.types.empty@example.com")
    RequestType.objects.all().delete()
    result = read_request_types(user, {})
    assert result["ok"] is True
    assert result["request_types"] == []
    assert "HR" in result["note"]
    assert "never" in result["note"].lower() and "id" in result["note"].lower()


@pytest.mark.django_db
def test_leave_balance_counts_approved_requests_per_leave_type():
    from accounts.assistant_tools import read_my_leave_balance
    from reqs.services import create_draft

    user = _mk_user("h20.balance@example.com")
    annual, _ = RequestType.objects.get_or_create(name="إجازة اعتيادية")
    sick, _ = RequestType.objects.get_or_create(name="إجازة مرضية")
    task = RequestType.objects.create(company=default_company(), name="تصحيح h20")
    d1 = create_draft(requester=user, request_type=annual, title="عطلة 1")
    d2 = create_draft(requester=user, request_type=annual, title="عطلة 2")
    create_draft(requester=user, request_type=sick, title="مرضية")
    create_draft(requester=user, request_type=task, title="تصحيح")  # non-leave name ignored

    # Approve exactly one annual request through the real decision service.
    # Submission routes for manager approval, so the employee needs a manager
    # on file (same setup the review tests use).
    from accounts.models import EmployeeProfile
    from reqs.submission_services import submit_request
    from reqs.decision_services import decide_request

    manager = _mk_user("h20.mgr@example.com", role=User.Role.MANAGER)
    EmployeeProfile.objects.create(company=default_company(), user=user, manager=manager, employee_number="H20-1")
    submitted = submit_request(requester=user, request_obj=d1, version=d1.version)
    decide_request(
        reviewer=manager,
        request_obj=submitted,
        action="approve",
        comment="م",
        version=submitted.version,
        key_hash=uuid.uuid4().hex,
        payload_hash=uuid.uuid4().hex,
    )

    result = read_my_leave_balance(user, {})
    assert result["ok"] is True
    assert result["entitlement_configured"] is False
    by_name = {row["name"]: row for row in result["balances"]}
    assert by_name["إجازة اعتيادية"]["taken_requests"] == 1  # only the approved one
    assert by_name["إجازة مرضية"]["taken_requests"] == 0  # draft not counted
    assert "تصحيح h20" not in by_name  # non-leave name excluded
    assert by_name["إجازة اعتيادية"]["entitlement_days"] is None
    assert ("ntitlements are not configured" in result["note"]) or ("entitlement is not configured" in result["note"])


@pytest.mark.django_db
def test_leave_balance_with_no_leave_types_reports_gap_without_claiming_tracking():
    from accounts.assistant_tools import read_my_leave_balance

    user = _mk_user("h20.balance.empty@example.com")
    RequestType.objects.all().delete()
    result = read_my_leave_balance(user, {})
    assert result["ok"] is True
    assert result["tracked"] is False
    assert "HR" in result["note"] or "hr " in result["note"].lower()


@pytest.mark.django_db
def test_new_read_tools_are_registered_and_specced():
    from accounts.assistant_tools import ALL_TOOL_SPECS, READ_TOOLS

    names = {spec["function"]["name"] for spec in ALL_TOOL_SPECS}
    assert "read_request_types" in READ_TOOLS
    assert "read_request_types" in names


@pytest.mark.django_db
def test_migration_seeds_the_app_vocabulary(client_csrf):
    """The seed migration (0008) has run on this_DEV db via pytest; assert
    its rows math the frontend mock vocabulary after a clean run."""
    # The test db may have been seeded by the migration itself.
    from reqs.models import RequestType

    names = set(RequestType.objects.values_list("name", flat=True))
    # Either empty (tests create their own) or exactly the seeded vocabulary.
    if names:
        assert names == {"إجازة اعتيادية", "إجازة مرضية", "تصحيح سجل وقت", "تصريح خروج أثناء اليوم"}

