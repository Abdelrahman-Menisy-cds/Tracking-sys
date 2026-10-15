# Brief H7b — finish the modernization sweep on the 8 remaining pages

You have **full permissions** (`--yolo`). Work autonomously; commit progressively (see Commits).

## Context

Brief H7 already landed two commits in `frontend/`:
- `9e8e7c3` — one shared inner inset on the tasks surface, a filter row that adapts to its child count,
  and the employee filter (`tasks-employee-filter`, team viewers only).
- `cc3a396` — the consistency contract applied to **7** pages: Tasks, Home, MyRequests, TaskDetail,
  Attendance, Login, AdminPeople, AdminSettings.

`docs/design/premium-design-direction.md` is the binding design authority. The shared language lives in
`src/components/layout/PageHeader.tsx` and the `work-surface` / `filter-toolbar` / `field` / `select` /
`btn` / `EmptyState` / `ErrorState` / `SkeletonRows` primitives in `src/styles/global.css`.

`frontend/scripts/verify-page-consistency.ts` already exists and passes with 13 checks — including "every
page renders the shared PageHeader", "every page renders a shared surface or table primitive", "page
containers carry no inline padding or margin", and "page inner inset is declared once". **It must still
pass, and you will extend it** (below).

## Your job — the 8 pages still unswept

```
src/screens/MyTimesheetsPage.tsx
src/screens/NotificationsPage.tsx
src/screens/ProfilePage.tsx
src/screens/RequestDetailPage.tsx
src/screens/TeamReviewsPage.tsx          (the largest — 453 lines)
src/screens/admin/AdminOverviewPage.tsx
src/screens/admin/AdminPeopleDetailPage.tsx
src/screens/admin/AdminAnnouncementsPage.tsx
```

The product owner asked: «لف على كل الصفحات وتظبطها تخليها مودرن وتخليها مناسبه ك ui ux» — go over every
page and make it modern and appropriate as UI/UX. Apply the SAME contract the landed commit used, page by
page, and finish it:

- **Header rhythm** — title + description + page actions through the shared header primitive, with the
  same spacing above and below as the pages already done. Page-level primary actions live in that header.
- **Surface edges** — every card/section/table on a page shares the same left/right edges as the page
  header and uses the one declared inner inset (the tasks fix collapsed three different insets into
  `--sp-page-inner`; do not reintroduce a second value). No inline `padding`/`margin` on page containers.
- **Filter grammar** — any page with filters uses the same toolbar → row → chips → result-count grammar as
  the tasks surface: same insets, same field+label pairing, same chip behaviour, same «مسح الكل», and a row
  layout that adapts to the controls actually present (no dead grid tracks, and it must still stack at
  390px). If a page has an ad-hoc filter bar, bring it onto this grammar.
- **Tables and lists** — one language (caption, header weight, row height, numeric alignment, status pill
  placement). Use `OperationalTable` rather than a page-local variant.
- **States** — every data page has a real empty state, a real error state with retry, and a loading state
  via the shared primitives, with consistent wording and layout. This is the most likely real gap on the
  pages you are touching — look for a bare `div` where a shared state belongs.
- **Forms and dialogs** — shared field/dialog grammar; label, hint, error and action ordering identical.
- **Buttons** — one hierarchy (primary/secondary/ghost) used the same way on every page; no page-local
  button styling.
- **RTL, EN, mobile** — no horizontal overflow, nothing cramped, tap targets >= 36-44px, long Arabic labels
  not clipped. Check each page in both locales at desktop and at 390px.
- **Do NOT change behaviour, data, permissions, or the meaning of any page.** This is UI/UX and consistency
  only. If you find a genuine functional bug, report it instead of silently changing logic.

If a page is already consistent, say so and leave it — the point is the contract holding, not a large diff.

## Hard constraints

1. **Keep every existing `data-testid`.** All 11 gates depend on them, including the lead's browser
   measurement. Never rename or drop one.
2. **No new colors and no new visual language** — only the approved tokens/primitives.
   `scripts/verify-task-status-bar.ts` enforces an approved-token whitelist on CSS; extend that discipline,
   never weaken it.
3. **No new date/time formatting** — everything through `src/app/useMockList.ts`
   (`scripts/verify-datetime-format.ts` scans sources).
4. **All 11 existing gates must still pass** unmodified in intent.
5. Stay inside `frontend/`. Do not touch `backend/`, `docs/`, `*.pdf`, `.claude/`, `.agents/`, `.hermes/`,
   or the fixtures' meaning.
6. No drive-by refactors beyond what this brief names.

## Extend the gate

Add assertions to `frontend/scripts/verify-page-consistency.ts` that fail loudly on regression and cover
what you fixed, e.g.: every page's data states go through the shared primitives (no bare empty/error div on
a page you touched); the 8 pages you swept use the shared filter grammar where they have filters; no page
reintroduces an inline page-container padding; no new hardcoded UI strings in the pages you touched
(filter/state copy lives in `dict.ts` in both locales). Keep the existing 13 checks intact.

## Commits

Commit progressively, in batches of 2-3 pages, so a partial run still leaves a coherent tree, e.g.
`feat(ui): consistency contract on <pages>`; name the pages in each message. Commit only files this brief
produces.

## Report

With real command output: per page — what changed and what you deliberately left alone; the extended gate's
result; **all** gates (`for g in scripts/verify-*.ts; do npx tsx "$g"; done`); `npx tsc -b`;
`npm run build:demo`. Name any page you did not finish, and any place you left inconsistent, rather than
hiding it.

The lead will re-measure edges, chips, the result count, keyboard and RTL/mobile at 390px on every page
they can reach, on top of the built demo, so make the numbers actually line up.
