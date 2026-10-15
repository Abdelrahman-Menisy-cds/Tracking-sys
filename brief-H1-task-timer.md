# Brief H1 — the task detail page gets a status control and a real timer

The product owner, looking at `/tasks/t-6001` (the task detail page):

> "there must be a button here to change the task's status, and also a button so I can start counting the time I spend on the task — when I press it a timer counts up in front of me, and a button to end it and save the time onto the task. And of course I can start and stop the time more than once until I make the task done."

Two features, both on the detail page. **The timesheet view is a SEPARATE follow-up — do not build it now**, but design the store so it can later be filtered by task, by employee, and by date range.

## 1. Status control

- `TaskStatus` already exists: `"OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED"` in `src/mock/tasks.ts`. Use it — do not invent a new type.
- The detail card shows the status as a read-only badge today. Add a control that changes it, using the app's existing segmented-control pattern (`.role-segmented` with `role="radiogroup"` and `button[role=radio]` + `aria-checked`, the same one the login role picker and the capability flags use) — not a new widget style.
- **Every change appends a trail event.** The page already renders «سجل المهمة / Task trail (who did what)»; a status change must appear there with the actor and the from → to values, exactly like the existing `Assigned` event. The trail is append-only — never rewrite history.
- Who may change it: the **assignee** (they do the work) and the **creator or manager**. Anyone else gets no control. Follow the existing `TaskMutationResult` / `TaskMutationCode` contract (`CAPABILITY_DENIED`, `MISSING_RECORD`, `INVALID_INPUT`) rather than inventing a second error shape.

## 2. The timer

- A **start** control on the task → a **live elapsed display** that ticks (show `h:mm:ss`; update at least once a second). A **stop-and-save** control ends the interval and records it against the task.
- **Repeatable**: start/stop as many times as needed until the task is done. Each interval becomes its own entry; the task shows its **total** accumulated time.
- **Only the assignee** can run the timer for a task. A non-assignee must see no start control (and the mutation must still refuse if called).
- **Survive a reload.** Store the running interval's `started_at` timestamp and derive the elapsed from the wall clock — do NOT accumulate ticks, or a reload (or a throttled background tab) loses or drifts the time. After a reload the display must continue from the real elapsed time, and stopping must save the correct total.
- **One running timer per employee.** If the same person starts a timer on a different task while one is running, stop and save the current one first, and say so in the UI — silently running two timers at once would double-count their day.
- Storage follows the app's existing pattern: **session-scoped** (`sessionStorage`, key like `tracking-sys.task-time`), read/store helpers with `try/catch`, **nothing in `localStorage`**. Entry shape: `{ id, task_id, employee_id, started_at, ended_at, minutes }` — the later timesheet needs to filter on task, employee and date range, so keep those fields top-level and derive `minutes` from the two timestamps.
- The timer is **per employee** — two people working the same task each log their own time.

## 3. What to prove (deterministic gate, exit non-zero on failure)

Add a committed script (the repo already has `scripts/verify-task-capabilities.ts` and `verify-prayer-triggers.ts`; follow their shape and run it with the same `npx tsx` invocation) asserting the real imported logic, not a transcription:

1. Elapsed is derived from the timestamps: a started_at two hours in the past reports ~120 minutes even with no ticks delivered.
2. Two intervals on one task sum to the total; a task with no entries totals 0.
3. An interval that crosses midnight still records its full duration and is not split or lost.
4. A zero-length interval (start then immediately stop) records 0 and does not crash or produce a negative.
5. Starting a second timer for the same employee closes the first.
6. A non-assignee's start attempt is refused with `CAPABILITY_DENIED`.
7. Every status change produces exactly one appended event carrying from → to, and the earlier events are untouched.
8. Storage round trip: what the helpers write is what they read back; a malformed stored value does not throw.

Then measure in the browser against `http://192.168.1.19:8000` and print the raw readings:
- Sign in as the assignee, start the timer, wait ~20s, read the displayed elapsed twice a few seconds apart to show it is advancing, stop, and show the task's total and a new trail event.
- Do it a second time and show the total is the SUM of both intervals, not the latest one.
- Reload the page mid-run and show the elapsed continues from the real time rather than restarting.

## Environment notes that will save you a cycle

- `Input.dispatchMouseEvent` does NOT drive this app (the lead's control experiment clicked a known-good nav link and the route did not change). Drive controls with real DOM clicks from `Runtime.evaluate`; for a controlled checkbox use the native setter plus `click` + `change` and assert in a SEPARATE evaluation.
- Serve on a port you have CONFIRMED free (`ss -ltn | grep <port>`) and compare the served bundle filename against your own `dist/` — **8210 is held by another process**, and a server that fails to bind dies silently while its wrapper still reports a session.
- Sign in against `http://192.168.1.19:8000` (it serves the current build) or rewrite `Origin`/`Referer` in any proxy — a mismatched origin gets a bare 403 that the UI reports as «البريد الإلكتروني أو كلمة المرور غير صحيحة».
- `.notice-stack` is the prayer-notice container; a toast stack accumulates, so read the NEWEST child if you measure one.
- The demo ships three sign-in identities only (`e1` employee, `m1` manager, `hr1` HR).
- Run with `--max-turns 400`. Commit and report the hash.

## Constraints

- **No new npm dependency** (`package.json` untouched).
- `tsc -b` clean, `npm run build:demo` exit 0.
- Do not touch the prayer, timesheet or attendance lanes; `AppContext.tsx` is shared, so keep your additions in one contiguous block and do not reformat the rest of the file.

## Report

Files changed, exact commands and their real output, the measured elapsed readings from the browser, what you could not verify, and any decision you had to make that the brief left open.
