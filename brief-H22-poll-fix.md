# H22 — the poll endpoint rejects the flow it started (owner is blocked)

The owner authorizes in the browser and the widget bounces straight back to
"subscribe again". Reproduced live, verbatim:

```
POST /api/v1/assistant/subscription/start  {"provider":"opencode"}
→ {"provider":"opencode","user_code":"FPMP-XFLF","interval":5,"expires_in":600,
   "verification_uri":"https://opencode.ai/console/device?user_code=FPMP-XFLF&client_id=opencode-cli"}   ✓ correct

POST /api/v1/assistant/subscription/poll   {}                     (what the panel sends)
→ {"error":{"code":"unknown_provider","message":"Choose opencode or codex."}}    ✗ BUG

POST /api/v1/assistant/subscription/poll   {"provider":"opencode"}
→ {"data":{"status":"pending"}}                                  ✓ correct
```

So the flow itself is right and the device code is real — **the poll just
demands a `provider` the client does not send**, even though the server already
knows which flow it started for this user (it answered `pending` for the right
account).

## Fix

1. **Make `poll` work without the body's `provider`**: use the pending flow the
   server started for the requesting user (it already persists it — that is why
   `pending` came back for the correct user). If no flow is pending, return a
   clear, actionable error (`no_pending_flow` + Arabic message), not
   `unknown_provider`.
2. Keep accepting an explicit `provider` when it matches the pending flow; if it
   **contradicts** it, prefer the pending flow and say so in the response — never
   silently start or abandon another.
3. Same treatment for any other subscription endpoint that requires a provider it
   can already infer (`models`, `import` are fine as-is).
4. Do **not** weaken auth: the flow must stay bound to the user who started it —
   another user's poll must not link anything.
5. Keep `pytest -q accounts/test_assistant.py accounts/test_assistant_subscription.py`
   green (currently **55 passed**) and add a regression test: `poll` with an empty
   body after a `start` for that user returns `pending`, and after the flow
   expires returns the actionable error.
6. Restart the server and report the new pid; then prove it live: `start` →
   `poll {}` (must be `pending`, not an error) → paste both real responses.
   Do not commit, stage, or stash.
