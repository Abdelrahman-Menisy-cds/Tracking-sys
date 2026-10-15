# Brief H2 — the «تايم شيت» tab: time logged on tasks, with filters

Runs AFTER brief H1, which is committed as **`7f8ec44`** on the main line — it added the timer on the task detail page, the pure module `src/mock/taskTime.ts`, the panel `src/components/tasks/TaskWorkPanel.tsx`, the store in `AppContext.tsx` (session-scoped `sessionStorage`, key `tracking-sys.task-time`), the trail events in `TaskTimeline.tsx`, and the gate `scripts/verify-task-time.ts`. **Read that commit's actual implementation before writing anything** — use the store, the entry shape and the helpers it created, do not invent a parallel one.

The product owner, having asked for the timer:

> "and the timesheet tab should then show ONLY the tasks with the time I spent on them, and I can filter by task name, or today, or this week, or this month, or a specific range — and of course by employee too if I'm a manager."

He chose: **a new «تايم شيت» tab inside the tasks page** (`/tasks`, beside مهامي / مهام أنشأتها). The existing `/timesheets` page is the ATTENDANCE timesheet (days + minutes + breaks) — **leave it completely alone**.

## The tab

- Add a fourth tab to `TasksPage.tsx` (`TaskTab` is currently `"needs" | "mine" | "created"`). Label it from an i18n key (add `taskTabTimesheet` and its siblings to both the AR and EN blocks of `src/i18n/dict.ts` — the file is a serialization point, append, do not reorder).
- Render it for any identity that can see time: an **employee sees their own** logged time; a **manager** sees the team's and gets the employee filter. Do not render the tab for an identity with nothing to show.
- **Show ONLY tasks that actually have logged time.** A task with zero entries must not appear — that is the owner's explicit word («بس التاسكات بالوقت الي قضيته فيها»).
- Columns: the task title (linking to `/tasks/:taskId`) · the employee (manager view) · the logged duration formatted like the rest of the app · the date(s) it was worked. Include a **total for the current filter** — that is the number the owner will read first.
- Honest empty states, in both locales: nothing logged yet at all, versus nothing matching the current filter. They are different messages.

## The filters

- **Task name** — a text filter over the task title.
- **Period** — today · this week · this month · a custom range (from/to). A single segmented/select control, not four separate widgets.
- **Employee** — manager (and HR) only; absent for an employee, who is already scoped to themselves.
- Changing a filter must update the rows and the total together.

## Make the window boundaries a pure, testable module

Put the range maths in its own module and import it from the gate — do not inline `new Date()` arithmetic in the component.

- **The week starts SATURDAY** (the Egyptian working week). Define it as one named constant so changing it is a one-line edit, and assert it in the gate.
- Boundaries are computed in the app's local timezone, and `today` means the local calendar day, not "the last 24 hours".
- A range is **inclusive of both ends**.

## What to prove (deterministic gate, exit non-zero on failure)

Add a committed script alongside `scripts/verify-task-capabilities.ts` and `verify-prayer-triggers.ts`, run with the same `npx tsx` invocation, asserting the REAL imported functions:

1. `today` window: an entry at 00:00 local is inside; an entry one minute before local midnight yesterday is outside.
2. `this week` starts Saturday: an entry on Saturday is inside; the Friday before is outside.
3. `this month`: the 1st at 00:00 is inside; the last day's 23:59 is inside; the day before the 1st is outside.
4. A custom range is inclusive at BOTH ends.
5. An interval that crosses midnight is counted once, in full, and lands in the day it STARTED (state the rule in the code comment and in the UI so the owner can disagree with it).
6. Tasks with zero entries are excluded from the rows; the total is the sum of the included entries only.
7. The employee filter narrows to one person and the total follows; with no filter, a manager's total is the sum across employees.
8. The total is unchanged by re-sorting or by changing the task-name filter to something that matches everything.

Then measure in the browser against `http://192.168.1.19:8000` and print the raw readings:
- As the employee: log two intervals on two different tasks (use the H1 timer), then open the tab and show the rows, the per-task durations and the total.
- Show a task with NO time is absent from the rows.
- Switch the period filter across today / this week / this month / a custom range and print the row count and total for each — and prove a custom range that excludes the entries yields an empty state rather than a stale total.
- As the manager: show the employee filter is present, that it narrows the rows, and that the total follows.

## Environment notes that will save you a cycle

- `Input.dispatchMouseEvent` does NOT drive this app (the lead's control experiment clicked a known-good nav link and the route did not change). Drive controls with real DOM clicks from `Runtime.evaluate`; for a controlled checkbox use the native setter plus `click` + `change`, asserted in a SEPARATE evaluation. A toast stack accumulates — read the NEWEST child if you measure one.
- Serve on a port you have CONFIRMED free (`ss -ltn | grep <port>`) and compare the served bundle filename against your own `dist/` — **8210 is held by another process**, and a server that fails to bind dies silently while its wrapper still reports a session.
- Sign in against `http://192.168.1.19:8000` (it serves the current build) or rewrite `Origin`/`Referer` in any proxy — a mismatched origin gets a bare 403 the UI reports as «البريد الإلكتروني أو كلمة المرور غير صحيحة».
- The demo ships three sign-in identities only (`e1` employee, `m1` manager, `hr1` HR).
- Run with `--max-turns 400`. Commit and report the hash.

## Constraints

- **No new npm dependency** (`package.json` untouched).
- `tsc -b` clean, `npm run build:demo` exit 0.
- Do not touch the prayer lane or `/timesheets` (attendance). `dict.ts` and `AppContext.tsx` are serialization points — append in one contiguous block, do not reformat the rest.

## Report

Files changed, exact commands and their real output, the measured row counts and totals per filter from the browser, the week-start rule as you implemented it, what you could not verify, and any decision the brief left open.
