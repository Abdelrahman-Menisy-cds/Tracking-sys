# H19 — frontend: the subscription picker and login panel (مدام عفاف)

The owner asked: "فين زرار اني اربط الاشتراك بتاعي سواء اوبن كود جو ولا كودكس" — the
assistant widget today offers **only** the API-key fields, so there is nothing to
press for a subscription.

**Read these two first — they are the contract, do not invent a second one:**
1. `.hermes/plans/h19-subscription-login.md` — the backend's plan for this story.
2. `brief-H19-subscription-login.md` — the requirement, the measured credential
   shapes, and the backend's rules.

The backend half is **in flight in another lane right now**: it is adding a
subscription mode to `AssistantConfig` (migration `0008`), the login/refresh
endpoints, and the tests. Implement the UI against the plan's endpoints; if the
plan names them differently by the time you look, follow the plan, and say so in
your report.

## What to build (in the existing widget — do not redesign it)

- `frontend/src/screens/profile/AssistantSettingsPanel.tsx` (the employee's
  `/profile` widget) and `frontend/src/features/assistant/EmployeeAssistantPanel.tsx`
  (HR's panel inside the employee file) both get a **mode picker** at the top:
  **«مفتاح API» / «اشتراك opencode» / «اشتراك Codex»**.
  - «مفتاح API» keeps today's fields exactly as they are.
  - A subscription mode replaces them with: a **login button**, a state line
    (unlinked / waiting for approval / linked), the **code + link** the server
    returns while a device flow is pending, and — once linked — a **model
    dropdown** fed by the subscription's own model list. If the backend's import
    path is what links it (the owner's machine already has an `opencode-go`
    entry), show plainly which source the credentials came from.
  - When linked, show the **account/model** identity only — **never a token**.
    There is no "view key" affordance anywhere.
- While a subscription is unlinked, the launcher must stay **faded** with the
  same hint it shows today (the backend owns that flag — just do not bypass it).
- Every new label in `frontend/src/i18n/dict.ts`, Arabic **and** English.
- Keep the existing green checks green: the launcher, the hint, the chat, the
  confirmation card, and the key-hint behaviour are already verified — do not
  regress them.

## Verification

- `npm run build:demo` (must pass `tsc -b`) and `npm run lint`.
- Extend `frontend/scripts/probe-h18-afaf-assistant.mjs` — or add a sibling
  probe — with checks, one printed line each, against the running app at
  `http://192.168.1.19:8080` (fresh HR signup, code `Menisy2002`, and remember a
  fresh session lands on `/onboarding/company` first):
  1. the picker shows the three modes;
  2. choosing a subscription reveals the login affordance and hides the API-key
     fields;
  3. a linked subscription shows the model dropdown and **no** token anywhere in
     the DOM (`document.body.innerText` must not contain it);
  4. the launcher stays faded while unlinked.
- Screenshots under `/home/menisy/.hermes/cache/scratch/h19-shots/`: the picker,
  a subscription mode selected, and the linked state with the model dropdown.
- If the backend endpoints are not live yet, retry with backoff for up to ~20
  minutes, then report exactly which check could not run. Never fake a result or
  a screenshot. Do not commit, stage, or stash anything.
