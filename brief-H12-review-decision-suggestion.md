# Brief H12 — a workload-based decision suggestion for the manager review queue

You have **full permissions** (`--yolo`). Work autonomously; commit progressively; do not stop to ask.

## What the owner asked for (their words)

> عاوزك تضيف هنا اقتراح من الai عشان يساعد المدير في اتخاذ القرار بناءا على جدول الموظف والمؤسسه من حيث workload

"Add a suggestion **here** (the team-reviews screen) that helps the manager decide, based on the
employee's and the organisation's schedules **in terms of workload**."

They then chose, from options you must honour exactly:
- **Where:** inside the **decision dialog** (at the moment of deciding) **plus a small badge in the queue
  table row**.
- **What:** an **explicit recommendation** — «مقترح: اعتماد» style — with **2–3 reasons** and a
  **confidence level**, computed from **the schedule, the workload, and the coverage**.

## Ground truth about this codebase — read before designing anything

This is a **frontend-only demo with mock data**. There is no model and no backend call, so the suggestion
must be a **pure, deterministic, explainable function over the demo's own data**. That is fine — but the
UI must never imply a real AI service or a real authorisation. Every other panel in this product carries
that kind of disclosure; yours must too.

The data you actually have (verified in the tree — do not invent fields):

| Source | What it gives you |
| --- | --- |
| `src/mock/attendance.ts` — `attendanceSchedules`, `resolveScheduleFixture(employee, date, …)` | `scope: ORGANIZATION \| TEAM \| EMPLOYEE`, `target`, `working_weekdays`, `expected_start/end`, `expected_daily_minutes`, `grace_minutes` |
| `src/mock/attendance.ts` — `attendanceEvents` + `deriveAttendanceDays(events, employee, …)` | `AttendanceDay`: `work_date`, `worked_minutes`, `break_minutes`, `expected_minutes`, `status` (`PRESENT`/`ABSENT`/`LEAVE`/`HOLIDAY`/`REMOTE`/`INCOMPLETE`), `exception` (`LATE`/`EARLY_LEAVE`/`MISSING_CLOCK_OUT`) |
| `src/mock/attendance.ts` — the leave-balance fixtures | `leave_type`, `period`, `entitlement_days`, `carry_over_days`, `carry_over_cap_days`, used days → the **remaining balance** (the same numbers the balance editor shows) |
| `src/mock/data.ts` — `RequestMock`, `RequestTypeMock` | `requester_id`, `requester_name`, `request_type.name` (اعتيادية / مرضية / تصريح خروج …), `title`, `details`, `submitted_at`, `status` |
| `src/mock/data.ts` — the employee directory | the requester's identity and their team/department, for the coverage comparison |

**Important limitation to handle explicitly:** the requests carry their span in **prose**, not in
structured date fields (`title: "إجازة اعتيادية — 3 أيام"`, `details: "إجازة اعتيادية من الأحد إلى الثلاثاء…"`,
`"تصريح خروج ساعة واحدة ظهرًا"`). Put a small, **explicit pattern table** in the suggestion module that
maps the demo's request wording to a requested span (full days vs a part-day), with an honest `UNKNOWN`
fallback. **Surface the parsed span in the reasons**, so if the parse is wrong the manager sees it
immediately instead of trusting a bad number. Never guess silently.

## The module (pure logic — no React, no fetch)

`src/app/reviewSuggestion.ts` (import only what you need from `mock/`), exporting something shaped like:

```ts
export type SuggestionVerdict = "APPROVE" | "REJECT" | "REVIEW";   // REVIEW = needs a human look
export type SuggestionConfidence = "HIGH" | "MEDIUM" | "LOW";
export interface DecisionSuggestion {
  verdict: SuggestionVerdict;
  confidence: SuggestionConfidence;
  reasons: { kind: "SCHEDULE" | "WORKLOAD" | "COVERAGE" | "BALANCE"; textAr: string; textEn: string }[];
}
export function suggestReviewDecision(input: {...}): DecisionSuggestion
```

It takes the request plus the demo fixtures (schedules, the requester's derived days, the team's derived
days, the leave balances) and returns the suggestion. Put the **reasoning in the module and the wording
keys in `src/i18n/dict.ts`** (both locales — no hardcoded Arabic in the component, the H11 lesson).

### The signals (make each one produce a real number in the reason text)

1. **Schedule** — the requester's `EMPLOYEE` schedule vs the `ORGANIZATION` one: different
   start/end, different `expected_daily_minutes`, or a different `working_weekdays` set. Say what the
   difference is; it may argue either way.
2. **Workload** — the requester's `worked_minutes` vs `expected_minutes` over a stated trailing window
   (pick a window, state it in the reason), plus any `LATE` / `EARLY_LEAVE` / `MISSING_CLOCK_OUT`
   exceptions and `INCOMPLETE` days. A heavily loaded employee argues for the leave; a lightly loaded one
   does not.
3. **Coverage** — the team's days over the same window: how many are absent, on leave, or short, and how
   many are actually present. A team that is already thin argues against approving more time off.
4. **Balance** — for annual leave, the remaining balance vs the parsed requested days.

### The verdict rules (deterministic — the gate will assert exactly this)

Write the rule weights **explicitly in code** so they are reviewable, and derive `confidence` from how
strongly the signals agree (e.g. all three point the same way = `HIGH`; mixed = `LOW`). Never return
`APPROVE`/`REJECT` when the signals genuinely conflict — return `REVIEW` with the conflict named as a
reason. **A healthy employee with balance and a solid team must produce APPROVE; a heavily loaded
employee with no balance, or a team with almost nobody present, must produce REJECT** — assert both in
the gate.

## The UI

1. **Inside the decision dialog** (`TeamReviewsPage.tsx`, the `decision-facts` block above the
   approve / return / reject buttons — this is "here"): a distinct block, visually an advisor, not a
   verdict banner:
   - a heading («اقتراح ذكي» — and an honest one-line note that it is **computed from the demo data and
     is not a decision or an authorisation**; the product's disclosures are your tone reference);
   - the recommendation («مقترح: اعتماد» / «مقترح: رفض» / «مقترح: مراجعة يدوية») with a confidence marker;
   - the 2–3 reasons, **each carrying its real numbers** («العبء آخر ١٤ يومًا: 62 ساعة مقابل 56 متوقعة»).
2. **A compact badge in the queue table row** — a small pill in a new «اقتراح» column (or beside the
   existing status if the table cannot take another column without crowding): the verdict only, with the
   reason available on the dialog. Handle the mobile record block (`MobileRecordBlock`) the same way the
   other columns do.
3. **Do not** pre-select a decision button, change the button order, or auto-fill the comment. The manager's
   action stays exactly as manual as it is today.

## Hard constraints

1. **Presentation + one pure module only.** No backend, no network, no new dependency, no timer.
2. **Keep every existing `data-testid` / id**, and all 11 existing gates passing unmodified in intent.
3. **The app must be bidi-safe**: the new strings mix Arabic with digits, which is exactly the class H11
   fixed. `node scripts/probe-bidi-render.mjs http://192.168.1.19:8080` must still report
   **`مقلوب 0`** — and since the suggestion lives in a **dialog**, extend that probe (or add a sibling one)
   so it **opens the dialog and audits its text too**; a portal may render outside `main`, so do not
   assume the current walker sees it. Prove the dialog's strings are measured.
4. No new colours or visual language — reuse the existing tokens/classes.
5. Stay inside `frontend/`. Do not touch `backend/`, `docs/`, `*.pdf`, `.claude/`, `.agents/`, `.hermes/`.
6. Both locales (ar + en) and RTL/LTR must work; the Spanish… no — only `ar` and `en` exist.

## Acceptance — real output only

1. A new gate `scripts/verify-review-suggestion.ts` that asserts the pure function: determinism, the
   approve case, the reject case, the conflict → `REVIEW` case, the `UNKNOWN` span fallback, and that every
   reason carries a number. Paste its real output.
2. All gates (`for g in scripts/verify-*.ts; do npx tsx "$g"; done`), `npx tsc -b`, `npm run build:demo`.
3. The bidi probe still `مقلوب 0`, including the dialog's text, on the freshly built demo.
4. A real browser check of the dialog and the row badge, **both locales**: paste the actual rendered text
   of the suggestion block (heading, verdict, confidence, reasons) for one request, and say what each
   number came from.
5. State plainly anything you could not do.

## Commits

Commit progressively — the module + gate first, then the dialog block, then the row badge — so a partial
run leaves a coherent tree. Commit only files this brief produces.

## Report

With real output: which signals fired for each of the three pending requests on the demo (there are three),
and why the verdict differs between them; the gate's output; the probe's output; all gates + tsc + build;
which files you touched; anything unfinished, named.
