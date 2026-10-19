"""The codex device login completes in two steps.

Its device poll answers with an authorization_code + code_verifier, and only the
OAuth exchange that follows carries access_token. Treating the first answer as
final made a COMPLETED approval look like a provider error, so the panel waited
on «في انتظار الموافقة» forever while the user had already approved.
"""
import json
import urllib.parse

import pytest

from accounts import assistant_subscriptions


class _Answer:
    def __init__(self, payload, status=200):
        self._payload = json.dumps(payload).encode("utf-8")
        self.status = status

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


@pytest.fixture
def codex_calls(monkeypatch):
    """Capture every outbound call and answer the two codex steps."""
    seen = []

    def fake_open(request, timeout=None):
        body = (request.data or b"").decode("utf-8")
        seen.append((request.full_url, body, dict(request.headers)))
        if request.full_url.endswith("/deviceauth/token"):
            return _Answer({"authorization_code": "ac-123", "code_verifier": "cv-456"})
        if request.full_url.endswith("/oauth/token"):
            return _Answer({"access_token": "at-1", "refresh_token": "rt-1", "expires_in": 3600})
        raise AssertionError(f"unexpected call: {request.full_url}")

    monkeypatch.setattr(urllib.request, "urlopen", fake_open)
    return seen


def test_the_device_answer_is_exchanged_for_tokens(codex_calls):
    """The poll must run the exchange rather than call the code answer an error."""
    answer = assistant_subscriptions._codex_exchange_device_code(
        assistant_subscriptions.CODEX,
        {"authorization_code": "ac-123", "code_verifier": "cv-456"},
    )
    assert answer["access_token"] == "at-1"


def test_the_exchange_posts_the_form_codex_expects(codex_calls):
    """Form, not JSON; authorization_code grant; the deviceauth callback redirect."""
    assistant_subscriptions._codex_exchange_device_code(
        assistant_subscriptions.CODEX,
        {"authorization_code": "ac-123", "code_verifier": "cv-456"},
    )
    url, body, _headers = codex_calls[-1]
    form = dict(urllib.parse.parse_qsl(body))
    assert url.endswith("/oauth/token")
    assert form["grant_type"] == "authorization_code"
    assert form["code"] == "ac-123"
    assert form["code_verifier"] == "cv-456"
    assert form["redirect_uri"].endswith("/deviceauth/callback")
    assert form["client_id"] == assistant_subscriptions.CODEX.device_client_id


# ---------------------------------------------------------------------------
# The listing falls back to the measured slugs when the gateway refuses
# ---------------------------------------------------------------------------


def test_listing_falls_back_when_the_gateway_refuses(monkeypatch, django_db_setup=None):
    """Codex rejects a refreshed token on /models (missing_end_user_auth) while
    the same token still serves /responses, so a working link would otherwise
    lose its picker entirely. The fallback carries the slugs the account's own
    listing returned — never a guess."""
    import urllib.error

    def refuse(request, timeout=None):
        raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, None)

    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setattr(
        assistant_subscriptions, "ensure_fresh", lambda config: (assistant_subscriptions.CODEX, {"access": "tok"})
    )
    answer = assistant_subscriptions.list_models(object())
    assert answer["supported"] is True
    assert answer["models"] == list(assistant_subscriptions.CODEX.fallback_models)
    assert "gpt-5.6-luna" in answer["models"]


def test_a_provider_without_a_fallback_still_reports_the_refusal(monkeypatch):
    """The fallback is not a blanket silence: a provider that has none keeps
    answering with the provider's own error."""
    import urllib.error

    def refuse(request, timeout=None):
        raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, None)

    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setattr(
        assistant_subscriptions, "ensure_fresh", lambda config: (assistant_subscriptions.OPENCODE, {"key": "k"})
    )
    with pytest.raises(assistant_subscriptions.SubscriptionError):
        assistant_subscriptions.list_models(object())


# ---------------------------------------------------------------------------
# Every outbound call carries the explicit User-Agent the edge demands
# ---------------------------------------------------------------------------


def test_chat_headers_carry_the_explicit_user_agent():
    """Cloudflare 403s the default Python-urllib signature (error 1010), so the
    listing — which rides these headers — is refused without the UA. Building
    from the extras alone dropped it once already."""
    for spec, blob in (
        (assistant_subscriptions.OPENCODE, {"key": "k"}),
        (assistant_subscriptions.CODEX, {"access": "t", "group_id": "g"}),
    ):
        headers = assistant_subscriptions.chat_headers(spec, blob)
        assert headers.get("User-Agent"), spec.slug
        assert "python-urllib" not in headers["User-Agent"].lower(), spec.slug
