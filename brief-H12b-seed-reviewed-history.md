# Brief H12b — READ `brief-H12-review-decision-suggestion.md` IN FULL FIRST, then this

The previous run stopped after 2m21s to report a limitation instead of finishing. The limitation was
**real** — I verified it in the fixtures myself — but it is **not** a reason to stop: it is fixable, and
fixing it is part of the job. Everything in H12 (design, module shape, UI, constraints, acceptance) still
stands; this file only resolves the blocker.

## The blocker, confirmed independently

`eventsForEmployee(employee, prefix)` in `src/mock/attendance.ts:194` is a pure generator that seeds **up to
20 working days** of history, complete with the patterns the suggestion needs: a no-event day
(`ABSENT_CANDIDATE`), a late arrival, an early departure, an unmatched clock-in (`INCOMPLETE`), and normal
two-block days. It is only ever **called** for the three demo identities — `e1`, `m1`, `hr1`
(`attendanceEventsByIdentity`, line 235).

The three queued requests in the review scope are from **`e2` (أحمد سعيد), `e3` (نور الدين) and `e4`
(سلمى فؤاد)** (`teamRequests` in `src/mock/data.ts:281`). Those employees have **no seeded history** —
only whatever today's directory observations give them — so `deriveAttendanceDays` returns almost nothing
and the workload/coverage signals have no numbers to report.

## What to do about it — seed the fixtures, do not weaken the feature

Extend the demo fixtures so the **reviewed team members have the same history** as the existing identities,
using **the existing generator** (`eventsForEmployee`, or whatever the app already uses to expose per-
employee events) wired exactly the way the current identities are wired. Then `deriveAttendanceDays` returns
a full window for `e2`/`e3`/`e4` and the suggestion computes real numbers.

Rules for this fixture change:
- **Do not** change `deriveAttendanceDays`, `resolveScheduleFixture`, `attendanceExceptionForEvent`, the
  formatters, or the schedule/leave-balance fixtures' semantics. You are adding *events for employees who
  lack them*, nothing else.
- **Do not** weaken or rewrite any existing gate assertion. All 11 gates must still pass as they are; if a
  gate asserts a per-employee day count that your fixtures change, and that assertion is about a *new*
  employee, extend the assertion — never relax an existing one.
- Make sure the reviewed employees also resolve to a **schedule** (`resolveScheduleFixture` falls back
  ORG → TEAM → EMPLOYEE; verify which one each of the three gets, and say so in your report) and have a
  **leave balance** row if you rely on balance in a reason. If a signal genuinely has no data even after
  seeding, **say so inside the reason text and lower the confidence** — that is an acceptable outcome.
- The demo's own honesty rules still apply: everything is derived from mock fixtures, and the suggestion
  block says so on screen.

## Do not stop to ask

This is **pre-approved**: the previous run ended because it wanted confirmation about sparse history. You
now have it. **Do not end the run to report a finding you can act on** — act, then report. The only
acceptable reasons to stop early are a hard blocker (a missing file, a refusing gate you cannot fix, an
environment failure) and you must name it explicitly if so.

## Finish the whole thing

Everything H12 asks for, end to end, committed progressively:

1. the fixtures seeded so `e2`/`e3`/`e4` have real history;
2. the pure suggestion module (`src/app/reviewSuggestion.ts` already exists on disk **uncommitted** from
   the stopped run, along with 34 new keys in `src/i18n/dict.ts` — review them, keep what is right, fix or
   replace what is not, and **commit**);
3. the suggestion block in the decision dialog;
4. the compact badge in the queue table row (and its mobile record block);
5. the new gate `scripts/verify-review-suggestion.ts`;
6. the bidi probe still reporting **`مقلوب 0`**, extended so it covers the dialog's text (it is a portal —
   do not assume the current walker sees it);
7. all gates + `npx tsc -b` + `npm run build:demo`;
8. a real browser check, **both locales**.

## Report

Per H12, plus specifically: which schedule each of the three requesters resolves to; how many days of
history each now has; the exact numbers behind every reason shown for each of the three requests; the raw
gate/probe/tsc/build output; and anything still missing, named.
