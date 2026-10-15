# H21c — the opencode tab must show the REAL button (authorize), not import

The owner, looking at the widget's opencode tab: **«شيل الزرار دا وحط الزرار الصح
بقا»** — pointing at the red **«استيراد من تسجيل الجهاز»** button. They want the
authorization button there.

## Context (do not re-derive it)

- The backend lane is implementing the **real device flow** in
  `POST /api/v1/assistant/subscription/start` (returns the device code +
  verification URL + expiry/interval) and
  `POST /api/v1/assistant/subscription/poll` (polls; on success stores the
  credential and returns the linked config + the model list). Endpoints already
  exist and are already wired to this panel; only their internals were wrong.
- The i18n keys already exist in `frontend/src/i18n/dict.ts`:
  `assistantSubLoginButton` («تسجيل الدخول للاشتراك», line ~1016),
  `assistantSubImportButton`, `assistantSubImportHint`, `assistantSubImportPrimaryHint`.
- Import works today and must stay reachable (verified live: import →
  `status: linked`, `model: glm-5.3-flash`, `POST /assistant/test` →
  `{"ok": true, "latency_ms": 967}`).

## Change (frontend only — `src/features/assistant/AssistantSettingsPanel.tsx`)

1. **Primary action on the opencode (and Codex) tab = authorize**: a prominent
   button using `assistantSubLoginButton` that calls
   `POST /api/v1/assistant/subscription/start`.
2. On the response, show **the code and the verification link** clearly
   (monospace, copyable, RTL-safe — the code and the URL must be LTR islands),
   plus a live "waiting for your approval…" state while polling
   `POST /api/v1/assistant/subscription/poll` on the interval the server returns
   (fall back to ~3s, stop after the server's expiry, and show a retry).
3. On success: show **linked** + the subscription model list, exactly like the
   existing linked state (model select + «تحديث الموديل»). On failure/expiry: a
   clear Arabic message and the button again.
4. **Demote import to a secondary control** under the primary button — small,
   with the existing honest hint (`assistantSubImportHint`) that it reads the
   CLI's local login. Keep it working.
5. Keep the markdown rendering, the transcript, the confirmation card, the
   launcher states, and the api-key tab as they are.
6. No `dangerouslySetInnerHTML`; no new dependency for this.

## Prove it

- `npm run build:demo` (must pass `tsc -b`) and `npm run lint`.
- A probe against `http://192.168.1.19:8080` that opens `/profile`, clicks the
  opencode tab, and asserts the **primary button is the login/authorize one**
  (by its Arabic label) and that the import control is secondary — screenshot it
  under `/home/menisy/.hermes/cache/scratch/h21-shots/` (real file, real size).
- If the backend's `start` is not yet returning a code, drive it with a stubbed
  fetch for the UI proof and say so plainly in your report.

Do not commit, stage, or stash. Report real output only.
