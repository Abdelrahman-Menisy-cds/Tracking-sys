# H19 — Subscription login for «مدام عفاف» (opencode / Codex)

## Goal

Support TWO link modes for the assistant, side by side with the existing
API-key mode:

1. **API-key mode** (existing H18): base URL + key + model.
2. **Subscription mode** (new): the user picks «اشتراك opencode» or
   «اشتراك Codex» in the provider picker and the server drives a real login,
   storing the credentials encrypted per user. Two credential shapes are
   supported because BOTH were measured on this machine's CLI stores:
   - **key** shape: `{"key": ..., "type": ...}` — opencode's `opencode-go`
     entry (`~/.local/share/opencode/auth.json`). Does not expire; re-imported as-is.
   - **oauth** shape: `{access, refresh, expires, ...}` — codex's
     `~/.codex/auth.json` (`tokens.access_token/refresh_token`), and
     opencode's `anthropic`/`openai` entries. Refreshed server-side before
     `expires`.

## Measured facts (already verified, do not re-derive)

- `curl https://opencode.ai/zen/go/v1/models` → 200;
  `POST .../chat/completions` unauthenticated → 401 (a pasted key path alone
  can't drive zen; the gateway expects `x-opencode-session`, proven by
  holidays/llm.py: HTTP 400 MissingSessionID without it).
- The zen gateway already works in production via
  `holidays/llm.py` (session header + UA `heya-fawda-tracking/1.0` to beat
  Cloudflare 1010).
- One dev server: `manage.py runserver 0.0.0.0:8080 --noreload` (pid noted at
  implement time; will be restarted and the new pid reported).

## URLs (all under /api/v1)

| Endpoint | Who | Purpose |
|---|---|---|
| `POST /assistant/subscription/start` | self | begin the device/authorisation-code flow for {provider}; returns the provider's device code + user code + verification URL (never a token) |
| `POST /assistant/subscription/poll` | self | poll the flow; when the stub/real server approves, fetch+store the token, return the config read shape (no secrets); pending/expired reported |
| `POST /assistant/subscription/import` | self | import the LOCAL CLI login the provider already holds on this machine (`opencode auth login` / `codex login`); the UI labels the source honestly ("استيراد من تسجيل opencode على هذا الجهاز") |
| `GET /assistant/subscription/models` | self | the models the linked subscription actually offers (opencode: live `GET {base}/models`; codex: no listing endpoint exists — the response says so honestly and the user types the model id) |
| `PUT /assistant/config` (extended) | self / HR | accepts `mode: "subscription"` to switch modes, and in api mode unchanged; also `subscription: {"provider":...}` to unlink |
| `POST /assistant/test` | self | in subscription mode proves the link with a real 1-token call (provider's own error on failure) |
| `POST /assistant/chat` | self | in subscription mode the server-side credential is used, refreshed first if needed |

## Storage / encryption

New fields on `accounts.AssistantConfig` (migration
`0008_assistantconfig_subscription`):

- `subscription_provider` CharField(32, blank) — "opencode" | "codex" (only
  these two presets exist, owner's rule; everything else is the user's own
  endpoint in api mode).
- `subscription_ciphertext` BinaryField(blank) — the credential JSON blobs
  (key-shape or access/refresh/expires) encrypted with the SAME Fernet
  pipeline as the API key (assistant_crypto.encrypt_key, "v1:" prefix), so
  the at-rest guarantee and key-rotation semantics stay identical.
- `subscription_hint` CharField(64, blank) — display hint only.
- `subscription_cred_type` CharField(8, blank) — "key" | "oauth".
- `subscription_source` CharField(16, blank) — "device" | "local" (honest
  provenance shown in the UI).
- `subscription_expires` DateTimeField(null) — oauth only; key shape null.

Mode is DERIVED (`subscription_provider` non-blank ⇒ subscription mode), not
an extra flag — one source of truth. A subscription link CLEARS the api-key
fields and vice versa: exactly one credential per row.

`is_configured` extension: subscription mode is configured when
`subscription_provider` + `model` + ciphertext are present.

## Refresh / expiry behaviour

Before every test/chat call against an oauth credential:
`assistant_subscriptions.ensure_fresh(config)`:

- `expires` ≥ now + 60s → use as-is.
- otherwise POST the provider's refresh URL (from the provider registry;
  overridable via settings so the stub tests can point it anywhere) with
  ONLY the refresh token; on 200 the row is re-encrypted and `expires`
  updated inside a transaction with `select_for_update`.
- On any refresh failure → the row is UNLINKED (subscription fields cleared,
  `is_active=False`) and an AuditEvent `assistant.subscription_expired` is
  written; the endpoints then answer 409 `not_configured` so the launcher
  fades with the same hint — never a silent dead button, and chat answers
  with a clear 409 rather than dying mid-call.

## The device flow (the general path)

Generic RFC 8628-shaped client in `accounts/assistant_subscriptions.py`
(stdlib urllib, same pattern as assistant_provider.py):

- `start`: POST `{provider.device_authorization_url}` → parse
  `device_code/user_code/verification_uri/interval`.
- Device code stored in Django cache, bound to the caller's user pk, ~15 min.
- `poll`: with the user's device_code, the server POSTs
  `{provider.token_url}` (grant= urn:ietf:params:oauth:grant-type:device_code)
  — slow_down / authorization_pending map to a 200 response with
  `{"status": "pending"}`; success stores the credential and returns config.
  All trainer URLs come from the provider registry and are overridable by
  env vars (`ASSISTANT_OPENCODE_*_URL`, `ASSISTANT_CODEX_*_URL`) — the stub
  tests point them at a local HTTP server.

## Token never leaves the server

- The plaintext/ciphertext is never returned by ANY endpoint (tests assert
  this on every new response body, exactly like H18 test 2/10 did).
- Errors: the same `_truncate/_sanitize` scrub as assistant_provider runs on
  everything an error carries.
- Never sent to the browser, never logged, never in AuditEvent (only
  "has_subscription: true" booleans).

## Provider call plumbing

`assistant_chat` / `AssistantTestView` gain a credential resolution step:
subscription mode → decrypt + refresh-check + build the call from the
registry; opencode adds the per-request `x-opencode-session` header and the
honest UA (holidays/llm.py precedent). `assistant_provider` gets an optional
`extra_headers` passthrough — no other change to the 404→/v1 fallback logic.

## Files changed

- `accounts/models.py` — new fields + `is_configured` extension + `key_source` unchanged.
- `accounts/migrations/0008_assistantconfig_subscription.py` — the columns.
- `accounts/assistant_subscriptions.py` — NEW: registry, import, device flow, refresh, model list, unmark-on-expiry.
- `accounts/assistant_crypto.py` — unchanged (reused).
- `accounts/assistant_provider.py` — `extra_headers` passthrough only.
- `accounts/assistant_views.py` — new views + subscription-aware test/chat wiring.
- `accounts/urls.py` — 3 new routes (start / poll / import / models = 4).
- `accounts/assistant_serializers.py` — read shape gains subscription fields; write shape gains mode fields.
- `config/schema.py` — AssistantConfigRead/Write fields + new per-view schema classes, wired in the mapping block ("schema truthfulness" per project memory).
- `accounts/test_assistant_subscription.py` — NEW: stub auth-server tests + token-never-returned test.
- `accounts/test_assistant.py` — extended read-shape assertions stay green (the shape gains fields, the exact-equality test must be updated to the documented new shape: allowed as part of this story).

## Not in this task (follow-up)

- The SPA widget (frontend brief will consume the documented shapes).
- No commit / stage / stash.

## Proof plan

1. `pytest -q accounts/test_assistant.py` still 21 passed (+ new file green).
2. Live: import the local `opencode-go` login through the API on the running
   server, fetch the model list, `POST /assistant/test`, one chat round-trip
   with real pasted responses.
3. Unit-test a stub authorization server end-to-end for the device flow.
