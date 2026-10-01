# HR Administration Suite — Design Specification

Status: PROPOSED. Screens only; no code changed by this document.
Scope: `/admin` and its sub-views. Authored against the rendered demo build at `http://localhost:4173/admin` (inspected logged-in as `hr@cds.com`, dark theme, English), `src/screens/AdminPage.tsx`, `src/styles/global.css`, `src/components/ui.tsx`, `src/components/data/OperationalTable.tsx`, `src/components/data/MobileRecordBlock.tsx`, `src/components/layout/*`, `src/components/state/*`, `src/screens/AttendancePage.tsx`, `src/screens/MyRequestsPage.tsx`, and `docs/design/dark-mode-palette.md`.
All token names below are the real ones from `global.css` (`tokens.css` is only a pointer). Nothing in this spec requires a new color token.

---

## 0. Diagnosis of the current `/admin` (from the rendered page)

Verified against the live DOM and screenshots:

1. **One column, no navigation model.** Three unrelated responsibilities (org schedule form, leave balances + adjustment form, org attendance table) stack vertically inside a single `work-surface`. The attendance table alone is 20+ dense rows; the page is an unbounded scroll with no anchor points.
2. **Every field has identical weight.** Time, number, date, and note inputs all render full container width (`.field { margin-block-end: var(--space-6) }` with no grid), so a 2-character "Grace minutes" field is as wide as the working-days checkbox row. Nothing marks "current state" vs "what HR is editing" — the current schedule summary is a small `page-meta` line directly above an unstyled form.
3. **The table is a wall of repetition.** Every row today shows "Incomplete / Missing clock-out"; the status column carries zero information and no aggregate exists. There is no "today" scoping — history rows and today's snapshot are visually identical.
4. **Muscle memory problems in the mutation UI.** Two identical red "Save" buttons, both small, one for a schedule version change and one for a leave-balance ledger write — two very different risk classes that look the same.
5. **Four missing capabilities** (holidays register, AI-set-holidays, per-employee settings + employee file visibility tiers, announcements) have nowhere to live. Bolting them into the same column makes problem 1 terminal.

## 0.1 Guiding principles

- **Extend the existing language, don't import one.** Every surface reuses `.work-surface`, `.quiet-inset`, `.section-heading`, `.filter-toolbar`, `OperationalTable`, `StatusPill`, `Banner`, `Dialog`, `EmptyState`. New components are compositions of these, not new visual dialects.
- **"Modern" = hierarchy + density + calm.** The accent (`--accent`) stays scarce: primary action per section, nothing else. Tell → show → edit, in that order: every admin object is first read-only, then edited in a Dialog.
- **8 pt spacing scale only.** Allowed steps: `--sp-2` (8, inner gaps), `--sp-3` (12, field-to-field, chip gaps), `--sp-4` (16, control padding, card inner padding), `--sp-6` (24, section inner grouping), `--sp-8` (32, between major sections), `--sp-12` (48/64, page bottom). Nothing off-scale.
- **Structure:** the suite is one route `/admin` with **dedicated routes as sub-tabs** (nav within the page header), not one long page and not tabs that lose URL state.

### Navigation model (decision)

`/admin` renders a sub-navigation (horizontal `review-tabs`-style list, role="tablist" is avoided in favor of real routed links so each area is deep-linkable and back/forward works):

```
/admin            → Overview (today snapshot + health summary) — default
/admin/settings   → Organization settings (schedule, entitlement defaults? no — schedule + holidays)
/admin/people     → Per-employee settings (roster + employee file)
/admin/announcements → Announcements composer + history
```

- The rail keeps the single "Administration → /admin" link (no rail change needed; the router highlights it for all four sub-paths via the existing startsWith match).
- Sub-nav pattern: reuse the `review-tabs` visual (`.review-tabs` + border-block-end, `aria-current="page"` instead of `aria-selected`; `ChevronDownIcon`-free, text only). Each link is `min-height: var(--control-min-h)`.
- **Why not tabs (hidden panels):** the demo tools and QA flows deep-link to states; routed pages also preserve the "everything is reachable by URL" property the rest of the app has. **Why not master-detail (rail of employees beside a detail pane):** kills vertical space on mobile, and the app's compact mode (fixed rail drawer) has no concept of a second rail. **Why not one long page:** that is the bug being fixed.

Overview is a real page, not a redirect target stub: it answers "what needs attention today" and is the only place the org attendance snapshot lives in full width. Settings/People/Announcements link to it for cross-checks, never duplicate its data.

---

## 1. Organization settings — `/admin/settings`

Layout: standard `PageHeader` + one `work-surface` per concern; **two-column grid `dashboard-grid` on ≥768px**, single column below (the existing `dashboard-grid` collapses at 1023px — acceptable). Column order in RTL: schedule card on the visual right (inset-inline-start), holidays on the left (inset-inline-end).

### 1.1 Work schedule card

Anatomy (replaces the current bare form):

1. `section-heading`: h2 "Work schedule" + a `page-meta` line under the card title.
2. **Current schedule summary** — a `.quiet-inset` block listing the schedule **in force for today** (resolve the same way the app already does: highest `effective_from ≤ today`, not expired). Contents as a `dl.decision-facts`-style two-column list: working days (localized weekday names, `Intl.DateTimeFormat(locale, { weekday: "long" })`), expected start/end (each in `<bdi dir="ltr">`), expected daily minutes and grace minutes (`Intl.NumberFormat(locale)`), effective from → to (`<bdi dir="ltr">` ISO durations formatted via `Intl.DateTimeFormat(locale, {dateStyle:"medium"})`).
   This is the "what the org has today" layer. **It never carries edit affordances.**
3. **"Schedule versions" toggle** — a `btn-secondary` "Show schedule versions (N)" expanding a `.compact-list` of all schedules sorted by `effective_from` desc, each row: range, values, and the pill "In force" (`StatusPill` tone success) / "Upcoming" (info) / "Superseded" (neutral). No editing here; each row has an ghost "Open in editor" (a.k.a. load-into-editor) button.
4. **Editor** — opens via a `Dialog` (reuses `Dialog` with `dirty` flag, focus trap, Escape, confirm-discard exactly as `.ui.tsx` implements). Trigger `btn-primary` "New version" (or per-row "Edit"). Inside the dialog:
   - Working days: the existing 7-checkbox `fieldset.quiet-inset` group (unchanged markup, `aria-describedby` a hint that at least one day is required).
   - Times: `input type=time dir="ltr"`, **paired in one row** (`grid-template-columns: 1fr 1fr`, 2-column `.form-grid` fragment) — start next to end, because they are one fact split in two. Minutes and grace in a second 2-column row.
   - Effective from/to: third 2-column row; "to" labeled "(optional)".
   - Validation identical to the existing rules (start<end over the same day, ≥1 weekday, non-negative integers, from ≤ to), but errors render inline as `.field-error` per field (`aria-invalid`, `aria-describedby`) plus an error `Banner role="alert"` above the whole form that lists the fields and focuses the first invalid input — this replaces today's single flat banner.
   - Primary submit: `btn-primary` "Save schedule". The dialog's pending/confirmed/denied mutation lifecycle is §5.
   - **Change-preview line inside the dialog**: before submit, a non-editable summary "Will create schedule Y for (from → to). Earlier schedules remain as history" using the `attention-strip` styling in accent-soft — shows delta without blocking submission.
   - Keyboard: checkboxes are native (Space toggles), dialog focus is trapped by `Dialog`, first invalid field is focused on error, Enter submits.

RTL/LTR: weekday names localize; **times, ISO dates inside `<bdi dir="ltr">` are not remirrored**; the checkbox order is logical (0..6), not visual.

States: loading = `SkeletonRows rows={2}` inside the card; empty (no schedule at all) = editor auto-opens with defaults filled (this is first-run); error = `ErrorState` with retry, retaining any open dialog content.

### 1.2 Leave entitlement table — per employee

Full-width `work-surface` with an `OperationalTable`.

Columns: Employee (name + id, `<bdi>`), Employment type (`StatusPill-neutral`) alongside leave-type cells; Leave type (annual / sick / unpaid / emergency pills), Entitlement, Carry-over, Used, Pending, **Remaining (computed, bold)**, Adjustment delta in the period. One row per employee × leave type.

Header controls (`.filter-toolbar`): employee search (`SearchIcon`, `input` with `aria-label`), leave-type filter (`select`, `FilterIcon`), period (`select`). Active filters via `.applied-filters` `.filter-chip` + clear-all, exactly like AttendanceHistoryPage.

Row action: "Adjust" opens `Dialog` pre-filled with employee + leave type, a signed-days field (`inputMode="numeric"`, `dir="ltr"`, placeholder `+1 / -2`), and a mandatory reason (same requirement as today's adjust form, including "never zero" reflected in copy). Adjustment history per row: a chevron row-expander (keyboard: `aria-expanded`, "Adjustment history for EMP" as accessible name) opening a `compact-list` of prior adjustments (signed number in `<bdi>`, actor, timestamp, reason). Mobile (`⩽639px`): `mobile-record-list` / `record-block` layout via `MobileRecordBlock` as OperationalTable already emits.

States: loading `SkeletonRows rows={6}`; error `ErrorState`; empty — no employees = `EmptyState` "No employees in scope" with no action (roster is not created here); all filtered out = `EmptyState` with "Clear filters" action.
Mutant lifecycle: same as §5, with a distinct pending label "Recording adjustment…"

### 1.3 Public holidays register

Third `work-surface`. Variable-height list, density-first: NOT a table — holidays vary in length and date granularity, and this register is rarely longer than 15 rows.

Anatomy: `section-heading` "Public holidays" + `btn-primary` "Add holiday" (opens Dialog). List = `.compact-list` rows, each: **date in `<bdi dir="ltr">`** (`Intl.DateTimeFormat(locale, {dateStyle:"full"})` — reads fully in Arabic while the underlying value stays LTR), weekday derived, holiday name, and row actions: `icon-button` Edit (`EditIcon`, `aria-label` "Edit holiday X"), `icon-button` Delete (`TrashIcon`, `aria-label` "Delete holiday X", destructive). Rows are sorted ascending by date; past holidays collapse under a single details row "Show past holidays (N)" (native `<details>` styled as section-heading secondary — no animation, keyboard = Space/Enter on the summary).

Delete = `Dialog`, `btn-danger-quiet` "Delete", restating that removal is effective immediately for all schedule resolution (the delete is an audit-trail event per pushback from Security team; the copy says so).

RTL/LTR: date cell keeps `dir="ltr"` (never renders mirrored digit order), name localizes.

States: loading = `SkeletonRows rows={3}`; empty = `EmptyState` "No public holidays registered" + "Add first holiday" `btn-primary`; error = `ErrorState`.

### 1.4 "AI: set holiday dates" — disabled-by-design control

Placement: the **train** of the holidays header row, right after "Add holiday": a `btn-secondary` reading, in Arabic **"ذكاء اصطناعي: تحديد أيام العطل"** / English **"AI: set holiday dates"**, with a small `InfoIcon` and a trailing `StatusPill` tone `neutral` labeled **"Coming soon"** (Arabic: "قريبًا").

Anatomy of the disabled control (this is the part that must not look broken):

- `<button disabled aria-disabled="true">` — **not** `aria-disabled` alone and **not** a non-button; it must be present in the tab order as a real disabled button (removed from tab order, but announced) so screen readers announce "AI: set holiday dates, dimmed".
- Fill `--neutral-soft`, ink `--neutral-strong`, border `--neutral-border` — deliberately the **complete absence of accent** and of `--focus-ring`s affordance (no hover, no focus ring animation; `cursor: default` not `not-allowed`, because `not-allowed` implies an error state is coming).
- Wrapper element (`span.holiday-soon-wrap`) carries `role="note"` with a tooltip text: "This feature is planned, not broken. Fill dates from official Ramadan/Eid announcements when it ships." Rendered as visible microcopy under the button on mobile, as `title` on desktop, plus the always-present pill.
- Triggering it (click does nothing) must **never** render an error banner, never change URL, never log an error. There is no loading state to fake. Keyboard path: not focusable (native `disabled`); the same info is reachable by reading the pill and note.
- Contrast: `--neutral-strong` on `--neutral-soft` over `--surface` fulfills the existing button contract by construction (contrast check is metric-based on `--on-*` inks on `--neutral`).

Explicit note: a reviewer seeing a grayed button with a "Coming soon" pill, accompanied by note text, should conclude "planned", never "broken"; the differentiator is the pill + note + zero accent.

---

## 2. Per-employee settings — `/admin/people`

Layout: list-first. `PageHeader` + search + `OperationalTable` roster; detail is a **separate routed view** `/admin/people/:employeeId` (back breadcrumb from `PageHeader`, as `NewRequestPage` does). On mobile the roster table collapses to `record-block` via OperationalTable, already done.

### 2.1 Roster

Columns: Employee (`<bdi>` name + id), Department, Job title, Employment type pill, **Exception/schedule flag** (see 2.2), Slots of leave in force (remaining per active types, one tabular number per type — collapsed to "3 totals" + expander on mobile), Actions: "Open file".

The exception flag: `StatusPill tone="warning"` "Schedule exception" when the employee has any per-employee schedule row that supersedes the org schedule for today (resolve the same way the app resolves per-employee schedules). Roster default sort puts exception-flagged employees first; the pill is the second visual (after name) in the row so it's the thing HR scans for. Column `aria-label` "Schedule exception indicator".

States: loading `SkeletonRows rows={8}`; error `ErrorState`; empty roster `EmptyState`.

### 2.2 Employee employment settings — detail sub-view

A single `work-surface`, structured as:

1. `PageHeader` with employee name, subtitle "Employment · [ID] · Department".
2. `AttentionStrip` when the employee has a schedule exception today — with the exception's human sentence ("Effective 09:00–15:00 · Mon–Thu instead of organization default 09:00–17:00 · Sun–Thu") and no call-to-action; it's information, not an alarm.
3. **Employment type** — a `role-segmented` control (the existing `.role-segmented` visual: pill trio) with four options: Full-time / Part-time / Hybrid / Remote. Selection updates draft; **it does not save immediately** — this is not a toggle the demo can persist. Selected option gets the accent fill; the underlying `aria-checked` state is conveyed by `role="radio"` (native segmented control semantics). Keyboard: Left/Right arrows move within the group (no wrapping), Space selects — this matches how `role-segmented-option` behaves when forced into radio semantics. Each option's accessible name includes the label and the effect as hint text ("Part-time · expected daily minutes become editable").
4. **Hybrid policy shape (cards, not dropdowns)** — most important design decision here. Two `quiet-inset` selection cards, mutually exclusive, previews inside the card go a long way:
   - **Fixed days**: title "Named office weekdays" + a mini 7-cell weekday strip rendering the currently selected days (existing checkbox group, same fieldset) and the sentence "Attends the office on: Sun, Mon, Wed" (Arabic version uses the same weekday words, no digit reversal).
   - **Flexible quota**: title "Minimum days per period" + a number input (`dir="ltr"`, `inputMode="numeric"`) 1–6 and a period selector (Week / Month, `select`), plus the sentence "Minimum 2 days/week on any working day".
   - At a glance: the fixed-days card reads as a **calendar strip**, the flexible quota card reads as **one bold number** — so the two shapes are distinguishable by silhouette, not by reading. Switching between them keeps the other card's draft (doesn't wipe, exits preserved behind a "Switching discards the other policy's unsaved values" model when actually submitting, spelled out in the switch confirmation).
   - Selection affordance: selected card gets `--accent-border` + `--accent-soft`; unselected cards are clickable and keyboard-focusable (Space selects). No tabs; both options are physically visible so the trade-off is readable without interaction.
5. **Per-employee schedule exception** — a distinct inset block only shown when the employee has one (otherwise a `page-meta` "Follows the organization schedule") stating the exception in plain words and offering "Edit exception" (opens a Dialog mirroring the org schedule editor; one extra field: `effective_to`). The exception editor is the **same dialog component** as org settings' schedule editor, with one difference: a `page-meta` line under the title: "Applies to Karim Mostafa only; no other employee is affected." That single sentence is the whole point — HR knows the blast radius is one person without parsing the table structure.
   When HR edits the exception to match the org default again, the row's exception pill disappears from the roster table on the next refresh — the roster reads from effective schedule resolution, not from a flag column.
6. **Save model** — the whole detail view has a "_all unsaved changes_" draft. A single sticky `.form-actions` bar at the card's end (not per-field) with `btn-secondary` "Discard" and `btn-primary` "Save employment settings", plus `.field-hint` showing "Last saved [time] by [name]" for the current data. No per-field save buttons against the brief's spirit (HR editing policy should think in policy-units, not field-units).

### 2.3 Employee file — two visibility tiers

Layout decision: **both tiers on one screen, separated by a divider and a hr-only marker, not two separate views, and no viewer-perspective toggle.**

Anatomy: two `work-surface` blocks stacked, ordered shared-first (top), HR-only second, separated by a `divider` line and a heading (`h2`) per tier.

- **Shared tier**: `section-heading` "Shared with employee and manager" then `dl.decision-facts` rows for name / department / job title / direct manager / email (`<a href="mailto:">` in LTR `<bdi>`, never re-mirrored) / phone (`<bdi dir="ltr">`) / join date (`<bdi dir="ltr">`) / employment type.
- **HR-only tier**: headed with a `StatusPill tone="danger"` "HR only" and the sentence "The employee and their manager do not see this section." Facts again as `decision-facts` (salary with `--text-subtle` secondary for currency/decimals; national ID in `<bdi dir="ltr">`; bank details as `<bdi dir="ltr">`; contracts and performance evaluations as `.attachment-list` rows following the existing `attachment-row` pattern, each: filename `dir` inherits document direction, size in bytes (`Intl.NumberFormat`), and a `btn-ghost btn-compact` "Download" action).

**Why this layout and not a toggle:** a viewer toggle forces HR to remember whether they're looking as employee/manager/HR — a mental model that changes meaning instead of showing it. Physical separation means the answer to "what did I just edit and who will see it" is always on screen. The recommended pattern is therefore visible separation with an explicit marker; no toggle is designed.

**Why the pill is danger-toned, not neutral:** the semantic is privilege boundary, not information status; `--danger` (`#F28A50` dark / `#BF4A0A` light) is the existing accent for "do not act casually here" (same tone the danger buttons use), and reusing it for a boundary marker avoids adding a sixth accent hue. The contrast requirements are the standard `--danger-strong`/`--danger-soft` pair the spec already enforces.

Boundary behavior: the two tiers must **never** share a `form` element; each is its own `form` with its own submit, because mistakes in one tier cannot accidentally submit both.

### 2.4 Per-employee leave allocation

Same `work-surface` under the employment settings: an inset per leave type (Annual / Sick / Unpaid / Emergency as `StatusPill` header rows), each with current entitlement/used/pending remaining in the same `decisions-facts` style, and a "Adjust" `btn-secondary` per type opening the shared Adjust Dialog (same component as §1.2 uses — **one component, two callers** in the spec: "Adjust leave balance dialog": employee (pre-filled from context or selector), leave type, signed days, reason, preview of the change row, confirm.)

Accessibility of the allocation rows: each `<button aria-label="Adjust annual leave for Karim Mostafa">` (not icon-only; text button).

---

## 3. Organization attendance — today only — `/admin` (Overview)

The snapshot, clearly scoped to **today** — the full history lives in `/attendance/history` (already routed); cross-link, never embed history.

Layout: `PageHeader` "Overview" with a subtitle "Snapshot for [today's date]" + `AttentionStrip` if counts warrant it.

Anatomy (top of page, in this order):

1. **Count row** — a `.summary-strip` exactly as Home uses (`summary-item` × 4): Present (with `--success` strong value), Absent (`--danger`), On leave (`--info`), Under review / incomplete (`--warning`). Value faces are `--font-size-2xl` and `tabular-nums` (already on `.summary-value`). Stacked vertical on `⩽639px` (`.summary-strip` already wraps).
2. **People behind the counts** — four `OperationalTable`s, one per status, only on **desktop**; on mobile, one `record-block` per person with the pill (single list, filter chips act on it). Each table has: Employee, Worked so far (`formatTime` inputs), Status, One action (only the row-level action the current state makes available — see below). **No history rows** — a person appears in at most one table; if status changes during the day, they move, and the counts update live (`aria-live="polite"` on the summary strip).
3. **"History" link** under the fourth table: `Link className="link-arrow"? — no; exist as plain `Link` as done by AttendancePage's `attendanceViewFullHistory`. The link's text says it moves to history.
4. **Scope marker**, both visual and textual: under `PageHeader`, `Banner role="status"` tone `info` with "Snapshot — day only. For earlier days, open attendance history". Not an AttentionStrip (which implies required action).

Row actions are narrow and safe: absent today → no action (creating absence requires request workflow, not this page); incomplete → ghost "Request correction" routing to `/attendance/corrections` for that employee (the link exists for today's own use; scope-check: navigation to the existing route, not transparency). "Request correction" per absent person is deliberately absent — this is a snapshot, not an action hub; doing so would silently grow the page's mutation surface and contradict the "history lives elsewhere" principle. If product wants an action there later, it's a reorder not a re-architecture.

**RTL:** counts are digits (localized, never mirrored with `.icon-mirror`), names, Arabic weekday names localize. The tables inherit `OperationalTable`'s RTL handling, no new logic.

**Accessibility:** `summary-item` values are rendered as definition terms so screen readers read "Present: 3", not "3" floating. Every ops table row has `tabIndex={0}` (matching OperationalTable's existing pattern) and a row-level accessible name via `<th scope="row">` as OperationalTable already provides.

States: loading = `SkeletonRows rows={4}` for the counts **and** the tables; error = `ErrorState`; a genuinely empty day (e.g., a public holiday matches the register) = the register name shown in the banner instead of counts — no tables, no empty-state per table (an empty holiday day isn't an error); no employees at all (edge) = one `EmptyState` "No employees in scope" replacing everything below the banner.

---

## 4. Announcements — `/admin/announcements`

### 4.1 Composer

Layout: `reading-page` width (`--reading-max = 760px`) — the composer is a writing surface, not a data grid; reuses the same reading width the app uses for long-form pages.

Anatomy (single `work-surface`):

1. **Subject** — `input` (`maxlength` 120, live counter as `.field-hint`, `aria-describedby`).
2. **Body** — `textarea`, 6 rows min; rich formatting is out of scope (plain text keeps sending honest; markdown is rejected by the email channel in reality).
3. **Attachments** — `fieldset.quiet-inset` with `input type="file"` (multiple) rendering selected files as `.attachment-list` rows with a `btn-ghost btn-compact` remove per row and a size-audit line ("Total 2.1 MB of 10 MB") — the demo layer tolerance is explicit so HR sees the honest ceiling. Demo note exactly like `NewRequestPage`'s "uploads unavailable" copy where upload is not wired: `.field-hint` states it inline.
4. **Channel** — a segmented control: Email / In-app notification / Both (reuses `role-segmented` visual, `role="radiogroup"`). Default: Both.
5. **Audience** — a two-step control, not a fire-and-forget dropdown:
   - Segmented control: "Everyone" / "Chosen employees".
   - When "Chosen employees" is active, an expandable panel (native `details`, styled like `holiday-soon-wrap`'s) containing a searchable multi-select list (checkbox list reusing the lookup patterns above, grouped by department, each row: name `<bdi>`, department; search input filters, `role="searchbox"`, count line `aria-live="polite"` "Showing 7 of 34 employees"). A department-group header checkbox selects all in that group (aria-label "Select all employees in department X"). "Select everyone" pre-ticks all with a count note "19 employees across 4 departments".
   - Selection state survives subject/body edits (React state, not hidden form fields).
6. **Preview of the exact delivery list** (before Send): directly under Audience, a `.quiet-inset` block that changes as the audience is edited. It reads:
   - Everyone: "Everyone — 19 employees. Will send to all employees including managers." (Each count is a link — a `btn-ghost btn-compact` "View list" opening a `Dialog` that spells out one name per row, sorted by department, so that HR has actually inspected the list before clicking the destructive action, without the page itself growing.)
   - Chosen: "3 employees — 3 recipients." … (Always the same phrasing pattern for subject and channel.)
   - Audience with zero members after filtering: the block switches tone to `--warning-soft` and reads "No recipients selected — Send is disabled."
7. **Send button** — `btn-primary` "Send announcement", disabled when: subject or body empty, attachments over budget, audience empty, **or audience not explicitly inspected** (Has the reviewer/HR ever opened the delivery list? See the unknown state note below for why). `aria-describedby="send-hint"`, a `.field-hint` under it: "Send is simulated in this demo. It does not reach a real server." (Reuses the demo boundary copy from NewRequestPage apps.)

### 4.2 Send lifecycle — pending / confirmed / unknown (honest simulation)

The demo cannot actually send. The design must show all three outcomes so a reviewer sees them as designed states, not as bugs.

- **Pending** — immediately after send click, the occupies-the-composer Save row swaps to a submit block: `<slot role="status" aria-live="polite">` "Pending — sending to 3 employees…" with a `.spinner` and a `StatusPill tone="info"` "Pending" beside a timestamp. The composer fields are **locked but visible** (no modal — the reader should see what was sent). Cancel is not offered: the demo state cannot be un-sent and pretending otherwise lies about the lifecycle. A "Send again" affordance appears only after resolution.
- **Confirmed** — after the mock layer reports success: `Banner tone="success"` announces "Confirmed — 3 employees delivered. Delivery receipt time: [timestamp]." The announcement moves to the history list with a `StatusPill tone="success"` "Confirmed". Subject/body/audience snapshot are **rendered read-only inside a `details`** in the history (not deleted), so the reviewer can always see exactly what was sent.
- **Unknown** — the mock layer explicitly supports "unknown" fixture results (it already models "Unknown decision outcome" in the demo tools — verify at `/admin` demo tools on the real build). Design: `Banner role="alert"` tone `warning` (not error — the error tone says "your input was wrong", this says "we don't know yet"): "Send outcome unknown. The system attempted delivery but could not confirm whether all 3 recipients were reached. Check the notification center later; re-sending may duplicate copies." The announcement enters the history list with `StatusPill tone="warning"` "Unknown outcome". From there: two controlled actions — "Retry delivery" (which creates a **new** send attempt, not a mutation of the old record — never a mark-as-sent; pretending to confirm without delivering is exactly what the unknown state exists to prevent) and "Mark delivered manually"? — **rejected**: manual marking is the same lie minus the performative motion; a human who knows it went through should instead read the notification-centre receipts. Only the controlled two-column action set above is offered.
- **Denied** — the mock layer can also deny a mutation (capability check-out). `Banner role="alert"` tone `error`: "Your role does not permit sending announcements. No message was sent." The composer unlocks so nothing is lost (draft preserved). This state reuses exactly `CAPABILITY_DENIED` keys already exercised by the demo tools.

### 4.3 History list

Below the composer, second `work-surface`, `OperationalTable`:

Columns: Subject (`<bdi>` sentence-trunted with tooltip), Channel (icon + word, `aria-label` "channel: email"), Audience (count + expandable "Show recipients" `details`), Sent at (`<bdi dir="ltr">`), Outcome (`StatusPill` success/warning/info per §4.2), Action (retry only when unknown; "View" otherwise — the read-only `details` view).

Sorting: newest first; no pagination (demo volumes); a count line above the table matching OperationalTable's caption convention. Loading/empty/error as standard (`SkeletonRows`, `EmptyState` "No announcements yet — send your first one from the composer.", `ErrorState`).

Mobile: OperationalTable's record-block path (as elsewhere) — every column becomes a `record-field` row; nothing collapses (announcement history rows carry enough density to justify it).

---

## 5. Mutation lifecycle — one contract for the whole suite

Every write operation in this suite (save schedule, add/edit/delete holiday, adjust leave balance, save employment settings, send announcement) follows the same three-beat lifecycle, regardless of which area owns it:

| Phase | Visual | ARIA | Behavior |
|---|---|---|---|
| Pending | Trigger button disabled + `spinner` + label "Saving…" (only schedule adopt the specific verb: "Saving schedule…", "Adding holiday…", "Recording adjustment…") | `aria-busy="true"` on the pending container | Controls in the affected area are disabled; elsewhere stays interactive. |
| Confirmed | `Banner role="status"` tone `success`; history row / roster / register row updates immediately with no animation beyond a one-frame border transition | `role="status"` (aria-live polite) | Data in affected areas re-reads; other sections untouched. |
| Denied/failed | `Banner role="alert"` tone `error` (or `warning` for the unknown case); inputs keep their values so no work is lost; focus moves to the banner | `role="alert"` (aria-live assertive) | Same-locale copy. Capability refusal uses the denied wording; envelope failures use `ErrorState` if it's a failed fetch, or inline field errors for validation. |
| Unknown | (only announcements, on the fixture) `Banner role="alert"` tone `warning` + a history placeholder in the warning state | `role="alert"` | See §4.2. |

The pending state for dialogs: the `Dialog`'s existing `busy` prop disables the close button and keeps the focus trap alive — no double-submission. Forms outside dialogs use the button's own disabled state plus `aria-busy`.

**A single section never has two pending mutations.** This is the same rule the app's dialogs currently enforce implicitly; here it is stated so implementations race-test it with the demo fixture that fires "unknown" mid-pending.

---

## 6. RTL / bilingual behaviour

- Whole suite inherits `html[dir]`; `.work-surface` and `dashboard-grid` mirror automatically (CSS logical properties already in global.css), no manual flip needed anywhere except listed exceptions.
- **Never mirrored:** every ISO date rendered as `<bdi dir="ltr">`; every time value; every email; national ID and bank account digits; the `+N / −N` signed numbers in leave adjustments (they come from numeric parsing and must not have their sign visually cross the digit group boundary); the shortened domain style of `send` counters.
- **Mirrored / direction-logical:** the working-days checkbox order (logical 0..6, so in RTL it runs right-to-left as Arabic weekday names, correct); the roster table's sort arrows (if added later; use `RtlChevronIcon`-style existing primitives); the `attention-strip`'s inline-start accent border (it uses `border-inline-start`, already handles RTL).
- **Arabic line height:** Arabic text on this suite inherits `--line-height-ar: 1.65` (already set on the body for RTL); no bespoke tighter leading inside dense table cells, since the desktop hour rows are the densest surfaces and Arabic already overflows them.
- Number formatting: every count/duration uses `Intl.NumberFormat(locale)` or the existing `minutesFormat()` / `duration()` helpers — never hand-concatenated digit strings (the current two `Intl.DateTimeFormat` call sites on AdminPage.tsx already follow this).

---

## 7. Responsive

App's existing compact mode: `isCompact = (max-width: 1023px)` — rail becomes a fixed drawer; `⩽639px` mobile — tables become `record-block` lists; dialogs anchor bottom.

Breakpoints used and what changes:

- **≥1024 (desktop, default):** settings grid is two-column (`dashboard-grid`); org attendance renders 4 separate `OperationalTable`s; per-employee detail is two columns (employment settings on inset-inline-start, leave allocation on inset-inline-end); announcement audience and channel controls sit side-by-side via `.form-grid` (3-col: channel | audience | (row)) then the composer body below.
- **640–1023 (compact):** all `dashboard-grid` and `.attendance-grid` layouts collapse to one column (same as elsewhere in the app — `dashboard-grid` has a 1023px collapse rule). The `review-tabs` sub-nav allows horizontal overflow for the four links if labels wrap in Arabic (Arabic labels are long here; `overflow-x: auto` with `overscroll-behavior-x: contain`, links are inline-flex with `white-space: nowrap`).
- **⩽639 (mobile):** dialogs anchor bottom (existing `.dialog` behavior). Organization attendance counts stack vertically (.summary-stack handles it); the four per-status tables are replaced by **one** `record-block` list (what the operational table already emits for mobile via `mobile-record-list`), with filter chips acting on the single list. Announcement audience: the whole `.role-segmented` wraps to 2×2 on this width (same as `login-role-picker`'s flexibility). The composer's sticky form-actions become full-width `.form-actions` per the existing `⩽639px` block width rule (already covered by global.css).

Nothing needs a bespoke JS breakpoint; everything follows the `1023/639` media queries the app already declares — the suite's new content is deliberately built from components that already respond to them.

---

## 8. Accessibility (WCAG 2.2 AA)

- **Keyboard:** every interactive element is reachable and operable: dialog tabs (`review-tabs` sub-nav) reachable with `Tab` (they are links, not widgets — arrows are not required); segmented controls get arrow-key navigation with `Space` to select and spoken as radios; holiday list actions are real buttons; row expanders are `aria-expanded` toggle buttons; all list wraps have real focusables; the filters on the leave-entitlement table are real form fields with placeholders — all of this is native/focusable in DOM order without adding tabindex. Same as the pattern `AttendanceHistoryPage` already uses.
- **Accessible names for icon-only controls:** the AI button carries text, not icon-only. Any list hover/menus on holiday rows use `aria-label="Edit holiday <name>"` / `"Delete holiday <name>"` with the localized name — following the same pattern used in AttendanceHistoryPage's filter-close buttons (`attendanceClearFilterAriaTemplate`).
- **Focus visibility:** everything inherits `:focus-visible { outline: 1px solid --focus-ring }` (already global); the new selection cards (§2.2) additionally set `box-shadow: var(--elevation-focus)`. Focus order is DOM order — no positive tabindex used anywhere.
- **Contrast requirements for new surfaces, in existing tokens:**
  - Selection cards (§2.2): ink `--text` on `--surface` (existing 15:1-class pair); selected-state border uses `--accent-border` on `--surface` (decorative only, no text rides on the border).
  - AI-holiday "Coming soon" pill: `--neutral-strong` on `--neutral-soft` over `--surface` — a new-but-existing-pair combination already inside the suite's 4.5:1 contract.
  - Holiday date cells in Arabic: `--text` ink on `--surface` (each date wraps into `<bdi>`, no residual color change).
  - Any color never carries meaning alone — every status pill also has text (already true of all `StatusPill` variants).
- **Screen-reader structure:** page headings follow h1 (`PageHeader`) → h2 (each area) → h3 (sub-blocks) order. Two-tier employee file uses h2 per tier. Attendance counts read as a definition term per count. Records inside the tables already carry `<th scope="row">` via OperationalTable.
- **Reduced motion:** everything in this suite is static except the existing `.skeleton`/`.spinner` animations, both already respecting `prefers-reduced-motion`. Nothing new animates — no entrance transitions for the accordion, no push-pull.

---

## 9. What I deliberately did NOT do

- **No tabs-in-place** for the four areas. Tabs hide the fact that areas share data streams and are deep-linked everywhere else; push-based sub-nav preserves URL semantics and is what the demo's tooling already assumes.
- **No master-detail split** on `/admin/people`. A detail pane next to the roster would fit on desktop but collapses to "scroll" in compact mode and pushes the two-tier employee-file visibility question (a core design of this page) into a separate layout instead of letting it be a just-visible marker.
- **No viewer-perspective toggle for the employee file.** A toggle asks HR to remember what others can see; showing the boundary physically means they never forget (§2.3).
- **No instant-save on the segment/selection controls** (§2.2). The demo's `dirty`-tracking and confirmation-on-close dialog exist exactly because partial writes are lies; this suite commits whole policy-units, not field-blips.
- **No auto-population of holiday dates.** The "AI: set holiday dates" control is a designed-disabled placeholder (§1.4) — the feature does not exist; faking a smart-looking flow would make the disabled label dishonest.
- **No optimistic mark-as-delivered on the unknown outcome.** The unknown state exists precisely to stop pretending things went through; the honest remedy is re-send-with-a-new-attempt (§4.2).
- **No decorative Easter eggs, no glassmorphism, no page-transition animation.** The brand voice lives in mascot/microcopy (notifications, the empty states) — discipline lives in the administration screens.
- **Not a single Save button for the whole detail view on `/admin/people/:id`** — it's tempting to collapse the employment block HR blocks together into one "Save employee" — rejected: it would couple the schedule exception, leave allocations, and shared/HR-only file edits into one submit; policy units have different risk profiles and should fail (and ask for confirmation) individually.
- **No per-employee schedule exception editing on the org settings page.** Exception editing is per-person (the exception's whole meaning); putting it on org settings would encourage "mass edit" habits against what a scoped exception is for.
- **No side-rail for the sub-navigation.** The existing `.app-rail` drawer has a fixed contract; the suite needs at most 4 top-level routes and visually reads as "the admin area's own inner pages" — a second rail would fight compact mode for no gain.

---

## 10. Open question for a human

**When an audience subset is chosen from an ungrouped list — after applying a department group-expanded selection, should the composer block "Send" until the reviewer explicitly inspects the delivery list at least once per send, or just show the count?** This spec recommends *set-color state on composer confirmation* (§4.1, rule 7) as a lower bar and safer default: the composer "Send" states disabled on "audience not explicitly inspected" and yields to the visual inspection action. If the product's honest-lifecycle rule leans stricter (the unknown/denied states already exist for other routes), forcing the list inspection on every send is the second-most-reasonable read — but it makes every send with ≥1 recipient a forced detour. Someone owning the send semantics should pick which factory-fresh friction level ships, because the current draft leans heavily on the honest-lifecycle screen affordances of §4.1 and §4.2 and that contract lives or dies on the review-inspection rule.

## 11. What I did not inspect / could not verify

- I did not run the production build's own visual tests against my spec; there is no pixel-metric plan here (that is deliberately not this doc's job).
- I inspected `/admin` rendered in dark theme in English after signing in as `hr@cds.com` in the served `localhost:4173` SPA via Chrome DevTools-backed browsing, plus source reading. I did **not** render it locally in Arabic RTL or light theme; the RTL/light guidance Above is from source reading of the existing token layer rather than measured snapshots — an Arabic RTL screenshot review is a follow-up worth doing before implementation.
- I did not verify the English/Arabic dropdown labels of every `dict` key mentioned; the existing keys shown above are those I observed rendering.
