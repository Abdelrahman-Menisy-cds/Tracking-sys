# H21b — finish the in-app opencode authorization (the endpoints are now KNOWN)

The previous run discovered the real flow and ran out of turns before finishing.
Do **not** search again from scratch — it already established:

- Device-code start: `https://opencode.ai/console/auth/device/code`
- Device-code poll/exchange: `https://opencode.ai/console/auth/device/token`
- It is a genuine **device flow** (the log is full of `device`/`oauth`/`zen`/
  `auth.json`): the app shows a code + link, the user approves in the browser,
  the server polls and receives the credential — which ends up stored as a
  **key** under `opencode-go` in `~/.local/share/opencode/auth.json` (measured).
- Its session (for reference, do not resume it): `20261012_012625_8c099a`.

**Your job: make the widget's opencode button do that flow and link immediately.**

1. Re-read opencode's own source for the **exact** request bodies, headers
   (client id / user agent / content type), and the response field names for both
   calls — a wrong field name is the whole failure mode. Cite the file/URL you
   read it from.
2. Implement it in the existing subscription endpoints (they already exist and are
   wired to the UI): `POST /api/v1/assistant/subscription/start` must return the
   code + verification URL + expiry, and `POST /api/v1/assistant/subscription/poll`
   must poll, and on success **store the credential encrypted** (existing
   `subscription_ciphertext` + `subscription_provider=opencode` +
   `subscription_source`, hint masked — never the raw value anywhere) and make
   `POST /api/v1/assistant/test` return `ok: true` through it.
3. **Keep the import path** — it works today (verified: import → `linked`,
   `model: glm-5.3-flash`, `test` → `{"ok": true, "latency_ms": 967}`).
4. Prove it with real output: the real device-code response (paste the code +
   URL), the poll while pending, and the success path with a **stub** approval if
   the real one needs the owner's browser — then tell the owner exactly what to
   press. Keep `pytest -q accounts/test_assistant.py
   accounts/test_assistant_subscription.py` green (currently **50 passed**) and
   add tests for the flow.
5. Restart the server after the change and report the new pid + the command.
   Do not commit, stage, or stash. Report anything that cannot work, plainly.
