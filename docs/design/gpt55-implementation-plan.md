# Frontend Redesign V2 Implementation Plan

> For implementation: execute this plan task-by-task in the frontend app. Do not add backend features. Keep the current visual-demo/mock-data behavior until a separate backend-integration task is authorized.

Goal: translate the approved final design specification into a concrete frontend implementation path for the existing React/Vite visual demo.

Architecture: refactor the current app from page-local card/dashboard markup into a reusable operational-desk component system: capability-shaped shell, attention-first page templates, semantic tables with mobile labelled rows, record headers, state/action blocks, append-only timelines, dialogs, and form/attachment patterns. Preserve the current routes, mock data flows, locale/theme state, demo affordances, accessibility foundations, and no-backend boundary while replacing the visual hierarchy and component structure.

Tech stack: React 19, TypeScript 6, Vite 8, react-router-dom 7, oxlint, CSS custom properties with logical properties, current mock data in `frontend/src/mock/data.ts`.

Implementation boundary:
- Modify only frontend application files during implementation.
- This planning task creates only `docs/design/gpt55-implementation-plan.md`.
- Do not invent backend endpoints, authorization, upload behavior, reports, employee administration, request-type administration, profile, or preferences as working features. Add UI structure only where current mock behavior supports it or keep target-only items out of nav.
- Preserve all existing routes:
  - `/login`
  - `/`
  - `/requests`
  - `/requests/new`
  - `/requests/:id`
  - `/timesheets`
  - `/timesheets/:id`
  - `/reviews`
  - `/reviews/requests/:id`
  - `/notifications`
- Preserve current visual-demo truth: no real authentication, no backend calls, no real attachment upload, local notification mark-read, local request/timesheet/decision acknowledgement copy.

---

## 1. Current frontend inventory translated into implementation constraints

### Files that currently own app behavior

- `frontend/src/main.tsx`
  - Owns all routes and shell nesting.
  - Preserve route list exactly.
  - Do not add empty HR/admin/report routes unless a separate task supplies behavior and mock fixtures.

- `frontend/src/app/AppContext.tsx`
  - Owns locale, direction, role, appearance, resolved theme, demo state controls, document title helper.
  - Preserve Arabic default, `html.lang`, `html.dir`, `data-theme`, System/Light/Dark behavior, role demo behavior, and current `usePageTitle` behavior.
  - Refactor only if needed to add capability-derived view-model helpers from current demo role.

- `frontend/src/app/AppShell.tsx`
  - Currently combines brand lockup, nav rail, demo banner, header controls, mobile drawer, notification badge, role switch, language/appearance selects, sign out, and reviewer state tools.
  - This is the largest shell refactor target.
  - Preserve skip link, demo banner, role switch, reviewer state controls, drawer Escape/focus return behavior, inert closed mobile drawer, and unread badge behavior.
  - Move production-like language/appearance/account controls into account/preferences UI only as a demo component; do not remove the ability to change locale/theme.
  - Fix `NavLink aria-current`: current JSX sets `aria-current="page"` on every nav link. Use NavLink active state so only the active link has `aria-current="page"`.

- `frontend/src/app/useMockList.ts`
  - Owns loading/error/empty/ready list state and date/minute formatters.
  - Preserve `ListState<T>` shape and reviewer forced-state support.
  - Add background-updating semantics only if supported without breaking existing demo controls.

- `frontend/src/components/ui.tsx`
  - Currently has status pills, banners, skeletons, empty/error states, and dialog.
  - This should become the base reusable component layer.
  - Replace emoji/platform glyphs with consistent inline SVG icons.
  - Preserve status text with icon, focus-trapped dialog, body scroll lock, Escape close before mutation, error/retry state, and minimum target sizing.
  - Fix dialog semantics to use `aria-labelledby` connected to visible heading, and optional `aria-describedby` where useful.

- `frontend/src/i18n/dict.ts`
  - Owns Arabic/English copy.
  - Extend copy in both languages for next actor, scope, attention sections, applied filters, correction reasons, read-only explanations, demo tools, attachment states, timeline actions, and confirmation summaries.
  - Keep Arabic primary and English meaning parity.
  - Use language option labels `العربية` and `English`, not flags.

- `frontend/src/mock/data.ts`
  - Owns all mock records, statuses, permissions, event history, attachments, and notifications.
  - Do not create new backend-like features here unless required to render currently planned states. Prefer derived view-model helpers over expanding fake domain behavior.
  - Preserve request statuses: `DRAFT`, `PENDING_MANAGER`, `PENDING_HR`, `APPROVED`, `REJECTED`, `RETURNED`, `CANCELLED`.
  - Preserve timesheet statuses: `DRAFT`, `SUBMITTED`, `RETURNED`, `APPROVED`, `REJECTED`.
  - Add only harmless mock fields if the frontend needs to display design-required labels currently derivable from events, such as correction reason or next stage. If added, document clearly as demo data.

- Screens:
  - `frontend/src/screens/LoginPage.tsx`
  - `frontend/src/screens/HomePage.tsx`
  - `frontend/src/screens/MyRequestsPage.tsx`
  - `frontend/src/screens/MyTimesheetsPage.tsx`
  - `frontend/src/screens/RequestDetailPage.tsx`
  - `frontend/src/screens/TeamReviewsPage.tsx`
  - `frontend/src/screens/NotificationsPage.tsx`
  - Refactor screens to use reusable page templates/components, remove inline style blocks, and keep current mock behavior.

- Styles:
  - `frontend/src/styles/tokens.css`
  - `frontend/src/styles/global.css`
  - Replace candidate token names with the final six primitive tokens and derived aliases.
  - Continue using CSS logical properties.
  - Move away from universal `.card` as default page grammar.
  - Keep global CSS if no CSS Modules are introduced, but structure it into clearly named sections.

### Preservation requirements from current demo

Preserve:
- all routes listed above;
- `AppProvider` locale/theme/role behavior;
- Arabic-first RTL and English LTR parity;
- route/page document titles;
- skip link to `#main-content`;
- current demo banner stating mock data;
- reviewer view-state controls for error and empty list states, but isolate them from product chrome;
- loading/error/empty/ready state branches;
- request status filter behavior, even if upgraded to URL query state;
- new-request validation, draft/submit local acknowledgement, busy state, and unsaved-leave warning;
- disabled/no-real-upload attachment demo truth;
- request detail safe unavailable fallback;
- timesheet week list, seven-day editor, duration and unpaid-break minute fields, hours/minutes totals, read-only submitted/approved behavior;
- review queue capability gating for employee direct URL access;
- review tabs with WAI-ARIA tabs and direction-aware arrow-key movement;
- decision dialog with no preselected decision, required reason for reject/return, progress/success acknowledgement;
- notifications read/unread labels, accessible unread badge, local mark-read, unavailable related-record safety;
- `bdi`/LTR isolation for mixed IDs, filenames, dates, email-like strings, and user content;
- 44px target minimums, visible focus, reduced-motion support, drawer Escape/focus return.

---

## 2. Reusable component architecture

Create or refactor toward this structure. File names are recommendations; implementation may keep components in `components/ui.tsx` temporarily only for very small helpers, but the final state should avoid one oversized mixed-purpose file.

### New component folders

Create:
- `frontend/src/components/brand/BrandLockup.tsx`
- `frontend/src/components/icons/Icon.tsx`
- `frontend/src/components/layout/PageHeader.tsx`
- `frontend/src/components/layout/AppTopBar.tsx`
- `frontend/src/components/layout/NavRail.tsx`
- `frontend/src/components/layout/MobileDrawer.tsx`
- `frontend/src/components/layout/DemoToolsPanel.tsx`
- `frontend/src/components/layout/AccountMenu.tsx`
- `frontend/src/components/state/AttentionStrip.tsx`
- `frontend/src/components/state/StatusPill.tsx`
- `frontend/src/components/state/StatusActionBlock.tsx`
- `frontend/src/components/state/LoadingState.tsx`
- `frontend/src/components/state/EmptyState.tsx`
- `frontend/src/components/state/ErrorState.tsx`
- `frontend/src/components/data/OperationalTable.tsx`
- `frontend/src/components/data/MobileRecordBlock.tsx`
- `frontend/src/components/data/FilterToolbar.tsx`
- `frontend/src/components/data/AppliedFilters.tsx`
- `frontend/src/components/record/RecordHeader.tsx`
- `frontend/src/components/record/Timeline.tsx`
- `frontend/src/components/record/AttachmentList.tsx`
- `frontend/src/components/forms/FormField.tsx`
- `frontend/src/components/forms/ErrorSummary.tsx`
- `frontend/src/components/dialog/Dialog.tsx`
- `frontend/src/components/dialog/DecisionDialog.tsx`

Optional if useful:
- `frontend/src/domain/viewModels.ts`
- `frontend/src/domain/status.ts`
- `frontend/src/domain/dates.ts`
- `frontend/src/domain/capabilities.ts`

### Component contracts

#### BrandLockup

Files:
- Create: `frontend/src/components/brand/BrandLockup.tsx`
- Modify: `frontend/src/app/AppShell.tsx`
- Modify: `frontend/src/screens/LoginPage.tsx`

Contract:
- Render composed clipboard mark as SVG with one restrained violet slip.
- Render product name as live text with `translate="no"`.
- Arabic brand text: `هي فوضى؟`.
- English rendering: `Heya Fawda?`.
- Descriptor: `شؤون الموظفين` / `Employee Operations`.
- Tagline only on sign-in or first-use empty states with space; do not show tagline in dense operational pages.
- Do not mirror the logo.

#### Icon

Files:
- Create: `frontend/src/components/icons/Icon.tsx`
- Modify: `frontend/src/components/state/StatusPill.tsx`
- Modify all screens using literal `+`, `←`, `→`, `☰`, `✕`, `✓`, `↩`, `⏳`, `🗂️`.

Contract:
- Use one coherent inline SVG icon set.
- Decorative icons: `aria-hidden="true" focusable="false"`.
- Icon-only controls need an accessible name and 44x44 target.
- Mirror only directional icons: back, next, drawer direction, breadcrumb progression.
- Do not mirror logo, checkmark, clock, paperclip, calendar, download, status symbol, numeric axes, or timeline chronology.
- No emoji product icons.

#### PageHeader

Files:
- Create: `frontend/src/components/layout/PageHeader.tsx`
- Modify all screens.

Contract:
- Exactly one `h1` per page.
- Optional scope/freshness/subtitle line.
- At most one primary action in the header.
- On mobile, order title, scope/status, attention, primary action, content, recovery.
- Header and primary action stack at narrow width and at 200% zoom.

Props:
- `title: ReactNode`
- `subtitle?: ReactNode`
- `primaryAction?: ReactNode`
- `breadcrumb?: ReactNode`
- `meta?: ReactNode`

#### App shell components

Files:
- Split from `frontend/src/app/AppShell.tsx` into layout components.

Contract:
- Desktop: 248px logical inline-start rail, brand top, grouped nav below, account/demo tools bottom.
- Tablet: collapse rail into named drawer from top bar.
- Mobile: modal drawer from logical inline-start, focus trap, Escape before mutation, background inert, body scroll lock, focus return.
- Content max width: 1280px, centered.
- Main column max: 760px where appropriate; optional context column max: 320px on details/review pages.
- Demo role and state controls must remain available but clearly bounded as demo/reviewer tools, not production navigation or top-bar controls.
- Language and appearance belong in account/preferences UI, while still easy to access in demo.

Navigation grouping for current demo:
- My work: Home, My requests, My timesheets.
- Review work: Team reviews only for manager/HR demo roles.
- Updates: Notifications.
- Account/demo: language, appearance, sign out, demo role switch, reviewer state tools.

Do not add Organization, Employees, Request types, Reports links until real mock routes/behavior are explicitly implemented in a separate task.

#### StatusPill and StatusActionBlock

Files:
- Replace: status code blocks in `frontend/src/components/ui.tsx`
- Create: `frontend/src/components/state/StatusPill.tsx`
- Create: `frontend/src/components/state/StatusActionBlock.tsx`
- Modify screens using status pills.

Contract:
- Status is text + icon + color reinforcement, never color alone.
- Use final status mapping:
  - Draft/Cancelled: neutral.
  - Awaiting manager, Awaiting HR, Submitted: signal.
  - Approved: action.
  - Returned: signal with stronger logical-start rule and correction text, distinct from pending.
  - Rejected: critical.
- On every list/detail/review record, place status adjacent to next actor/stage and permitted action when known.
- Never display raw enums as primary copy.
- Manager approval that still requires HR must display Awaiting HR review, not Approved.

View-model helper should expose:
- localized status label;
- tone;
- icon name;
- next actor/stage label based on current mock status and request type;
- permitted action label;
- correction reason from latest RETURN event where available.

#### OperationalTable and MobileRecordBlock

Files:
- Create: `frontend/src/components/data/OperationalTable.tsx`
- Create: `frontend/src/components/data/MobileRecordBlock.tsx`
- Modify: `MyRequestsPage.tsx`, `MyTimesheetsPage.tsx`, `TeamReviewsPage.tsx`.

Contract:
- Desktop uses semantic `<table>` for comparison/list pages.
- Include caption, visible headers, `scope="col"`, row headers where useful, named record link in primary cell.
- Do not duplicate a generic Details link if title is already the navigation target.
- Mobile reflows records into labelled blocks with the same critical information; no unlabeled stacks.
- No page-level horizontal scroll at 320px.
- If any table remains horizontally scrollable, it must be in named focusable region with preserved headers.

#### FilterToolbar and AppliedFilters

Files:
- Create: `frontend/src/components/data/FilterToolbar.tsx`
- Create: `frontend/src/components/data/AppliedFilters.tsx`
- Modify: `MyRequestsPage.tsx`, `TeamReviewsPage.tsx`; optionally `MyTimesheetsPage.tsx`.

Contract:
- Start with supported search if implemented. For this demo, do not add search unless implemented against mock list and URL state.
- Status filter remains for requests.
- Show applied filters as removable chips plus Clear all.
- Show scope, result count, and query freshness from same list data.
- Preserve filter/sort/tab/page in URL query params where current route supports it.
- Locale/theme changes must preserve route/query and form state.

#### RecordHeader

Files:
- Create: `frontend/src/components/record/RecordHeader.tsx`
- Modify: `RequestDetailPage.tsx`, `TeamReviewsPage.tsx`, `MyTimesheetsPage.tsx` detail editor.

Contract:
- Request header contains title, type, localized status, requester where permitted, submitted and updated times, next actor/stage where permitted, permitted action, secondary ID.
- Timesheet header contains Monday–Sunday interval, organization timezone text, status, total recorded duration, last update if supplied by mock, permitted action/read-only explanation.
- Detail pages prioritize current state/next action before evidence and timeline.

#### Timeline

Files:
- Create: `frontend/src/components/record/Timeline.tsx`
- Modify: `RequestDetailPage.tsx`, `ReviewRequestDetailPage`, `TimesheetDetailPage` if events are shown.

Contract:
- Append-only vertical timeline in chronological order.
- Each event: localized action, actor where permitted, localized timestamp, localized from/to state description, comment/reason, secondary event/request ID where useful.
- Current event visually anchored; older events quieter but readable.
- Raw `CREATE`, `SUBMIT`, `APPROVE`, `RETURN`, raw statuses cannot be the primary line.

#### AttachmentList

Files:
- Create: `frontend/src/components/record/AttachmentList.tsx`
- Modify: `RequestDetailPage.tsx`, `NewRequestPage`.

Contract:
- In this demo, keep no-real-upload truth.
- Detail file rows show isolated filename, type, formatted size, scan state, created time.
- Scan states: pending uses signal; clean uses action; quarantined/failed uses critical.
- Pending/quarantined files must not look ready for approval.
- Do not hard-code universal production limits as authoritative policy. Existing fixed demo note must be labelled as demo/unavailable if retained.

#### Dialog and DecisionDialog

Files:
- Create/replace: `frontend/src/components/dialog/Dialog.tsx`
- Create: `frontend/src/components/dialog/DecisionDialog.tsx`
- Modify: `TeamReviewsPage.tsx`.

Contract:
- Dialog root: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` to visible heading, optional `aria-describedby`.
- Initial focus: first meaningful control or heading based on task context.
- Trap focus, Escape before mutation, body scroll lock, background inert if possible, restore focus to invoker.
- Backdrop may close before mutation begins; do not close if it would silently discard entered decision reason.
- Decision dialog: no preselected decision; approve/reject/return separate; reject and return require visible reason; confirmation names record, employee, current state/version, selected decision, resulting next stage where known, reason/comment.
- In demo, success may remain local acknowledgement but copy must say decision recorded in demo and not imply server authority beyond the mock.

---

## 3. Styling and token plan

### Token replacement

Modify:
- `frontend/src/styles/tokens.css`
- `frontend/src/styles/global.css`

Implement final six primitive tokens exactly:

Light:
- `--color-ink: #172033`
- `--color-canvas: #F5F7F9`
- `--color-surface: #FFFFFF`
- `--color-action: #0F766E`
- `--color-signal: #6D28D9`
- `--color-critical: #B91C1C`

Dark:
- `--color-ink: #F8FAFC`
- `--color-canvas: #0F172A`
- `--color-surface: #1E293B`
- `--color-action: #5EEAD4`
- `--color-signal: #C4B5FD`
- `--color-critical: #FCA5A5`

Derived aliases are allowed and preferred:
- `--text: var(--color-ink)`
- `--canvas: var(--color-canvas)`
- `--surface: var(--color-surface)`
- `--primary: var(--color-action)` during migration only, then replace usage with `--color-action`.
- `--focus: var(--color-signal)`
- `--border-subtle: color-mix(...)`
- `--surface-subtle: color-mix(...)`
- `--status-pending-bg`, `--status-returned-bg`, etc., derived only with `color-mix()` from the six primitives.

Rules:
- Do not introduce a seventh primitive token.
- Focus: 3px `--color-signal` outer ring with at least 2px separation.
- Forced-colors: add `@media (forced-colors: active)` styles for borders/focus/system colors.
- Use `color-scheme: light/dark` according to resolved theme.

### Typography

Modify:
- `frontend/src/styles/tokens.css`
- `frontend/src/styles/global.css`

Rules:
- Arabic font stack: `Noto Sans Arabic`, `Segoe UI`, `Tahoma`, `sans-serif`.
- Latin font stack: `Inter`, `Segoe UI`, `system-ui`, `sans-serif`.
- Do not self-host fonts until license/assets review. Use fallbacks if not present.
- Page `h1`: 32px desktop, 28px mobile, weight 700.
- Section `h2`: 22px, weight 700.
- Record title: 18px, weight 700.
- Body/controls: 16px.
- Metadata/helper: 14px.
- Operational total: max 30px and only with label/destination.
- Do not shrink Arabic to solve wrapping. Allow vertical growth.
- Use tabular numerals for dates/durations.

### Layout and density

Modify:
- `frontend/src/styles/global.css`

Rules:
- 4px spacing scale: 4, 8, 12, 16, 24, 32, 48, 64.
- Page inline padding: desktop 32px, tablet 24px, mobile 16px.
- Desktop rail: 248px.
- Content max: 1280px.
- Reading column: max 760px.
- Context column: max 320px.
- Working-surface radius: 8px.
- Dialog radius: 12px.
- Status-pill radius: fully rounded.
- Use dividers for tables/evidence; do not make `.card` the universal structure.

Replace current universal `.card` usage with specific classes:
- `.work-surface`
- `.quiet-inset`
- `.attention-strip`
- `.record-block`
- `.summary-strip`
- `.timeline`
- `.operational-table`
- `.empty-region`
- `.error-region`

Retain `.card` only as a transitional alias or for mobile/coherent object blocks; remove broad reliance screen by screen.

---

## 4. Exact implementation order

### Phase 0 — Baseline and safety check

Objective: record current behavior before visual churn.

Files:
- No source changes required except optional generated screenshots if the implementation task includes them.

Steps:
1. Run `git status --short --branch` from repository root and confirm branch is `design/frontend-redesign-v2`.
2. Run `cd frontend && npm install` if dependencies are missing.
3. Run `npm run lint`.
4. Run `npm run build`.
5. Record any pre-existing failures before editing.

Expected:
- Lint/build should pass or any pre-existing failures are documented before redesign work starts.

### Phase 1 — Domain view-model helpers before markup changes

Objective: centralize status, next actor/stage, correction reason, event labels, week interval, and capability-derived labels so screens stop hand-assembling workflow meaning.

Files:
- Create: `frontend/src/domain/status.ts`
- Create: `frontend/src/domain/viewModels.ts`
- Create: `frontend/src/domain/dates.ts`
- Modify: `frontend/src/i18n/dict.ts`
- Modify: screens only enough to adopt helpers where low risk.

Implement:
- `getRequestStatusMeta(status, t)`
- `getTimesheetStatusMeta(status, t)`
- `getRequestNextStage(request, locale)`
- `getTimesheetNextStage(timesheet, locale)`
- `getPermittedRequestAction(request, viewerContext, locale)`
- `getPermittedTimesheetAction(timesheet, viewerContext, locale)`
- `getLatestCorrectionReason(record)` from latest event action `RETURN` or returned status event with comment.
- `localizeEventAction(action, locale)`
- `localizeStatusTransition(from, to, locale)`
- `formatWeekInterval(weekStart, locale)` returning Monday–Sunday interval.
- `formatFileSize(bytes, locale)`.

Do not:
- change mock state transitions;
- claim server authority;
- infer a person not present in mock data.

Verify:
- `npm run lint`
- `npm run build`

### Phase 2 — Expand i18n copy with parity

Objective: add all UI strings required by the reusable components without hard-coded fragments in screens.

Files:
- Modify: `frontend/src/i18n/dict.ts`

Add keys for:
- scope labels: active direct reports only, demo scope, personal work, review work, updates, account/demo;
- attention section labels;
- next actor/stage labels: you, manager reviewing, HR reviewing, read-only, unknown/not disclosed;
- filter labels: applied filters, clear all, result count, freshness, all statuses;
- request list columns: next stage, submitted/draft, action;
- timesheet columns: week interval, organization timezone, total recorded, total break;
- timeline actions: created, submitted, approved, rejected, returned, cancelled;
- attachment states: uploading, pending scan, clean, failed/quarantined, unavailable upload demo;
- decision dialog copy: choose decision, resulting state, required reason, version context, demo recorded;
- empty states: first use, filter empty, no pending review, no week, no access;
- unknown outcome/conflict copy for future placeholders, but do not wire fake flows unless mock supports them.

Rules:
- Arabic copy first, English parity by meaning.
- No concatenated fragments for sentence-like copy where grammar differs.
- No flags for language.

Verify:
- `npm run lint`
- `npm run build`

### Phase 3 — Token and global style foundation

Objective: implement final visual primitives and layout utilities without changing screen structure heavily.

Files:
- Modify: `frontend/src/styles/tokens.css`
- Modify: `frontend/src/styles/global.css`

Implement:
- final six primitive tokens and derived aliases;
- font scale;
- spacing/radius/control tokens;
- focus ring;
- forced-colors support;
- reduced-motion support for skeleton/dialog/spinner/transitions;
- new layout classes: `.page`, `.page-header`, `.work-surface`, `.quiet-inset`, `.attention-strip`, `.record-header`, `.status-action-block`, `.operational-table`, `.mobile-record-list`, `.record-block`, `.timeline`, `.attachment-list`, `.filter-toolbar`, `.applied-filters`, `.dialog` refinements.

Do not:
- remove old class names until screens are migrated;
- use gradients/shadows as hierarchy;
- introduce new primitive colors.

Verify:
- `npm run lint`
- `npm run build`
- Browser check at `/login` and `/` in Arabic/dark to confirm no global breakage.

### Phase 4 — Base components extraction

Objective: introduce reusable building blocks while keeping visual behavior stable enough to verify.

Files:
- Create component files listed in section 2.
- Modify: `frontend/src/components/ui.tsx` to either re-export or shrink to legacy wrappers.

Order:
1. `BrandLockup.tsx`.
2. `Icon.tsx`.
3. `PageHeader.tsx`.
4. `StatusPill.tsx` and `StatusActionBlock.tsx`.
5. `LoadingState.tsx`, `EmptyState.tsx`, `ErrorState.tsx`.
6. `Dialog.tsx`.
7. `Timeline.tsx`.
8. `AttachmentList.tsx`.
9. `OperationalTable.tsx`, `MobileRecordBlock.tsx`.
10. `FilterToolbar.tsx`, `AppliedFilters.tsx`.

Verification after each group:
- `npm run lint`
- `npm run build`

Acceptance for this phase:
- Existing screens still render.
- No duplicate `h1` introduced.
- No emoji icons remain inside base components.
- Dialog uses `aria-labelledby`, not only `aria-label`.

### Phase 5 — Shell redesign

Objective: implement the operational-desk frame while preserving demo controls and navigation behavior.

Files:
- Modify: `frontend/src/app/AppShell.tsx`
- Create/modify: `NavRail.tsx`, `AppTopBar.tsx`, `MobileDrawer.tsx`, `AccountMenu.tsx`, `DemoToolsPanel.tsx`, `BrandLockup.tsx`
- Modify: `frontend/src/styles/global.css`

Implementation details:
- Desktop rail width becomes 248px.
- Nav groups:
  - My work: Home, My requests, My timesheets.
  - Review work: Team reviews only when current demo role is manager or HR.
  - Updates: Notifications.
  - Account/demo: account menu, language, appearance, sign out, demo role switch, reviewer tools.
- Brand lockup at top with live text, `translate="no"` for brand name.
- Content top bar shows current section name, notifications entry, account/demo controls; keep role switch isolated and labelled demo.
- Language and appearance move under account/preferences menu but remain operable.
- Mobile drawer:
  - opens from logical inline-start;
  - traps focus while open;
  - Escape closes before mutation;
  - body scroll locked;
  - background inert;
  - focus returns to menu trigger.
- Fix active nav semantics. Only active link receives `aria-current="page"`.

Do not:
- show unimplemented HR/organization routes;
- flash broader nav while role/capability is changing;
- remove the demo banner.

Verify:
- `npm run lint`
- `npm run build`
- Keyboard: Tab to skip link, nav, account menu, language, appearance, demo tools.
- Mobile browser at 390px: open drawer, Tab through links, Escape close, focus returns to menu button.
- Employee role direct `/reviews`: safe unavailable page still appears.

### Phase 6 — Sign-in page redesign

Objective: align sign-in with approved brand and form contract while preserving demo sign-in.

Files:
- Modify: `frontend/src/screens/LoginPage.tsx`
- Modify: `frontend/src/styles/global.css`

Implementation details:
- Use `BrandLockup` with tagline here only.
- Structure: brand lockup → `h1` → auth fields → primary sign-in action → language/appearance access → clearly bounded demo role/data notice.
- Keep role picker, but present it as demo-only region, not production auth.
- Preserve validation, busy state, password show/hide, autocomplete, no real auth claim.
- Ensure fields have visible labels, stable error association, and no paste blocking.

Verify:
- `npm run lint`
- `npm run build`
- Browser: empty email focuses email; empty password focuses password; role sign-in still navigates home; language/theme changes preserve typed values.
- Keyboard-only sign-in path works.

### Phase 7 — Notifications page redesign

Objective: migrate simplest list page to new list/activity pattern.

Files:
- Modify: `frontend/src/screens/NotificationsPage.tsx`
- Use: `PageHeader`, `LoadingState`, `ErrorState`, `EmptyState`, `StatusPill`/read-state label, `MobileRecordBlock` or compact activity list.

Implementation details:
- Show compact activity list, not repeated generic cards.
- Preserve unread/read text labels and mark-read local behavior.
- Preserve safe unavailable related-record copy.
- Add scoped count/freshness line from loaded data.
- Keep `bdi` around body text and related IDs where shown.
- Do not claim server-confirmed mark-read; if success copy appears, label it as demo/local.

Verify:
- `npm run lint`
- `npm run build`
- Browser: mark unread item as read; unavailable related record remains safe; empty/error demo tools affect list state.

### Phase 8 — Request detail and review detail redesign

Objective: implement record header, status-action block, evidence sections, attachment list, and localized timeline.

Files:
- Modify: `frontend/src/screens/RequestDetailPage.tsx`
- Modify: `frontend/src/screens/TeamReviewsPage.tsx` for `ReviewRequestDetailPage`
- Use: `RecordHeader`, `StatusActionBlock`, `AttachmentList`, `Timeline`, `PageHeader`.

Implementation details:
- Back/breadcrumb uses semantic directional icon that mirrors correctly.
- Record header displays title, type, status, requester where permitted, submitted/updated, next stage, permitted action if current user can act, secondary ID.
- Details/evidence region follows header.
- Attachments use `AttachmentList` with scan state labels.
- Timeline localizes action/status transitions and shows actor/time/comment.
- Returned request shows correction reason prominently above evidence/editor path.
- Raw enums are secondary at most, never primary copy.
- Review detail keeps decision note that decisions currently happen from queue unless a decision action is added here; do not add unimplemented mutation behavior.

Verify:
- `npm run lint`
- `npm run build`
- Browser: `/requests/r-1002` shows returned correction reason; `/requests/r-9999` safe unavailable; `/reviews/requests/r-2001` manager/HR view; employee direct access remains safe through review route behavior.

### Phase 9 — Home page redesign

Objective: replace dashboard card grid with attention-first operational overview.

Files:
- Modify: `frontend/src/screens/HomePage.tsx`
- Use: `PageHeader`, `AttentionStrip`, `StatusActionBlock`, compact work queue/list components.

Implementation details:
- Page structure:
  1. H1 and greeting/scope/freshness.
  2. Attention strip only for returned work, actionable review work, blocking/updating state.
  3. Primary actions: New request, Open timesheet.
  4. My work queue: returned requests/timesheets first, then pending employee action/submitted statuses.
  5. Current week timesheet with status/read-only action.
  6. Recent notifications compact list.
  7. Scoped review preview for manager/HR only.
- Stop using KPI gallery. Counts appear only when computed from the same array used by destination preview.
- Fix current issue: `pendingTeam` must not count all team records as pending if the label says queue. Filter to actionable statuses (`PENDING_MANAGER` for requests, `SUBMITTED` for timesheets) and same data used by review page.
- Use current mock week but label it demo current week if needed; do not imply backend freshness.
- Manager/HR personal work and review work must be visually separated.
- HR must not look like superuser; current demo HR review access remains review capability only.

Verify:
- `npm run lint`
- `npm run build`
- Browser: employee home shows no review section; manager/HR home shows separate review preview; returned request is first attention item; no fake zero while loading.

### Phase 10 — My requests list and new request editor redesign

Objective: align request list/editor with operational table and policy-aware form pattern.

Files:
- Modify: `frontend/src/screens/MyRequestsPage.tsx`
- Use: `PageHeader`, `FilterToolbar`, `AppliedFilters`, `OperationalTable`, `MobileRecordBlock`, `StatusActionBlock`, `FormField`, `ErrorSummary`, `AttachmentList` demo state.

List implementation details:
- Desktop table columns in decision-value order:
  1. named request title link + request type;
  2. status;
  3. next actor/stage where permitted;
  4. submitted date or Draft;
  5. last update;
  6. one permitted action only when distinct from title link.
- Remove duplicated generic Details column when title link is the same action.
- Status filter should be reflected in URL query params (`?status=RETURNED`) so back/return context is preserved.
- Show applied filter chip and Clear all.
- Show result count and demo freshness line.
- Returned rows include correction reason from latest return event.
- Mobile rows are labelled blocks with same critical fields.

Editor implementation details:
- Structure: breadcrumb → H1/state → returned/blocking reason if any → request type → review path explanation → title → details → attachments demo region → action summary → Save draft/Submit request.
- Keep one page; do not create wizard.
- Employee never chooses approver.
- Before submit, show concise confirmation summary naming request, current state, and resulting review stage. In demo, this can be inline confirmation before local submit.
- Validation summary appears before form and links/focuses invalid fields.
- Preserve valid fields after validation failure and locale/theme changes.
- Preserve existing unsaved-leave warning; if possible extend to browser navigation in a separate task, but do not block current route behavior unless tested.
- Attachment upload remains disabled/unavailable with explicit demo copy; do not hard-code server policy as real.

Verify:
- `npm run lint`
- `npm run build`
- Browser: filter status, URL updates; back from detail preserves status query; invalid submit focuses summary/title; save draft and submit still acknowledge locally and navigate as before; 390px/320px show labelled rows, not horizontal page scroll.

### Phase 11 — My timesheets list and weekly editor redesign

Objective: preserve Monday–Sunday minute-entry flow while meeting week/time/read-only/mobile requirements.

Files:
- Modify: `frontend/src/screens/MyTimesheetsPage.tsx`
- Use: `PageHeader`, `OperationalTable`, `MobileRecordBlock`, `RecordHeader`, `StatusActionBlock`, `FormField`, `ErrorSummary`.

List implementation details:
- Desktop list/table columns:
  1. localized Monday–Sunday interval;
  2. organization timezone context as demo text if not in data;
  3. status;
  4. total recorded duration in hours/minutes;
  5. last update if derivable from latest event, otherwise omit;
  6. permitted action.
- Mobile row blocks with visible labels.

Editor implementation details:
- Header: week interval, organization timezone context, status, read-only explanation when applicable.
- Exactly seven Monday–Sunday rows/sections.
- Desktop: table with dates as row headers.
- Mobile: seven labelled day sections, no spreadsheet-style horizontal interaction.
- Fields: work date, duration minutes, unpaid break minutes, optional description.
- Totals: recorded-time and unpaid-break separately in hours/minutes, never decimal.
- Submitted/approved/rejected read-only; returned editable; draft editable.
- Submission confirmation states sheet becomes read-only. In demo, local success must not pretend persisted server state changed unless local state is actually updated.
- Add client validation display for negative/out-of-range values only if implemented fully with preserved input. Otherwise keep current min/max and note server-authoritative validation.

Verify:
- `npm run lint`
- `npm run build`
- Browser: seven day rows render for every timesheet; modifying draft updates totals; submitted/approved read-only fields disabled with visible explanation; 320px mobile reflows to labelled day sections.

### Phase 12 — Team reviews queue and decision workflow redesign

Objective: convert review cards to scoped operational queues and strengthen decision dialog truthfulness.

Files:
- Modify: `frontend/src/screens/TeamReviewsPage.tsx`
- Use: `PageHeader`, `FilterToolbar`, `OperationalTable`, `MobileRecordBlock`, `StatusActionBlock`, `DecisionDialog`.

Queue implementation details:
- Preserve employee access denial for direct `/reviews`.
- Header shows scope: active direct reports only, demo scope.
- Tabs remain Requests/Timesheets with WAI-ARIA tabs pattern and direction-aware arrow movement.
- Add result count, applied filters if any, deterministic ordering note.
- Desktop request review table columns:
  1. named request link and type;
  2. employee;
  3. localized current state;
  4. submitted date;
  5. next stage after manager decision where known;
  6. available review action.
- Desktop timesheet review table columns:
  1. named week interval;
  2. employee;
  3. localized current state;
  4. total recorded duration;
  5. submitted date where supplied/derivable;
  6. available review action.
- No bulk decisions.
- Requester must not appear in own review queue. Current mock data already uses separate team records; keep it that way.

Decision dialog implementation details:
- Approve/Reject/Return separate choices; no preselected choice.
- Reject/Return require reason.
- Current state is localized label, not raw enum.
- Summary names record, employee, version, chosen decision, resulting next stage where known.
- During local submit, prevent duplicate activation and announce progress.
- After local demo success, close/restore focus to meaningful queue action or row.
- Do not claim queue refreshed from server in this demo; copy can say demo decision recorded locally if no mutation actually updates the row.

Verify:
- `npm run lint`
- `npm run build`
- Browser: tab arrow keys work RTL/LTR; decision requires reason for reject/return; approve path has no preselected adverse choice; focus returns after dialog close; mobile dialog scrolls and final action remains reachable.

### Phase 13 — Responsive, RTL/LTR, and accessibility sweep

Objective: fix regressions after screen migration.

Files:
- Modify any changed components/styles as findings require.

Manual browser matrix:
- Arabic RTL light at 320px.
- Arabic RTL dark at 390px.
- English LTR light at 390px.
- English LTR dark desktop.
- Representative tablet width 768px.
- Desktop 1024px and 1280px.
- Desktop at 200% zoom.
- 320px with increased text spacing if tooling permits.
- Reduced motion enabled.
- Forced colors if browser/OS supports it.

Required checks:
- No page-level horizontal scroll at 320px.
- No clipped Arabic labels/status/buttons/errors.
- Focus ring visible and not hidden by sticky/fixed UI.
- Mobile drawer focus trap, Escape, inert background, scroll lock, focus return.
- Decision dialog focus trap, Escape before mutation, scrollability, reason field and final action reachable.
- Tables become labelled mobile rows except genuinely tabular regions.
- Locale/theme changes preserve route, query, active record, meaningful focus where practical, and unsaved form input.
- Mixed-script names, IDs, filenames, dates use `bdi`/LTR isolation.
- Status/read/unread/required/validation do not rely on color alone.

Automated commands:
- `cd frontend && npm run lint`
- `cd frontend && npm run build`

Optional but recommended if dependencies are approved in implementation task:
- Add Vitest + Testing Library route smoke tests before or during this phase.
- Add Playwright browser checks only if accepted by project maintainers.

### Phase 14 — Real-browser verification and screenshots

Objective: prove the implemented redesign renders and behaves in an actual browser.

Commands:
- `cd frontend && npm run build`
- `cd frontend && npm run preview -- --host 127.0.0.1`

Browser journeys:
1. `/login` Arabic RTL dark: sign in as Employee.
2. Home: verify attention-first order and no KPI gallery.
3. `/requests`: filter returned status, open returned request, back preserves context.
4. `/requests/new`: validation, save draft, submit local acknowledgement, unsaved-leave warning.
5. `/timesheets`: open draft, edit minutes, verify totals, submit local acknowledgement; open read-only submitted/approved record.
6. Switch Manager demo role; `/reviews`: requests/timesheets tabs, decision dialog approve/reject/return.
7. `/notifications`: mark read, unavailable record copy.
8. Switch English and repeat one list, one detail, one dialog.
9. Mobile 390px: drawer open/close, request list labelled rows, decision dialog reachable.
10. 320px: no horizontal page scroll, no hidden primary/recovery action.

Save screenshots only if the implementation task asks for artifact updates. Do not update README screenshot paths unless screenshots are actually regenerated.

---

## 5. Tests and verification plan

### Current required commands

Always run after meaningful code changes:
- `cd frontend && npm run lint`
- `cd frontend && npm run build`

Expected:
- `npm run lint` exits 0.
- `npm run build` exits 0 and emits Vite production build output.

### Recommended test additions

Because current frontend has no test runner, add tests only if the implementation scope allows dev dependency changes.

If allowed, add:
- `vitest`
- `@testing-library/react`
- `@testing-library/jest-dom`
- `jsdom`
- `@testing-library/user-event`

Add scripts to `frontend/package.json`:
- `"test": "vitest run"`
- optional `"test:watch": "vitest"`

Suggested tests:
- route smoke tests for all current routes;
- locale/theme context preserves `html.lang`, `html.dir`, `data-theme`;
- status helpers map every request/timesheet status to localized label and tone;
- request list filter URL state;
- review tabs arrow-key movement in RTL and LTR;
- decision dialog reason required for reject/return;
- dialog Escape/focus restoration;
- timesheet total formatter and seven-day generation;
- no employee review data on direct `/reviews` route.

Do not delay the redesign on test-runner setup if package installation is blocked. In that case, document manual browser verification results and keep lint/build as the hard commands.

### Accessibility verification

Manual journeys that must pass keyboard-only:
- sign-in;
- request creation/submission;
- returned request correction path as far as current mock supports it;
- timesheet entry/submission;
- manager decision;
- mobile drawer;
- notification mark-read;
- language/appearance changes.

Screen-reader pass:
- At least one Arabic page with list/detail/dialog.
- At least one English page with list/detail/dialog.

Automated a11y tools are not currently configured. If Playwright/axe is approved later, add checks route by route.

---

## 6. Responsive and RTL implementation rules

Global rules:
- Use CSS logical properties for layout, spacing, borders, positions, and drawer behavior.
- Set document `lang` and `dir` from current locale through existing `AppContext`.
- Do not reverse arrays for RTL.
- DOM and focus order follow task meaning in both languages.
- Mirror rail, drawer, breadcrumbs, back/next icons.
- Do not mirror logo, checkmark, clock, paperclip, calendar, download, status icon, timeline chronology.
- Wrap IDs/emails/URLs/filenames/request codes/mixed names in `bdi` or equivalent isolation.
- Use `dir="ltr"` for ID/email/date-code/numeric-entry controls where appropriate.
- Use `Intl.DateTimeFormat` and `Intl.NumberFormat` helpers where possible; avoid ambiguous numeric-only dates in explanatory copy.
- Do not shrink text to solve Arabic wrapping; allow vertical growth.

Breakpoints:
- 320–639px: mobile, one column, drawer shell, labelled record blocks, full-width principal actions where clearer.
- 640–1023px: tablet, drawer shell, one column by default; two columns only if each remains at least 300px.
- 1024px+: desktop rail and operational tables.
- Also collapse earlier if 200% zoom makes content unusable.

Mobile ordering:
1. page title;
2. scope/status;
3. attention/correction reason;
4. primary action;
5. content;
6. recovery/secondary actions.

---

## 7. Technical risks and mitigations

1. Risk: broad visual refactor breaks current demo behavior.
   - Mitigation: migrate one route at a time in the order above; run lint/build after each route; keep `ListState` and mock arrays unchanged until screen passes.

2. Risk: `AppShell` split breaks drawer a11y or nav state.
   - Mitigation: preserve behavior first, then restyle; manually test Escape, focus return, inert closed drawer, and active `aria-current` immediately after shell phase.

3. Risk: final six-token system removes existing info/warning colors that components depend on.
   - Mitigation: implement derived status aliases from six primitives with `color-mix()`; do not add new primitive hex values.

4. Risk: replacing cards with tables harms mobile usability.
   - Mitigation: implement `OperationalTable` with paired `MobileRecordBlock`; test 320px before migrating the next list.

5. Risk: current mock data lacks fields required by final design, especially next actor, organization timezone, correction reason, freshness, last update on timesheets.
   - Mitigation: derive from existing statuses/events where possible; show neutral demo copy where data is absent; do not invent named reviewers or backend policy.

6. Risk: current local success messages may imply server-confirmed behavior.
   - Mitigation: copy must remain honest: demo/local acknowledgement only. Do not use “server confirmed” language until backend integration exists.

7. Risk: demo role switching conflicts with capability-based final IA.
   - Mitigation: keep role switch as explicitly bounded demo tool. Structure nav through a `capabilitiesForDemoRole(role)` helper so later server capabilities can replace it without screen rewrites.

8. Risk: raw enums appear in timeline/dialogs after refactor.
   - Mitigation: all event/status output must flow through domain localization helpers; add build-time TypeScript exhaustiveness checks for status/action maps.

9. Risk: Arabic/English copy parity becomes inconsistent as keys expand.
   - Mitigation: add every key in both `ar` and `en` in the same patch; run TypeScript build to catch missing dict keys.

10. Risk: no automated test runner means regressions can hide.
    - Mitigation: use lint/build and real-browser route checklist as required verification; add Vitest only if dependency changes are approved.

11. Risk: current timesheet date generation has fragile string replacement for second day entries in mock data.
    - Mitigation: do not alter mock data unless separately planned; editor should generate canonical seven-day rows from `week_start` and merge entries by exact `work_date`.

12. Risk: contrast of derived washes is not guaranteed.
    - Mitigation: measure actual foreground/background pairs during final verification; adjust derived mixes, not primitive tokens, unless design authority changes.

13. Risk: account/preferences UI is not a real route.
    - Mitigation: implement as shell menu/panel only for current language/appearance/sign-out/demo controls; do not create `/preferences` route unless authorized.

14. Risk: HR final spec includes destinations not present in demo.
    - Mitigation: do not add empty links. Mention target capability grouping in code comments or future task notes only; current app exposes only implemented routes.

---

## 8. Implementation acceptance checklist

The redesign implementation is complete only when:

- All existing routes render without broken navigation.
- Employee, manager, and HR demo roles see the same or stricter route/action visibility as before.
- Demo role/state tools remain accessible but isolated from product chrome.
- Arabic remains the default locale and RTL direction.
- English LTR has meaning parity.
- Light/Dark/System still work and preserve current route/form state.
- Home is attention-first and no longer a KPI-card gallery.
- My requests uses a desktop semantic table and mobile labelled rows.
- Team reviews uses desktop semantic tables/compact rows and mobile labelled rows, not repeated cards.
- Request/timesheet details show status, next stage/action context, evidence, attachments, and timeline in correct priority.
- Weekly timesheet editor always shows seven Monday–Sunday sections/rows, minute fields, separate recorded and unpaid-break totals, and read-only explanation where applicable.
- Decision dialog has no preselected decision and requires reason for reject/return.
- Raw enums are not primary user-facing copy.
- Emoji/platform glyphs are not used as product icons.
- Mobile drawer and dialogs preserve focus/keyboard behavior.
- No page-level horizontal scrolling at 320px.
- `npm run lint` passes.
- `npm run build` passes.
- Real-browser verification checklist in Phase 14 has been executed and results documented in the implementation handoff.

---

## 9. Out of scope for this redesign implementation

Do not implement or imply:
- real authentication;
- backend API integration;
- CSRF/session wiring;
- real attachment upload/download;
- real mark-read mutation;
- real decision persistence;
- payroll, benefits, leave balance calculation;
- biometric attendance or clock-in/out;
- productivity scoring, utilization, rankings, targets, deadlines, overdue labels;
- bulk approval;
- organization-wide manager access;
- employee-selected approvers;
- workflow builder;
- external messaging/chat/email;
- HR admin/report/request-type routes without explicit data and behavior;
- localStorage auth tokens.

---

## 10. Suggested implementation commit sequence

If implementation later uses commits, keep them small:

1. `refactor(frontend): add workflow view-model helpers`
2. `feat(frontend): add operational design components`
3. `style(frontend): align tokens with final design spec`
4. `refactor(frontend): split application shell components`
5. `feat(frontend): redesign sign-in and notifications pages`
6. `feat(frontend): redesign request detail timeline and attachments`
7. `feat(frontend): redesign attention-first home`
8. `feat(frontend): redesign request list and editor`
9. `feat(frontend): redesign timesheet list and weekly editor`
10. `feat(frontend): redesign team review queues and decision dialog`
11. `test(frontend): add route and interaction coverage` if tests are added
12. `docs(frontend): update screenshots and verification notes` only if screenshots/docs are actually regenerated

Do not commit during a planning-only task.
