# H21 — make the opencode subscription authorize FROM THE APP (no guessing)

The owner, verbatim: **«انا عاوزه يعمل عمليه التصديق مع اوبن كود جو ويربط عطول»** —
they want to press a button in the widget, complete the authorization, and be
linked immediately. The current UI tells them there is no in-app login and to
import the CLI's local login instead. That is honest but not what they asked for.

## What went wrong before (do not repeat it)

A previous run invented `POST <base_url>/oauth/device/start` and the provider
answered `404 {"error":{"message":"Invalid URL (POST /oauth/device/start)"}}`.
**Never invent an auth endpoint.** Find the real one.

## Where the truth lives

- `opencode auth login` / `opencode auth login --provider zen` is the CLI's own
  flow for the Zen/opencode-go subscription. Its implementation is in the
  opencode source (repo `sst/opencode`, the auth/provider modules) — read it, or
  install the CLI (`npx opencode …` — it is not on PATH here) and trace exactly
  what it calls and what it stores.
- Measured on this machine: `~/.local/share/opencode/auth.json` holds
  `opencode-go: {"key": ..., "type": ...}` — so whatever the flow does, it ends
  with a **key** stored under the provider name. That key is what the assistant
  must end up using (encrypted, server-side).
- The gateway itself is not plain OpenAI: `https://opencode.ai/zen/go/v1/models`
  → 200, but `/zen/go/v1/chat/completions` → 404, and it expects a session header.
  So "authorize" and "call the model" are two separate problems — solve both, and
  prove the second one with a real 1-token call.

## Deliverable

1. **A real in-app authorization** for `opencode` that links the account:
   - Prefer a **device/authorisation-code flow** (the app shows a code + a link,
     the user approves in their browser, the server polls and stores the
     credential) — that is the "زي أي برنامج عادي" experience.
   - If opencode's flow is a **browser callback (PKCE)**, implement it end to end:
     the app opens the authorize URL, the server owns the callback and the token
     exchange, then stores the credential. Say which one it turned out to be.
   - If neither can run server-side, say so **with the evidence** and make the
     import path the button the owner presses (it already works — verified: the
     import linked `opencode-go` and `POST /assistant/test` returned
     `{"ok": true, "latency_ms": 967}`), instead of a button that 404s.
2. **Calling the model through that credential**: find the base URL + headers the
   CLI uses for the Zen/go gateway and use exactly those. Prove it with
   `POST /api/v1/assistant/test` → `ok: true` and a chat round-trip, pasting the
   real responses.
3. **Never** return, log, or render the key/token — only a masked hint. Keep the
   existing green tests green (`pytest -q accounts/test_assistant.py
   accounts/test_assistant_subscription.py` → 40 passed) and add tests for the
   flow (a stub authorisation server is fine for the poll/store path).
4. Restart the server after your change and report the new pid + the exact
   command; update the widget's wording so it matches what the button now really
   does (Arabic + English in `frontend/src/i18n/dict.ts` — coordinate with the
   frontend lane if a new label is needed, or add it yourself if the frontend is
   idle).

Report the source file/URL you learned the flow from, every real command output,
and anything you could not make work — plainly. Do not commit, stage, or stash.
