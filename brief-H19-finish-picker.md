# H19 — FINISH ONLY the widget UI (the picker + the subscription panel)

A previous run built the API layer and stopped before the UI. Do **not** redo it.

**Already done and valid (`npx tsc -b` = 0) — use it, don't rewrite it:**
- `frontend/src/app/assistantApi.ts` — 9 subscription functions (start / poll /
  import / models / …). Read it first; it defines the exact request and response
  shapes. If a shape is missing something the UI needs, extend it minimally.
- `frontend/src/i18n/dict.ts` — the Arabic/English labels for «اشتراك» exist (4
  hits). Add only what is genuinely missing, in **both** language blocks.
- The backend is **live** on `http://192.168.1.19:8080` (migration `0008`
  applied, server restarted): `assistant/subscription/{start,poll,import,models}`
  all exist (`assistant/config` returns 401, not 404).

**What is missing — the whole job:**
`frontend/src/features/assistant/AssistantSettingsPanel.tsx` (the employee widget
on `/profile`) and `frontend/src/features/assistant/EmployeeAssistantPanel.tsx`
(HR's panel in the employee file) must each get, **at the top of the assistant
card**, a three-way mode picker:

- **«مفتاح API»** — today's fields exactly as they are now (base URL + model + key
  + Test + Save).
- **«اشتراك opencode»** / **«اشتراك Codex»** — replaces those fields with:
  a **login button**, a state line (unlinked / waiting for approval / linked), the
  **code + link** the server returns while a device flow is pending, and once
  linked a **model dropdown** from the subscription's own model list. Offer the
  **import** action too (the owner's machine already has an `opencode-go`
  credential — importing it is what makes this demonstrable today) and say plainly
  in the UI which source the credentials came from.
- **Never render a token or key**: no "view"/"reveal" affordance anywhere, and the
  linked state shows only the account/model identity.
- Keep the launcher's behaviour untouched: while nothing is linked it stays faded
  with the existing hint (the server owns that flag — do not bypass it).

## Verify and prove (real runs only)

1. `npm run build:demo` (must pass `tsc -b`) and `npm run lint`.
2. A probe (extend `frontend/scripts/probe-h18-afaf-assistant.mjs` or add a
   sibling) against `http://192.168.1.19:8080` with a fresh HR signup (code
   `Menisy2002`; note a fresh session lands on `/onboarding/company` first, so
   fill the four required company fields — name/activity/address/phone — to get
   into the app), printing one line per check:
   - the picker shows the three modes;
   - choosing a subscription hides the API-key fields and shows the login action;
   - pressing import/link reaches the server (assert on the server's response,
     not just the UI text);
   - no token appears anywhere: `document.body.innerText` must not contain it;
   - the launcher is still faded while nothing is linked.
3. Screenshots under `/home/menisy/.hermes/cache/scratch/h19-shots/`: the picker,
   a subscription mode selected, and the linked state with the model dropdown.
4. Report the real command output. Never fake a result or a screenshot; if a check
   cannot run, say exactly which and why. Do not commit, stage, or stash anything.
