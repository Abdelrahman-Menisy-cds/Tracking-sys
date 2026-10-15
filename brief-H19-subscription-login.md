# H19 — «مدام عفاف»: link a SUBSCRIPTION (opencode / Codex), not just an API key

## What the owner asked for

> "عاوزك تضيف خيار اني اختار اشتراك اوبن كود جو او كودكس وهو يسجل زي اي برنامج
> عادي زي اوبن كود مثلا"

So the assistant must support **two ways** to be linked:

1. the API-key mode that already exists (base URL + key + model), and
2. a **subscription mode**: the user picks **opencode (zen/go)** or **Codex** and
   **signs in the way those tools do** — a real login, not a pasted key.

Why this matters (measured, not assumed): the zen gateway is **not** plain
OpenAI-compatible. From this machine
`curl https://opencode.ai/zen/go/v1/models` → **200**, but
`curl https://opencode.ai/zen/go/v1/chat/completions` → **404**, and the gateway
expects a session header (`x-opencode-session`). A pasted API key alone can
therefore never work there — the login is the only path.

## Design the owner should approve (write the plan, then implement)

### Measured credential shapes on this machine (read the structure, never the values)

Verified by inspecting only the key names of the two stores (no token was read
into any output):

`~/.local/share/opencode/auth.json` — top-level keys:
`opencode`, `anthropic`, `zai`, `zai-coding-plan`, **`opencode-go`**, `openai`.
Two shapes appear:

- `{"key": ..., "type": ...}` for `opencode` / `zai` / `zai-coding-plan` /
  **`opencode-go`** — a plain provider key the CLI stores after its login. The
  owner **already has an `opencode-go` entry**, so the import path is viable
  today; treat `type` as the discriminator (key vs oauth).
- `{"access": ..., "refresh": ..., "expires": ..., "type": ...}` for `anthropic`
  and `openai` — OAuth tokens with a refresh token and an expiry.

`~/.codex/auth.json` — `auth_mode` (str), `OPENAI_API_KEY` (null here),
`tokens` = `{access_token, account_id, id_token, refresh_token}`, `last_refresh`
(str) — a ChatGPT OAuth token set with a refresh token.

Implement both shapes: a **key** credential and an **oauth** credential
(access + refresh + expires). Importing the owner's existing local login is the
fallback that makes this demonstrable **today**; the device/authorisation-code
flow is the general path for real employees. Refresh the oauth shape before
`expires` and re-import the key shape as-is.

- **Provider picker** in the profile widget (and in HR's employee panel): a
  segmented choice — «مفتاح API» / «اشتراك opencode» / «اشتراك Codex».
- **Subscription login**: the server drives the login the same way the CLIs do
  and stores the resulting credentials **encrypted**, per user, alongside the
  existing `AssistantConfig` row (never in a shared file, never returned by any
  endpoint). Support both shapes if they exist:
  - a **device/authorisation-code flow** (the app shows a code + link, the user
    approves in their browser, the server polls for the token), which is the
    "زي أي برنامج عادي" experience the owner described; and
  - **importing an existing local login** (`opencode auth login` /
    `codex login` already done on this machine) as the fallback for the demo —
    read the credential store the CLI uses, never log its contents, and say
    plainly in the UI which source the credentials came from.
- **Model list**: once linked, fetch the models the subscription actually offers
  and let the user pick one (the owner wants to choose the model either way).
- **Refresh**: subscriptions expire. Refresh tokens server-side, and when a
  refresh fails, mark the config unlinked so the launcher goes faded again with
  the same hint — never a silent dead button.
- **Never** send a subscription token to the browser, never log it, never put it
  in an error message. A Test button in subscription mode must prove the link
  with a real 1-token call and report the provider's own error text on failure.
- **No provider presets beyond these two logins** — the owner was explicit that
  everything else is the user's own endpoint.

## Before writing code

Write the plan first (`.hermes/plans/h19-subscription-login.md`): the exact login
flows you will implement, where credentials are stored and encrypted, what
happens when the token expires, and which existing files change. Then implement,
then prove it.

## Evidence

- Tests: the login flow against a **stub authorisation server** you start
  yourself (proving the poll + store + use path without touching a real account),
  plus a test that a token is never returned in any response body.
- Live: link a subscription on this machine using the **local** CLI credentials
  already present, then `POST /api/v1/assistant/test` and a chat round-trip,
  pasting the real responses.
- Keep the existing green tests green: `pytest -q accounts/test_assistant.py`
  (21 passed) — and the pre-existing failures in `config/test_schema.py` and the
  `cookie["secure"]` login test are not yours to fix.
- Report the plan path, the migration name, the restart command + new pid, and
  every real command's output. No placeholders. Do not commit, stage, or stash.
