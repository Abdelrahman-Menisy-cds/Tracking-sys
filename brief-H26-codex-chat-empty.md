# H26 — the codex chat returns an empty reply (test passes, chat is blank)

Verified live against the running server (localhost:8080), fresh HR signup,
`import {"provider":"codex"}` → `status: linked`, `model: gpt-5.6-luna`,
`cred_type: oauth`:

```
POST /api/v1/assistant/test → {"ok": true, "latency_ms": 1402, "detail": "connection ok"}   ✓
POST /api/v1/assistant/chat {"messages":[{"role":"user","content":"عايز آخد يوم إجازة اعتيادي بكرة"}]}
   → {"reply": "", "pending_action": null, "tool_trace": []}                              ✗ EMPTY
```

The same chat through the **opencode** subscription works and calls tools
(`read_request_types` → `create_request`) — so the transport/credential is fine
for codex and something in **how the codex model is called or parsed** yields an
empty string.

## Fix (backend)

1. Find out where the empty reply comes from — the codex model is `gpt-5.6-luna`
   through the ChatGPT/Codex backend, which is **not** the plain OpenAI
   chat-completions shape (it is the Responses-style API). Log/compare the raw
   upstream body for both providers in a probe (never log credentials) and fix
   the request shape and/or the response extraction for codex.
2. The assistant must **never** return an empty reply: if the upstream body has no
   text, return an honest, actionable error (what the upstream said, minus any
   credential) — a blank bubble is worse than an error.
3. Keep opencode exactly as it is (verified: chat calls `read_request_types` →
   `create_request`, and the leave-balance question returns real numbers).
4. Keep the suite green (63 passed) and add a test for the codex chat path with a
   stubbed upstream body (empty + valid shapes).
5. Restart the server, report the new pid, and prove it live: import codex →
   `test` → `chat` with «عايز آخد يوم إجازة اعتيادي بكرة» and paste the real
   response (a real reply, or the honest error you implemented).

Do not commit, stage, or stash. Report plainly what still fails.
