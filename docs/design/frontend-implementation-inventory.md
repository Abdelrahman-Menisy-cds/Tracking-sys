# Frontend Implementation Inventory — design/frontend-redesign-v2

Status: PRE-DESIGN INVENTORY (non-destructive, read-only pass).
Baseline: branch `design/frontend-redesign-v2`, HEAD `68141e798038432eb0e74a09e53dd01f9ea1e2d9`.
Constraint in effect: final design spec not yet available (Opus report pending, Sonnet
report failed). No redesign changes were made in this pass; this document only inventories
what exists, what must be preserved, and where refactor seams are, plus a contingent
implementation sequence to execute once the final design spec lands.

## 1. Stack and project shape

- Location: `frontend/` (project-local, no global installs).
- Stack: React 19 + TypeScript (~6.0.2) + Vite 8 + react-router-dom 7. Lint: `oxlint`.
  Scripts: `npm run dev` / `build` (tsc -b && vite build) / `lint` / `preview`.
- Current nature: **visual demo build** — Arabic-first RTL clickable prototype, all data
  mock, no backend calls. Backend (Django + DRF, `backend/`) is untouched.
- No frontend test runner is installed (no vitest/jest in node_modules; no *.test.* files).
  Verification today = `npm run build`, `npm run lint`, headless-Chrome screenshots
  (`docs/screenshots/`, `docs/screenshots/uiux2/`).
- Total src size ≈ 3,400 lines across 17 files.

## 2. File map (src/)

| Path | Lines | Role |
|---|---|---|
| `main.tsx` | 37 | StrictMode, AppProvider, BrowserRouter, all routes |
| `app/AppContext.tsx` | 111 | locale/role/appearance context, theme+dir side effects, `usePageTitle` |
| `app/AppShell.tsx` | 259 | skip link, demo banner, nav rail, header controls, mobile drawer, reviewer state tools |
| `app/useMockList.ts` | 78 | async-list state hook (loading/error/empty/ready) + date/minutes formatters |
| `components/ui.tsx` | 183 | atoms: status pills, Banner, SkeletonRows, EmptyState, ErrorState, Dialog |
| `i18n/dict.ts` | 289 | bilingual dictionary (ar/en), Locale + Role types |
| `mock/data.ts` | 439 | mock data mirroring backend serializer shapes; `mockFetch` latency + failNext/loadingNext/emptyNext controls |
| `screens/LoginPage.tsx` | 160 | S01 sign-in (demo, role picker) |
| `screens/HomePage.tsx` | 128 | S02 role-scoped home summaries |
| `screens/MyRequestsPage.tsx` | 263 | S03 list + NewRequestPage (draft/submit editor) |
| `screens/RequestDetailPage.tsx` | 100 | S04 header, attachments, append-only history |
| `screens/MyTimesheetsPage.tsx` | 226 | S05 week list + weekly entry editor |
| `screens/TeamReviewsPage.tsx` | 364 | S06 review queue (tabs, ARIA tabs) + ReviewRequestDetailPage + decision modal |
| `screens/NotificationsPage.tsx` | 71 | S10 list, mark-read (local), unavailable-link safety |
| `styles/tokens.css` | 76 | design tokens from UX brand direction §8 (light/dark via `data-theme`) |
| `styles/global.css` | 603 | all component styles, logical properties for RTL mirroring |

Routes (`main.tsx`): `/login`, `/` (home), `/requests`, `/requests/new`,
`/requests/:id`, `/timesheets`, `/timesheets/:id`, `/reviews`,
`/reviews/requests/:id`, `/notifications`.

## 3. Existing functionality to preserve (regardless of final design)

Behavior that is working product + a11y functionality, not styling — it must survive any
redesign unless the final spec explicitly changes it:

1. **Routing and shell**: all 10 routes above; `AppShell` layout with nav rail; skip link
   (`#main-content`); demo banner (always visible); per-page document titles
   (`usePageTitle`, brand-first pattern).
2. **i18n**: Arabic-first RTL with full English parity via `dict.ts`; `dir`/`lang` set on
   `<html>`; logical CSS properties throughout global.css; `<bdi>` isolation for
   mixed-script names. Locale toggle in login + shell.
3. **Appearance**: light/dark/system with `prefers-color-scheme` listener, `data-theme`
   attribute on root; controls on login + shell.
4. **State machine per list**: loading (skeletons) → error (retry) → empty → ready, via
   `useMockList`. Reviewer demo controls (`failNext/loadingNext/emptyNext` in
   `stateDemoControl`, sidebar tools in AppShell) preview these states.
5. **Requests flow**: status filter; new-request editor with validation, draft/submit;
   detail page with attachments table (scan status) and append-only event history;
   safe "record unavailable" fallback for missing ids.
6. **Timesheets**: week list; weekly editor with per-day entries, unpaid-break minutes,
   totals in h/min (`formatMinutes` — never decimal hours); submit with confirmation.
7. **Review queue (manager/HR only)**: capability-scoped nav; requests/timesheets tabs in
   WAI-ARIA tabs pattern (arrow keys); approve/reject/return decision modal — explicit
   confirmation, mandatory visible reason for reject/return, no preselected adverse
   decision, focus-trapped dialog, body scroll lock.
8. **Notifications**: unread badge count with accessible label; mark-read with error
   state; notifications linking to unavailable records degrade safely.
9. **Accessibility inventory** (verified per README): skip link, keyboard-visible focus,
   ARIA tabs, Escape-to-close mobile drawer with focus return, scroll lock, `<bdi>`,
   status = text+icon (never color-only), 44px control min-height.
10. **Contract alignment**: mock types (`RequestMock`, `TimesheetMock`, `AttachmentMock`,
    `NotificationMock`, statuses) mirror backend serializers
    (`backend/reqs|review|timesheets|notifications/serializers.py`) and API `/api/v1/...`.
    Status enums: request DRAFT/PENDING_MANAGER/PENDING_HR/APPROVED/REJECTED/RETURNED/CANCELLED;
    timesheet DRAFT/SUBMITTED/RETURNED/APPROVED/REJECTED.
11. **Security posture**: no auth in demo; no secrets in bundle; real integration must use
    the CSRF/session endpoints (`auth/csrf`, `auth/login`, `auth/logout`, `auth/me`) —
    never localStorage tokens (team rule).

## 4. Likely refactor seams (where the code will bend under a redesign)

These are the points where current structure couples presentation to demo data / inline
styles; a redesign will touch them first. Listed so changes stay additive and reviewable.

1. **`styles/global.css` (603 lines, single file)** — all styling in one sheet keyed to
   current markup. First seam: split per-component/section or retokenize against the new
   spec; tokens.css is small (76 lines) and is the intended swap point.
2. **Tokens** — `tokens.css` already names semantic roles (`--canvas`, `--surface`,
   `--primary`, spacing scale, radii). If the new spec ships a token sheet, mapping
   old→new names in tokens.css is the lowest-blast-radius path; global.css keeps using
   the semantic names.
3. **Inline `style={{...}}` props across screens** (HomePage, MyTimesheetsPage,
   RequestDetailPage, AppShell nav header) — layout mixed into JSX. Migration to
   utility/global classes is required before any layout redesign.
4. **`mock/data.ts` + `useMockList`** — data access is a direct import + promise wrapper.
   The clean seam is a thin data-layer interface (e.g. `apiClient` with the same
   signatures) so screens swap `mockFetch(x)` → real endpoints without screen rewrites.
   Real integration also replaces reviewer state controls with genuine loading/error
   states — keep `useMockList`'s `ListState` union shape as the screen contract.
5. **`ui.tsx` atoms** — pills/banners/dialog encode current visual language via class
   names (`pill-info`, `banner-error`). Restyling keeps the components' props stable and
   changes CSS only; new spec variants should extend tone maps, not fork components.
6. **AppShell (259 lines)** — nav, header controls, drawer, state tools all in one
   component. Candidate split (only when the spec changes chrome): `NavRail`,
   `HeaderControls`, `MobileDrawer`, `StateToolsPanel`.
7. **Screens mixing data shaping with render** — e.g. HomePage filters `myRequests`
   directly; MyRequestsPage filters `myRequests` while `list` state also holds data.
   Redesign prep: derive lists from the hook's `data`, not the module import.
8. **Role switching** (`AppContext.role`) is a demo affordance, not permissions. Real auth
   will replace it with server capability data (`permissions.can_decide` already exists in
   serializers). Do not build new role UI on the demo affordance.
9. **No test runner** — a redesign without regression safety net is risky. First
   implementation step (see §5) should add Vitest + @testing-library BEFORE visual churn.

## 5. Proposed implementation sequence (contingent on final design spec)

Ordered so each step is shippable, verifiable, and reversible. Nothing below has started;
steps 1–2 are spec-independent and safe; steps 3+ wait for the final spec.

- **Step 0 — done this pass**: this inventory; no code changes.
- **Step 1 — regression safety net (safe now, no visual change)**: add Vitest +
  @testing-library/react + jsdom; smoke tests per route render; unit tests for
  `useMockList` phases and formatters; keep `npm run build` + `oxlint` green.
- **Step 2 — data-layer seam (safe now, no visual change)**: introduce `src/api/` client
  interface matching mock signatures; screens stop importing `mock/data` directly.
  Demo still passes mocks; real endpoints slot in later.
- **Step 3 — token alignment (needs final spec)**: replace/extend `tokens.css` per the
  approved token sheet from the design reports; verify light+dark, RTL+LTR matrix.
- **Step 4 — global.css restyle (needs spec)**: restyle components against new tokens;
  extract inline styles to classes; visual snapshot verification via headless Chrome.
- **Step 5 — shell/chrome redesign (needs spec)**: nav rail, header, drawer per new
  design; split AppShell if the spec changes structure; re-verify a11y (skip link,
  Escape/focus return, inert drawer).
- **Step 6 — screen-level redesign, smallest blast radius first**:
  LoginPage → NotificationsPage → RequestDetailPage → HomePage → MyRequestsPage →
  MyTimesheetsPage → TeamReviewsPage (last: most complex, ARIA tabs + modal).
- **Step 7 — new screens/routes from final spec**: only what the spec adds (unknown
  until Opus + Sonnet outputs are reconciled); each new route gets the standard state
  machine + a11y treatment from §3.
- **Step 8 — accessibility + responsive regression sweep**: full matrix
  (light/dark × ar/en × desktop/390px mobile × keyboard-only), update README
  screenshots in `docs/screenshots/`.
- **Step 9 — backend integration (needs API readiness decision)**: wire `src/api/` client
  to `/api/v1/` (CSRF bootstrap, session auth via `auth/me`, real mark-read, decisions).
  Out of scope for this card; would become its own task.

## 6. Dependencies outside frontend/ (reference only, untouched)

- `backend/` Django apps expose `/api/v1/`: accounts (auth, employees), notifications,
  reqs, timesheets, review. `backend/config/urls.py` is the router of record.
- `_bmad-output/planning-artifacts/ux/ux-brand-direction.md` — §8 source of current
  tokens, §9 voice/copy. A new consolidated design spec is expected to supersede it.
- Not modified in this pass: backend/, docs/PROJECT_CONTEXT.md, docs/WORK_LOG.md,
  planning artifacts, mock data, all src files. Working tree still clean except
  pre-existing untracked files (`.agents/`, `.claude/`, `.hermes/`, PDF, `skills-lock.json`).
