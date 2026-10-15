# H19 fix-up 4 — the subscription login button calls an invented endpoint

The owner pressed **«تسجيل الدخول للاشتراك»** (both for Codex and for opencode)
and got, verbatim:

```
HTTP 404: {"error": {"message": "Invalid URL (POST /oauth/device/start)",
"type": "invalid_request_error", "param": null, "code": null}}
```

That JSON is the **provider's own** error: the backend POSTs to
`<base_url>/oauth/device/start`, a path that does not exist on any of these
gateways. The endpoint was invented rather than discovered.

## What is actually true on this machine (measured — build on this, not on guesses)

`~/.local/share/opencode/auth.json` holds, per provider:
- `{"key": ..., "type": ...}` for `opencode`, `zai`, `zai-coding-plan` and
  **`opencode-go`** — i.e. **opencode-go has no device flow at all**: its
  credential is a **key** that `opencode auth login` stored. There is nothing to
  log in to; the correct action is **import**.
- `{"access", "refresh", "expires", "type"}` for `anthropic` and `openai` —
  OAuth tokens with a refresh token.

`~/.codex/auth.json` holds `tokens{access_token, account_id, id_token,
refresh_token}` + `auth_mode` + `last_refresh` — a ChatGPT OAuth token set.
Codex's real login is a **browser PKCE flow against OpenAI's auth host**, not a
device-code POST to the API base.

## Fix

1. **Delete the invented call.** Never POST `/oauth/device/start` (or any
   `/oauth/*` path) to the provider's API base URL.
2. **Make «استيراد من تسجيل الجهاز» the primary, working path** for both
   subscriptions, and prove it: read the store, take the credential, store it
   **encrypted**, and make `POST /api/v1/assistant/test` succeed through it.
   - opencode / opencode-go → the `{key, type}` shape (use the key as the bearer
     credential; if the gateway needs a session header, find the one the CLI
     itself sends and document it in the plan).
   - Codex → the `tokens` shape (`access_token` + `refresh_token`); refresh when
     expired, and if the refresh fails, mark the link broken so the launcher goes
     faded with the existing hint — never a dead button.
3. **The login button**: if a real device/authorisation flow is genuinely
   available for a provider, implement it against that provider's **auth host**
   and the correct path — and say so in the UI. If it is not available (the case
   for opencode-go), do not show a button that can only fail: show the import
   action and an honest line explaining that this provider links by importing the
   CLI's login. `codex login` on this machine is already done, so import covers
   Codex too.
4. **Errors must be actionable**: if a provider call fails, surface the status +
   the provider's message + the URL that was called (the raw text above is
   already informative — keep that fidelity, but name the URL).

## Prove it (real output only)

- `pytest -q accounts/test_assistant.py accounts/test_assistant_subscription.py`
  — all green (40 passed currently).
- A live walkthrough on the running server (`http://192.168.1.19:8080`, restart
  after your change and report the new pid): fresh HR signup (code `Menisy2002`),
  `POST /api/v1/assistant/subscription/import` for **opencode**, then
  `POST /api/v1/assistant/test` → `ok: true`, then a chat round-trip. Paste the
  real responses, and show that **no token or key appears in any response body**.
- Repeat for **codex**.
- Do not commit, stage, or stash anything.
