# H25 — the codex IMPORT hangs forever (must time out and answer)

Reproduced live, twice, against the running server:

```
POST /api/v1/assistant/subscription/import  {"provider":"codex"}   (valid session + CSRF)
→ HTTP 000, time_total 60.0s   (curl timed out — the endpoint never answered)
```

The same endpoint for `opencode` answers immediately and links. So the codex
import path is making an outbound call (the token refresh against OpenAI, most
likely) with **no timeout** and blocking the request thread.

## Fix (backend)

1. **Every outbound HTTP call gets an explicit timeout** (connect + read, e.g.
   10s/20s total) — no unbounded waits anywhere in the subscription/import path.
2. The import must **always answer**: success, or a clear actionable error
   (`{"code":"codex_import_failed","message":…}` with the provider's status) —
   never a hang, never a 000.
3. If the refresh is genuinely slow, do not block the request: import what is
   valid now and mark the link for refresh (or refresh in the background with a
   status the panel can poll) — the panel already handles a broken link by
   fading the launcher with a hint.
4. Keep the opencode path working exactly as it is (verified: import → `linked`,
   `model: glm-5.3-flash`, `test` → `{"ok": true, "latency_ms": 967}`).
5. Keep the suite green (63 passed currently) and add a test with a stubbed
   slow/never-answering provider: the import must return a clear error inside the
   timeout, not hang.
6. Restart the server, report the new pid, and prove it: `import {"provider":"codex"}`
   → a real HTTP status + body **within a few seconds** (paste both). Also paste
   `POST /assistant/test` for codex.

Do not commit, stage, or stash. Report plainly what still fails.
