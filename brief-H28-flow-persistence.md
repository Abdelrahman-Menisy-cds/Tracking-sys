# H28 — the pending subscription login flow dies on every server restart

## Evidence (real, from the running server + the DB)

While the owner was mid-flow on the codex tab (user_code `SISX-CFEMQ` visible in
the panel), the server log showed:

```
Conflict: /api/v1/assistant/subscription/poll
[12/Oct/2026 10:43:26] "POST /api/v1/assistant/subscription/poll HTTP/1.1" 409 161
```

and a fresh poll with no pending flow returns:

```
{"error":{"code":"no_pending_flow","message":"No subscription login is pending — start it first."}}  [409]
```

The only subscription table in the SQLite DB is `accounts_subscriptioncode` with
columns `[id, code, label, is_active, created_at, last_used_at, use_count]` — that
is the **signup** code table, not the login flow. So the pending login flow lives
in **process memory**, and **every server restart destroys it**. During this
session the server was restarted many times (by the working bots and by hand), so
the owner's flow kept dying mid-flight and the link could never complete.

## Two fixes

1. **Persist the pending login flow** (provider, device_code/user_code,
   verification_uri, interval, expires_at, the owning user, and any state the
   provider's poll needs) in the database, keyed by user+provider, so a restart
   does not lose it. Clear it on success, on cancel, and when `expires_at` passes.
   Keep the same response shapes the frontend already consumes.
2. **Handle the terminal 409 honestly in the UI.** `no_pending_flow` and
   `flow_expired` must END the wait and show an honest "انتهى — ابدأ التسجيل من
   جديد" state with a restart action — not «حصلت مشكلة في سؤال الحالة — بنكمل
   المحاولة» with a dead code on screen. (The panel already has a `terminal` gate
   for exactly these two codes — verify it actually fires for the 409 envelope,
   and that the message shown is the honest one.)

## Prove it

- Start a codex flow (POST subscription/start), then **restart the server**, then
  poll: it must return the flow's real status (`pending`), **not** 409. Capture the
  before/after log lines.
- With no flow at all, poll must return 409 `no_pending_flow`, and the UI must end
  the wait with the restart state (screenshot under
  `/home/menisy/.hermes/cache/scratch/h28-shots/`).
- Run the backend test suite and report the real pass count.

Do not commit, stage, or stash. Do not leave the dev server stopped when you
finish — restart it and confirm `GET /` is 200. Report real output only.
