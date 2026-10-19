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
