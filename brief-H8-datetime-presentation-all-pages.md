# Brief H8 — one date/time shape on every page (presentation only)

You have **full permissions** (`--yolo`). Work autonomously; commit progressively; do not stop to ask.

## What the product owner asked

> «عاوزك تظبط طريقه عرض الوقت والتاريخ في كل الصفحات»
> — fix the way time and date are DISPLAYED, on every page.

They were looking at the attendance screen and saw two things that do not match anything else:

1. An official-holiday entry renders its date as **«25 2026 ديسمبر»** — visually the year sits in the middle.
   It must read **«25 ديسمبر 2026»** in the Arabic locale (and `25 December 2026` in English). This is a
   bidi visual-order defect.
2. The current-schedule table row renders a raw ISO string **«2024-01-01»**, and its expected-hours cell
   renders **«17:00 – 09:00»** (24-hour + en dash) — while every other place on the site renders times as
   `h:mm AM/PM`. Both must come out in the same shape as the rest of the product.

## The canonical module already exists — this brief is about routing everything through it

`src/app/useMockList.ts` owns date/time formatting and is already the enforcement point of
`scripts/verify-datetime-format.ts`:

```
cairoDayIso(date)                     -> "yyyy-mm-dd" (a KEY, not for display)
formatDate(iso, locale)               -> DD/MM/YYYY, zero-padded, bidi-isolated
formatTime(iso, locale)               -> h:mm AM/PM, zero-padded, isolated
formatDateTime(iso, locale)           -> DD/MM/YYYY · h:mm AM/PM, isolated
formatDateLong(iso, locale)           -> 25 ديسمبر 2026 style (long month), isolated
formatWeekdayOf / formatWeekdayIndex  -> weekday names
weekInterval(start, locale)           -> "d MMM y – d MMM y"   <-- NOT isolated (bug)
formatMinutes(minutes, locale)        -> durations
isolated(value)                       -> LRI + value + PDI (private; the ONLY wrapping allowed)
```

`localeTag` is `ar-EG-u-nu-latn` (Arabic text with Latin digits) and every function is pinned to
`CAIRO_TIME_ZONE`. **The formatter already bidi-isolates its output.** So the correct call site adds
**nothing** around it.

## The defects to fix (all found by auditing the source — verify each yourself)

**A. Four different wrapping conventions around the same formatter output.** The formatter isolates, yet:

- `5` call sites wrap it in `<bdi dir="ltr">{format…()}</bdi>` — `TasksPage.tsx:156`,
  `TaskDetailBody.tsx:49,54`, `AdminOverviewPage.tsx:229`, `TaskTimeline.tsx:33`,
  `CreateTaskDialog.tsx:215`. `dir="ltr"` **overrides** the formatter's isolation and forces an LTR
  paragraph direction on a locale-aware string — remove the wrapper.
- `3` call sites use a bare `<bdi>` — `TeamReviewsPage.tsx:433`, `TaskTimeline.tsx:33`,
  `components/record/Timeline.tsx:35` — same problem, milder.
- `7` call sites use no wrapper at all — `NotificationsPage.tsx:109`, `MyTimesheetsPage.tsx:33`,
  `MyRequestsPage.tsx:30,31`, `TeamReviewsPage.tsx:109,135,310`, `TaskWorkPanel.tsx:136,138` — these are
  already correct; do not add anything to them.

**Target: exactly one convention — call the formatter, add no wrapper.** Where a dimension genuinely needs
a direction (e.g. a time range with an arrow), the formatter must emit it, not the call site.

**B. `weekInterval` is the one formatter that forgets to isolate**, and it is the range shape
(`… – …`). Fix it (isolate the whole range), and audit every other range/two-date rendering — the
schedule's expected hours and `AdminOverviewPage.tsx:229` (`formatTime(a) → formatTime(b)`) are the same
class. Add the canonical range helpers the call sites actually need (e.g. a
`formatTimeRange(fromIso, toIso, locale)` and a date-range equivalent) instead of letting each page
concatenate its own dash, arrow or separator.

**C. Raw ISO leaking to the screen.** `2024-01-01` in the schedule table is a raw storage value being
printed. Find every place a display surface renders an ISO/`yyyy-mm-dd` string directly (the schedule
editor's effective-from row, and anything else your audit finds) and route it through the canonical
formatter. Note: `AdminOverviewPage.tsx:67` compares `event.occurred_at.slice(0, 10)` — that is LOGIC, not
display; leave it alone.

**D. The bidi visual-order bug in (1) above.** Reproduce it in a real browser first — the Arabic holiday
date — then fix it so the day, the month NAME and the year read in that order visually. A bare
`day month year` string under RTL context is what breaks; the fix belongs in the formatter (isolation
around sub-runs), never in a page. Check the same class for `weekInterval`, the weekday+date lines
(`AdminSettingsPage.tsx:39,42`), and profile/announcement validity lines.

**E. Long vs short date usage.** `formatDateLong` (month name) is used by `ProfilePage.tsx:36` and
`AdminSettingsPage.tsx:39` while `formatDate` (numeric) is used by tables. Decide and document the rule:
lists/tables/dense rows use the numeric shape, single-record detail surfaces may use the long shape — then
make every page obey it. Do not silently flip a page's shape; if you do change one, say so in the report.

**F. Times that are configuration, not instants.** The schedule's start/end are wall-clock config
(`"09:00"`, `"17:00"`), not timestamps. They currently print as 24-hour while real instants print as
`h:mm AM/PM`. Pick ONE presentation for the product (the product owner's complaint is that these two
disagree) and apply it to both — the config values through a canonical wall-clock helper, so the shape is
identical to `formatTime`'s. Say in your report which shape you chose and why.

## Hard constraints

1. **Presentation only.** Do NOT change any timestamp's VALUE, its time zone handling, any stored string,
   any comparison, any key (`cairoDayIso` and `slice(0,10)` are keys/logic — leave them), or any
   backend/fixture meaning. A date that reads `25/12/2026` today must still be the same instant tomorrow.
2. **Every format goes through `src/app/useMockList.ts`.** No `Intl.*`, `toLocale*`, `toISOString()` display
   paths, `padStart` hand-rolling, or template-built date strings anywhere else. If a shape is missing, ADD
   it to the module.
3. **Keep every existing `data-testid` and id.** All 11 gates and the lead's browser measurement depend on
   them.
4. **No new colors / visual language**; stay inside the approved tokens.
5. **All 11 gates must still pass** — and you will extend `verify-datetime-format.ts` (below).
6. Stay inside `frontend/`. Do not touch `backend/`, `docs/`, `*.pdf`, `.claude/`, `.agents/`, `.hermes/`.

## Extend the gate — it currently cannot see the real leaks

`scripts/verify-datetime-format.ts` only flags `Intl.*` / `toLocale*` outside the module. Add checks that
fail loudly on each defect class above, e.g.:

- no raw `\d{4}-\d{2}-\d{2}` literal rendered in JSX text or in a page's display string (allow the
  logic/key sites you document);
- no `<bdi>` / `dir="ltr"` wrapper around a canonical formatter call — the formatter is the only isolator;
- every formatter that composes a range/interval is isolated (assert `isolated(` is used in
  `weekInterval` and in any new range helper);
- the four locale-sensitive shapes (`formatDate`, `formatTime`, `formatDateTime`, `formatDateLong`) are the
  only date/time producers in `src/screens` and `src/components` — no page-local formatting;
- both locales still resolve every key the formatters need.

## Acceptance — verify per page, in both locales, in a real browser

The bug in (1) is a **visual order** defect, so a source-level check alone is not proof. Reproduce and
prove the fix by reading the rendered result on the affected pages (screenshots of the Arabic locale, or
per-sub-run x-coordinates via `Range.getClientRects()`), at minimum: the attendance/schedule + holidays
screen, the tasks list and detail, notifications, my-requests, timesheets, team reviews, profile, the admin
overview and settings. State the rendered strings you saw before and after for the two reported cases.

Then run and paste the REAL output:

- `npx tsx scripts/verify-datetime-format.ts` plus **all** gates
  (`for g in scripts/verify-*.ts; do npx tsx "$g"; done`)
- `npx tsc -b`
- `npm run build:demo`

## Commits

Commit progressively (the formatter module + its gate first, then the call-site cleanups in batches), so a
partial run still leaves a coherent tree. Commit only files this brief produces.

## Report

With real output: the audit table (every date/time render site → which shape and which function it now
uses, and the ones you deliberately left as logic); the before/after rendered strings for the two reported
defects; the choice you made for config times and for long-vs-short dates; the extended gate's result; all
gates, `tsc`, the build; and anything you did not finish, named rather than hidden.

The lead will re-read the rendered dates in both locales on every page they can reach, so make the visual
order actually correct, not just the source.
