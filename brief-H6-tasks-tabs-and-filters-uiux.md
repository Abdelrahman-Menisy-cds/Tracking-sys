# Brief H6 — modernize the UI/UX of EVERY tab on /tasks and its filters

You have **full permissions** for this run (`--yolo`). Work autonomously, do not stop to ask, and do
not ask for approval on commands. If something is genuinely blocked, commit the verified part and
report precisely what is left.

The user (the product owner, Arabic-speaking) asked, looking at `/tasks`:

> «انا عاوزك كل التابات الي في المهام تشتغل عليها بحيث تخليها مودرن وافضل من ناحيه ال ui ux»
> «واهتم بموضوع الفلاتر بحيث تكون مودرن و مناسبه ك ui ux بردو»

So: **all tabs** — «بانتظار التكليف» (needs), «مهامي» (mine), «مهام أنشأتها» (created), «تايم شيت»
(timesheet) — plus the **filters**, which they called out separately.

## Grounding — what exists today (the lead read the code; verify before changing)

`frontend/src/screens/TasksPage.tsx` (238 lines) is the host:

- **Tab strip** (lines 155-169): `div.role-segmented` with `role="tablist"` holding `button`s
  (`role="tab"`, `aria-selected`), each rendering `<span>{label}</span><span class="nav-badge"
  aria-hidden="true">{count}</span>`. **No `role="tabpanel"` and no `aria-controls` anywhere** — the
  tablist is decorative ARIA with no panel relationship. Tab order: `needs` (manager only, first),
  `mine`, `created` (when `can_create_tasks`), `timesheet` (only when the H1 time store is non-empty).
- **Counts come from** `tabs` (lines 61-70): `needsAssignment.length`, `myTasks.length`,
  `createdTasks.length`, and **`0` for the timesheet**. They **ignore `statusFilter`**, so a badge can
  say 12 while the table below shows 3.
- **Filters** (lines 171-189): a bare `div.filter-toolbar` containing exactly one `label.field` +
  `select.select` for status, rendered only when `activeTab !== "timesheet"`. Two option strings are
  **hardcoded in the component, outside the dict**: `"كل الحالات"` / `"All statuses"` (line 181).
  There is no search, no assignee filter, no priority filter, no date filter, no active-filter
  indicator, and no clear action.
- **Create-task action** (lines 145-153): its own `div.form-actions` row **above** the tab strip.
- **Empty states** (lines 193-199): `EmptyState` with one message per tab; a filter that hides
  everything shows the *same* "there is nothing here" message as a genuinely empty tab — the screen
  lies about why it is empty, and offers no way out of the filter.
- **Timesheet tab** renders `TaskTimesheetSection` (H2), which carries its own filter row in a
  **different visual language** from the task tabs' toolbar: `timesheet-name-filter`,
  `timesheet-period-filter` (today / this week / this month / custom range) and
  `timesheet-employee-filter` (manager only), with `timesheet-section` as the container.
- Tables render through `components/data/OperationalTable` with a `caption`.

## Design authority — read these first, they bind you

- `docs/design/premium-design-direction.md` — the approved direction («composed paperwork, not
  simulated paper»; **preserve the approved six color primitives**; typography/shape/rhythm;
  the pattern catalog; the critical workflows).
- `frontend/src/styles/global.css` — the tokens and primitives you must build from
  (`--surface`, `--surface-subtle`, `--surface-inset`, `--accent`, `--accent-soft`, `--accent-border`,
  `--on-accent`, `--card-border`, `--radius-*`, `--sp-*`, `--timeline-width`, `--focus-ring`,
  `--font-size-*`) and the classes that already exist (`work-surface`, `role-segmented`,
  `page-meta`, `filter-toolbar`, `field`, `select`, `btn`, `nav-badge`, `timeline`).

## Required outcomes

### 1. A real, accessible tab strip

- Every tab button gets `aria-controls` pointing at a **single `role="tabpanel"` element** that wraps
  all pane content, with `aria-labelledby` pointing back at the active tab. No decorative ARIA.
- Per-tab counts get an **accessible name** (e.g. «3 مهام») instead of `aria-hidden`; the number must
  still be visually secondary. The timesheet tab should show a meaningful count (logged entries, or
  the filtered total of them) rather than a hardcoded `0`.
- **Keyboard**: roving `tabindex` — arrow keys move between tabs and focus follows, `Home`/`End` jump
  to the ends, `Enter`/`Space` activates. Follow the ARIA Authoring Practices tablist pattern.
- **Narrow widths**: the strip must scroll horizontally (or wrap) instead of squeezing four
  long Arabic labels; keep tap targets ≥ 36px tall. Verify at ~360px, ~768px and desktop.
- Keep the manager's needs-queue emphasis (count + attention banner) — it is a deliberate decision
  from an earlier brief; do not undo it.

### 2. One unified filter toolbar, used by every tab

Replace the bare one-select toolbar with a **single toolbar component** that the task tabs and the
timesheet tab both use, so the app has one filter language:

- **Search**: a text input filtering by task title (and creator/assignee name where it reads
  naturally), debounced or instant, with a clear (×) affordance.
- **The tab-relevant selects**: status for the task tabs (all four statuses + "all"); the timesheet
  keeps its name/period/employee controls — **same testids**, restyled into this toolbar.
- **Active-filter chips**: every applied filter appears as a removable chip; removing it updates the
  list immediately. A **«مسح الكل» / "Clear all"** action appears only when at least one filter is
  active.
- **Live result count** near the toolbar/table, phrased honestly (e.g. «عرض 3 من 12» / "Showing 3 of
  12"), in both locales, through the dict.
- **Placement rhythm**: the page becomes header → demo banner → attention banner → **tab strip** →
  **toolbar** → count/table → dialogs. The create-task action belongs aligned with the page
  header/toolbar (an action cluster), **not** on its own stray row above the tabs.

### 3. Filters that tell the truth (this is the UX half of the ask)

- **Distinguish "nothing here" from "nothing matches"**: a genuinely empty tab keeps its current
  empty message; a filtered-to-nothing pane shows a *different* message plus a clear-filters action.
  Never show "لا توجد مهام" when tasks exist and a filter hid them.
- **Counts must agree with the list.** Recommend this contract: the tab badge reflects the **active
  filter** (so the number matches what you see on opening the tab), and the toolbar's "showing X of Y"
  preserves the unfiltered total. Whatever you choose, **state it in the gate and assert it** — do not
  leave the badge silently disagreeing with the table.
- Filters must survive a tab switch (they are page-level), and the active filters must stay visible in
  the toolbar so a user can always see *why* the list looks short.

### 4. Dict discipline

No hardcoded UI strings. Every new label, chip, empty/clear/count string goes through
`frontend/src/i18n/dict.ts` in **both** `ar` and `en` — including the two literals that are hardcoded
today (`"كل الحالات"`, `"All statuses"`, line 181). Keep Arabic labels short and idiomatic.

### 5. Both locales, RTL, and mobile — verified by construction

No fixed pixel widths; chips wrap; the toolbar stacks under ~600px; controls keep their `id`/`htmlFor`
associations; nothing overlaps at 360px. Latin digits for numbers in both locales (the existing
formatter rules).

## Hard constraints (breaking any of these fails the brief)

1. **Keep every existing `data-testid`** — these are load-bearing for 9 gates and the lead's browser
   measurement: `create-task-open`, `assign-<taskId>`, `task-status-bar`, `task-status-control`,
   `task-status-<status>`, `task-status-readout`, `task-timer`, `task-timer-elapsed`,
   `task-timer-pulse`, `task-timer-total`, `task-timer-start`, `task-timer-stop`, `task-time-entry`,
   `timesheet-section`, `timesheet-name-filter`, `timesheet-period-filter`,
   `timesheet-employee-filter`. Renaming a class is fine; renaming or dropping a testid is not.
2. **No new colors and no new visual language.** Only the approved tokens and existing primitives.
   `scripts/verify-task-status-bar.ts` already enforces an approved-token whitelist on the CSS —
   **extend that whitelist discipline to whatever CSS you add**, do not weaken or bypass it.
3. **No new date/time formatting.** Everything user-facing goes through `src/app/useMockList.ts`;
   `scripts/verify-datetime-format.ts` scans the sources and will fail you otherwise. Do not strip the
   `\u2066…\u2069` isolates.
4. **All 9 existing gates must still pass**, unmodified in intent.
5. Stay inside `frontend/`. Do not touch `backend/`, the fixtures' meaning, or files the user added
   (images, `*.pdf`, `docs/`, `.claude/`, `.agents/`).
6. Scope discipline: no drive-by refactors beyond the tasks surface this brief names.

## Acceptance — write the gates, run everything, paste real output

Add `frontend/scripts/verify-tasks-tabs-uiux.ts` (same style as the existing gates) that **fails
loudly** on regression:

1. Tablist wiring: every tab renders `aria-controls`, a `role="tabpanel"` exists, and the panel is
   labelled by the active tab. No tab count is `aria-hidden`.
2. The unified toolbar is used by **every** tab (assert the toolbar component is rendered for the
   timesheet branch too, not only the task branches).
3. Chips + clear-all: the clear action resets **every** filter (name, status, period, employee) and
   disappears when nothing is active.
4. The filtered-empty state is a **different** branch/message from the genuinely-empty state, and it
   offers the clear action.
5. No hardcoded filter strings remain in the tasks surface — specifically assert `"كل الحالات"` and
   `"All statuses"` are gone from the components and present only in `dict.ts` (both locales).
6. Every testid from constraint 1 is still present in the sources.
7. The tab-count contract you chose is asserted (badge vs. unfiltered total), so it cannot drift.
8. The approved-token rule covers your new CSS.

Then run and paste the real output:

- `npx tsx scripts/verify-tasks-tabs-uiux.ts`
- **every** existing gate: `for g in scripts/verify-*.ts; do npx tsx "$g"; done` — all must pass
- `npx tsc -b`
- `npm run build:demo`

## Report (what the lead will check)

With real command output: what changed per tab, the toolbar/filters you built, the contract decisions
you made (count semantics, where the create action moved to, chip behaviour), the gate results, `tsc`,
the build, and anything you deliberately did not do — with the reason. Name any place you left
inconsistent rather than hiding it.

Commit only the files this brief produces, with a message that says what the user asked for. The lead
verifies the result in a real browser afterwards and will run the app against the demo build.
