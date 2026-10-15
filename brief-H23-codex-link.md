# H23 — the Codex tab must link too (same experience as opencode)

The owner, verbatim: **«عاوزك تضيف اني اقدر اشترك بردو لكودكس بقا»** — the Codex
tab must be able to subscribe/authorize and link, the way opencode now does.

## What is already true (build on it, do not redo it)

- The opencode device flow works: `POST /assistant/subscription/start`
  `{"provider":"opencode"}` → `{"user_code":"FPMP-XFLF","interval":5,
  "expires_in":600,"verification_uri":"https://opencode.ai/console/device?user_code=…&client_id=opencode-cli"}`,
  and `poll` with the provider → `{"status":"pending"}`. (H22 is fixing `poll`
  so it no longer needs the provider in the body — do not undo that.)
- The frontend panel (`src/features/assistant/SubscriptionPanel.tsx`) already
  renders the authorize button + code/link/waiting states and is written to serve
  **both** tabs — so this lane is **backend only** unless the panel is missing
  something provider-specific (check, and say so if it is).
- Measured on this machine: `~/.codex/auth.json` holds
  `tokens{access_token, account_id, id_token, refresh_token}`, `auth_mode`,
  `last_refresh` — a ChatGPT OAuth token set. `codex` is installed on PATH.
- The **import** path must keep working for both providers (it is the owner's
  fallback: verified `import` → `status: linked`, `model: glm-5.3-flash`,
  `test` → `{"ok": true, "latency_ms": 967}` for opencode).

## Deliverable

1. **Discover Codex's real authorization** from the installed `codex` CLI and its
   source — do not invent a path (an invented `/oauth/device/start` is exactly
   what produced the earlier 404). Determine whether it is a device flow, a
   browser PKCE with a local/server callback, or API-key only, and **cite where
   you read it**.
2. Implement it behind the **same contract** the panel already uses for opencode:
   `POST /assistant/subscription/start {"provider":"codex"}` → whatever the user
   needs (a code + verification URL, or an authorize URL the panel can open), and
   `POST /assistant/subscription/poll` → `pending` until approved, then **linked**
   with the credential stored encrypted (`subscription_ciphertext`,
   `subscription_provider=codex`, masked hint only — never the raw token in any
   response, log, or UI).
3. If the real flow cannot complete server-side (it needs a browser callback the
   server cannot own), then: keep the code/link experience honest, **and** make
   `import` from `~/.codex/auth.json` the working primary for Codex — including
   **refreshing** an expired `access_token` with the stored `refresh_token`, and
   marking the link broken (with the faded-launcher hint) when refresh fails.
   Never a button that can only fail.
4. `POST /api/v1/assistant/test` must return `ok: true` through the Codex
   credential, and a chat round-trip must work — prove both with real output.
5. Keep the suite green (`pytest -q accounts/test_assistant.py
   accounts/test_assistant_subscription.py`, currently **55 passed** and H22 adds
   more) and add tests for the Codex path. Restart the server, report the new pid.
   Do not commit, stage, or stash. Report plainly whatever cannot work.
