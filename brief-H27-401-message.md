# H27 — the widget shows «تعذر الاتصال بالخادم» when it is actually a 401

Found from the **running server's own request log** (Django, pid 65446), while the
owner kept pressing «إعادة المحاولة»:

```
Unauthorized: /api/v1/assistant/config
[12/Oct/2026 08:57:45] "GET /api/v1/assistant/config HTTP/1.1" 401 164
… repeated roughly once per second, for minutes
```

So: the request **reaches the server** and comes back **401** (no session / not
logged in) — but the widget renders **«تعذر الاتصال بالخادم. تحقق من الاتصال وأعد
المحاولة.»** (a network-failure message), which sent the owner chasing a network
problem that does not exist.

## Fix (frontend)

1. **Map 401 correctly**: an unauthenticated response must render an honest
   "سجّل دخول" state with a sign-in action — never «تعذر الاتصال». Reserve the
   network message for genuine fetch/network failures (TypeError, offline, no
   response) and for 5xx say the server is failing (with the status).
2. **Stop the per-second retry loop**: the panel re-requested `/assistant/config`
   about once a second indefinitely. Retries must be paced (backoff) and must
   **stop** on a terminal auth failure (401) until the user acts.
3. Show the **real status code** in the message for non-auth failures (e.g.
   «الخادم رجّع 500») — the current message hides the truth.
4. Keep everything else as it is (the login flow, the code/link, the cancel
   button, the import fallback, the markdown rendering, the api-key tab, no token
   ever shown).

## Prove it

- A probe against `http://localhost:8080`: with **no session**, load `/profile` and
  assert the panel shows the sign-in state (not «تعذر الاتصال») and that it does
  **not** re-request `/assistant/config` more than a couple of times in 15s
  (count the requests from the server log).
- Then with a valid session, assert the panel loads normally.
- Screenshots under `/home/menisy/.hermes/cache/scratch/h27-shots/`, plus the
  server-log lines proving the request counts.

Do not commit, stage, or stash. Report real output only.
