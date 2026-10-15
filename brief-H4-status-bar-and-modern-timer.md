# Brief H4 — the task status as a top bar, and a modern work timer

Two user asks on the task detail page (`frontend/`):

> «عاوزين نخلي حاله المهمه دي بار فوق ف اول الصفحه
>  ونخلي طريقه الوقت الي بيعد دا ومكانه وشكلهم يبقوا حاجه مودرن كدا»

## What exists today (verified by the lead)

- `src/screens/TaskDetailPage.tsx` renders, in order: `PageHeader` → `TaskDetailBody`
  (the facts) → `TaskWorkPanel` → the trail section → the assign action.
- **Both the status control and the timer live inside `src/components/tasks/TaskWorkPanel.tsx`**:
  the status is a `role-segmented` radiogroup (`data-testid="task-status-control"`, options
  `task-status-open|in_progress|done|cancelled`) around line 92, and the timer is a `decision-facts`
  `<dl>` around lines 113-144 (`task-timer`, `task-timer-elapsed`, `task-timer-total`,
  `task-timer-start`, `task-timer-stop`), followed by the entries list (`task-time-entry`).
- The design authority is `docs/design/premium-design-direction.md`. Read it first. Its rules bind
  you: **preserve the approved six color primitives** — build only from the existing tokens and
  primitives in `src/styles/global.css` (`--surface`, `--surface-subtle`, `--accent`, `--on-accent`,
  `--card-border`, `--focus-ring`, `--sp-*`, `--timeline-width`) and existing classes
  (`work-surface`, `role-segmented`, `page-meta`, `decision-facts`, `timeline`). **Do not invent
  colors, fonts, or a second card style.**

## 1. The status becomes a bar at the top of the page

- Lift the status control out of `TaskWorkPanel` into its own **top bar** rendered **directly under
  `PageHeader`**, above the facts — the first thing on the page.
- It must show, in one line: the current status as the prominent readout, and the four options as
  the existing segmented control (the `role-segmented` primitive), so changing status stays one
  click. Keep the hint text (`taskStatusControlHint`) available but do not let it bloat the bar.
- The bar should read as a **bar**, not a card: full-width, single row, aligned with the page grid,
  and it may stick to the top of the scroll container if that looks right on both desktop and
  mobile — your call, but it must not overlap the header or trap focus.
- Manager/assignee visibility rules stay exactly as they are: only identities with the capability
  see the options; everyone else sees the readout. The refusal path (`CAPABILITY_DENIED` → the
  `refused` banner in `TaskDetailPage`) must still work.

## 2. The work timer becomes modern

Judge it against the premium direction, not against a generic dashboard. Concretely:

- **Look**: a prominent work surface with the elapsed clock as the hero — large, monospace,
  **tabular numerals** (`font-variant-numeric: tabular-nums`) so digits do not jitter as they tick.
  Show the running state unmistakably (a live indicator, not just a changing number), and show the
  saved total as a clearly secondary figure beside or under it. The entries list stays, restyled to
  match.
- **Method**: one primary action that toggles between start and stop, with the current state
  obvious before you click. Keep every existing rule: only the assignee may run it, one timer at a
  time, the elapsed value survives a reload, intervals **sum** into the total, and a stopped timer
  is not "running".
- **Place**: put the timer card high on the page — directly under the status bar, above the facts —
  because it is the thing the user interacts with. Final order becomes:
  **header → status bar → timer card → facts → trail → assign action.** The trail must stay the
  **last** content section (a previous brief moved it there deliberately; do not undo that).

## Hard constraints

- **Keep every existing `data-testid`** — `task-status-control`, `task-status-*`, `task-timer`,
  `task-timer-elapsed`, `task-timer-total`, `task-timer-start`, `task-timer-stop`,
  `task-time-entry`, and the trail anchor `id="task-trail"`. Existing gates and the lead's live
  measurement depend on them. If you rename a class, keep the testid.
- **No new date/time formatting.** Every user-facing date or time goes through
  `src/app/useMockList.ts` (a previous brief made this a rule enforced by
  `scripts/verify-datetime-format.ts`, which scans the sources). Elapsed clocks keep using the
  existing `taskTimeFormatElapsed`. Do not reintroduce `Intl.DateTimeFormat` / `toLocale*` anywhere
  outside that module, and do not strip the `\u2066…\u2069` isolates.
- **Both locales and RTL.** Check `ar` and `en`, and a narrow (mobile) viewport. Numbers and clocks
  are Latin digits in both.
- Stay inside `frontend/`. Do not touch `backend/`, the fixtures' meaning, or files the user added.
- Keep the change scoped to this brief; no drive-by refactors.

## Acceptance — extend the gates and run them

Add or extend a `frontend/scripts/verify-*.ts` gate so it fails loudly on regression:

1. The status bar is rendered **before** the facts in the task page tree, and the trail is rendered
   **after** the timer card (assert statically from the source, or by rendering — your choice, but
   it must actually fail if the order changes back).
2. Every testid listed above is still present in the sources.
3. The existing `scripts/verify-datetime-format.ts` still passes untouched (its source scan included).
4. Any earlier gate (`scripts/verify-*.ts`) still passes.

Then run and paste the real output:
- `npx tsc -b`
- your gate(s)
- `npm run build:demo`

## Report

With real command output: what you changed, the gate results, `tsc`, the build, the final page
order, and any part of the ask you deliberately did not do (and why). If you made a judgment call
on placement or stickiness, say what you chose and what you rejected.
