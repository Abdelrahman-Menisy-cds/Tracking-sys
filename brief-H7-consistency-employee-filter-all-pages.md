# Brief H7 — align the task filters, add an employee filter, then modernize EVERY page

You have **full permissions** for this run (`--yolo`). Work autonomously; do not stop to ask and do not
request approval for commands. If something is genuinely blocked, commit what is verified and report
exactly what is left and why.

The product owner (Arabic-speaking) looked at `/tasks` and asked, in their words:

> «عاوزك تخلي ف تناسق هنا بينهم» — make the elements here CONSISTENT with each other
> «وضيف انه يفلتر بالموظف كمان عادي» — and add filtering by EMPLOYEE as well, normally
> «وعاوزك تلف على كل الصفحات وتظبطها تخليها مودرن وتخليها مناسبه ك ui ux» — then go over EVERY page and
> make it modern, appropriate as UI/UX

So this brief has **two parts, in this order**, and you commit them as **two separate commits**:

- **Part 1 (small, precise, do it first and commit it on its own):** the alignment/consistency fix on the
  tasks surface + the missing employee filter.
- **Part 2 (the sweep):** apply one consistency contract across all 16 pages.

The lead already **measured** Part 1's defect in a real browser (below). Those numbers are the target —
do not re-derive the problem, fix it.

## Part 1a — the consistency defect, measured (this is exactly what the user circled)

At a 1280px viewport, on `/tasks` (both the task tab and the timesheet tab), the horizontal edges are:

```
page main column       left=24   right=756   (w=732)
.tasks-tab-strip       left=24   right=756   (w=732)  padding-inline: 4px   <-- inset A
[data-testid=tasks-filter-toolbar]  left=24  right=756 (w=732)  padding: 16px  <-- inset B
  .tasks-filter-controls (the row inside)  left=41  right=739  (w=698)
      grid-template-columns: 337px 168.5px 168.5px   gap 12px   <-- THREE tracks, only TWO children on the timesheet tab
      search/name input   left=402 right=739 (w=337)
      period select       left=222 right=390 (w=169)   <-- 337 vs 169, and dead space between them
table                  left=25   right=755   (w=730)  <-- inset C (its own border)
```

Three different inner insets (**4px, 16px, 1px**) and a **dead third grid track** are why the filter row
looks narrower than the tab strip, indented from both sides, and unbalanced, with the name field twice
the width of the select beside it and a gap of dead space. Required outcome:

1. **One shared inner inset.** The content of the tab strip, the filter panel's controls, the active-filter
   chips, the result count and the table's edge must all start and end on the SAME left/right x. Introduce
   (or reuse) a single spacing token/variable for this, use it everywhere on the page, and make the tab
   strip's own padding stop being a different number than the panel's. State the resulting numbers in your
   report (measured, not described).
2. **The filter row's grid must adapt to the controls that are actually present.** No dead tracks: the
   timesheet tab renders two controls and must not reserve a third column; the tasks tabs render search +
   status (+ the new employee select). Use a layout that fits the real child count (e.g.
   `grid-template-columns: repeat(auto-fit, minmax(...))`, `grid-auto-flow: column`, or one column per
   control type driven by the tab) — but keep the mobile stack (`@media (max-width: 599px)`) working.
3. **Balanced widths.** No control should be twice its neighbour for no reason; the search may be wider
   than a select, but not while leaving dead space beside it. Every control's right/left edge must line up
   with the shared inset above.
4. The same must hold on the **timesheet** tab AND the task tabs — one grammar, not two.

## Part 1b — add the employee filter to the task tabs

The timesheet tab already has `timesheet-employee-filter` (team viewers only). The task tabs need the
same capability: **filter the task queues by assignee/employee**.

- A control in the same filter row (same visual language and the shared inset), with its own
  `data-testid` (name it `tasks-employee-filter`), populated from the people/employee directory, with an
  «الكل / All» default.
- It must produce an active-filter **chip** (the existing chip mechanism), be reset by «مسح الكل», and be
  reflected in the result count («عرض X من Y») and in the tab badges (the H6 contract: the badge and the
  list use the same predicate).
- Show it to the same audience the timesheet's employee filter serves (team viewers: manager/HR). For a
  plain employee the control is absent or disabled — decide, and say which in your report.
- Both locales via `dict.ts`; no hardcoded strings; no new colors; no new date paths.
- Keep `timesheet-employee-filter` working exactly as it does today.

## Part 2 — the consistency sweep across every page

All 16 page files: `src/screens/*.tsx` (11) and `src/screens/admin/*.tsx` (5).

`docs/design/premium-design-direction.md` is the binding design authority; `src/components/layout/PageHeader.tsx`
and the `work-surface` / `filter-toolbar` / `field` / `select` / `btn` primitives in
`src/styles/global.css` are the shared language. Do not invent a second design language — **make the
existing one consistent and finish it.**

Apply one contract, page by page, and verify each page in both locales at desktop and 390px:

- **Header rhythm**: title + description + page actions through the shared header primitive, with the same
  spacing above and below on every page. Page-level actions (like the tasks page's «مهمة جديدة») live in
  that header, not on a stray row.
- **Surface edges**: every card/section/table on a page shares the SAME left/right edges as the page's
  header — the defect in Part 1a is a symptom of this being undeclared, so declare it once (a token or a
  utility class) and use it on every page.
- **Filter grammar**: any page with filters uses the same toolbar/row/chips/count grammar as the tasks
  page after Part 1 — same insets, same field+label pairing, same chip behaviour, same «مسح الكل».
- **Tables and lists**: one table/section language (caption, header weight, row height, numeric alignment,
  status pill placement) across pages. `OperationalTable` exists — use it rather than page-local variants.
- **States**: every data page has a real empty state, a real error state with retry, and a loading state
  via the shared primitives (`EmptyState`, `ErrorState`, `SkeletonRows`) — consistent wording and layout.
- **Forms and dialogs**: shared field/dialog grammar; label, hint, error and action ordering identical.
- **Buttons**: one hierarchy (primary/secondary/ghost) used the same way on every page; no page-local
  button styling.
- **RTL, EN, mobile**: no horizontal overflow, nothing cramped, tap targets >= 36-44px, long Arabic labels
  not clipped.
- **Do not change behaviour, data, permissions, or the meaning of any page** — this is a UI/UX and
  consistency pass. If you find a genuine functional bug, report it rather than silently changing logic.

If a page is already consistent, say so and leave it; the point is the contract holding everywhere, not a
large diff.

## Hard constraints (breaking any of these fails the brief)

1. **Keep every existing `data-testid`** (they are load-bearing for 10 gates and the lead's browser
   measurement): `create-task-open`, `assign-<taskId>`, `task-status-*`, `task-timer-*`, `task-time-entry`,
   `timesheet-section`, `timesheet-name-filter`, `timesheet-period-filter`, `timesheet-employee-filter`,
   `timesheet-total`, `timesheet-custom-range|from|to|apply`, `tasks-filter-toolbar`, `tasks-clear-all`,
   and every id used by the gates (`tasks-status-filter`, `tasks-tabpanel`, `tasks-tab-<tab>`).
2. **No new colors and no new visual language** — only the approved tokens/primitives.
   `scripts/verify-task-status-bar.ts` enforces an approved-token whitelist on CSS; extend that discipline
   to whatever CSS you add, never weaken it.
3. **No new date/time formatting** — everything through `src/app/useMockList.ts`;
   `scripts/verify-datetime-format.ts` scans sources.
4. **All 10 existing gates must still pass** unmodified in intent: `verify-datetime-format`,
   `verify-file-roundtrip`, `verify-prayer-times`, `verify-prayer-triggers`, `verify-st-open-label`,
   `verify-task-capabilities`, `verify-tasks-tabs-uiux`, `verify-task-status-bar`, `verify-task-timesheet`,
   `verify-task-time`.
5. Stay inside `frontend/`. Do not touch `backend/`, the fixtures' meaning, or the user's own files
   (images, `*.pdf`, `docs/`, `.claude/`, `.agents/`, `.hermes/`).
6. No drive-by refactors beyond what this brief names.

## Acceptance — add a gate, run everything, paste real output

Add `frontend/scripts/verify-page-consistency.ts` (same style as the existing gates) that FAILS LOUDLY on
regression and asserts at least:

1. The employee filter exists on the tasks surface with its testid, in both locales, and is wired into the
   chips + clear-all + result count (source-level assertions mirroring the existing gate style).
2. Every page file renders through the shared header/surface primitives — no page carries its own
   one-off page padding/inset value (scan the page sources and the CSS for stray `padding`/`margin`
   declarations on page-level containers, and assert the shared token/class is what is used).
3. The tasks filter row's CSS cannot reserve a dead track: assert the layout rule used adapts to the child
   count (e.g. no fixed 3-column template on a container that renders 2 children).
4. No hardcoded UI strings in the touched pages' filters/toolbars — filter copy in `dict.ts` (both locales)
   only.
5. Every testid from constraint 1 still present.

Then run and paste the REAL output:

- `npx tsx scripts/verify-page-consistency.ts`
- **all** gates: `for g in scripts/verify-*.ts; do npx tsx "$g"; done` — every one must pass
- `npx tsc -b`
- `npm run build:demo`

## Commits

Two commits, in this order, so a partial run still leaves a coherent tree:

1. `fix(tasks): one shared inner inset, a filter row that fits its controls, and an employee filter`
2. `feat(ui): one consistency contract across every page` (only the pages you actually finished — name
   them in the message, and list the ones you did not touch in your report)

Commit only the files this brief produces.

## Report (the lead will re-measure in a browser)

With real command output: the measured insets before/after for the tab strip, filter row, chips, count and
table (numbers, not adjectives); the employee-filter behaviour and its audience; per page — what changed and
what you deliberately left alone; the new gate's result; all gates, `tsc`, the build; anything you did not
finish, with the reason. Name any place you left inconsistent rather than hiding it.

The lead serves the built demo from `frontend/dist` and will measure edges, chips, the count, keyboard and
RTL/mobile at 390px afterwards on every page they can reach, so make the numbers actually line up.
