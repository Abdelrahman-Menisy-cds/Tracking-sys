Independent Implementation Review — commit cbce87de62c51c449fcf969d759456cd1785a9f1
Against: docs/design/final-design-specification.md
Scope: frontend implementation review, read-only source inspection plus build/lint/browser-adjacent verification

Verdict: CHANGES REQUIRED.

Summary

The commit delivers a substantial visual redesign: the 248px rail token, operational work surfaces, six primitive color tokens with derived washes, Arabic-first defaults, route-preserving status filtering, semantic desktop tables with mobile record blocks, localized status pills, timeline styling, and responsive drawer CSS are present. Existing routes and mock-data demo behavior are mostly preserved, and the production build succeeds.

The implementation is not design-complete. The most important failures are authoritative-state violations in the review workflow, a broken loading-state control, incomplete mobile drawer/dialog focus isolation, missing HR/organization capability surfaces, and a large amount of hard-coded/raw workflow copy in a page that is required to preserve English/Arabic meaning parity.

Verification performed

- git show/diff inspection of the named commit and all changed frontend files.
- npm run lint: PASS with two existing Fast Refresh warnings in frontend/src/app/AppContext.tsx:96 and :103.
- npm run build: PASS; tsc -b and Vite production build completed successfully.
- git diff --check: no whitespace errors reported.
- Dev server responded HTTP 200 and served the Arabic RTL shell. Automated real-browser inspection was unavailable because the configured browser could not open the existing Chrome profile login databases; therefore no claim of successful rendered browser journeys is made.
- No frontend automated tests or browser evidence are included in this commit.

Findings

CRITICAL

C1. Review decisions report success without changing or re-reading authoritative state.
Evidence: frontend/src/screens/TeamReviewsPage.tsx:206-212 sets done(true) only; :218-228 renders decisionSent and the selected decision. No mutation is made to mock/server state, no returned state is rendered, no queue refresh occurs, and no duplicate-submission guard exists. The specification requires success only after server acknowledgement, the returned resulting state, queue refresh, preserved filters/focus, and no replay after unknown outcomes (spec §5.7, §10.6, invariants 14-15, acceptance §15.2).
Remediation: model an async decision mutation with an explicit submitting/confirmed/unknown/conflict state; update through the authoritative mock boundary (or explicitly show an unavailable integration state); render the server-returned status/timeline, refresh the queue, disable activation while submitting, and never claim decisionSent merely from local state.

C2. The demo exposes client-side role switching as the effective capability/authorization model.
Evidence: frontend/src/app/AppShell.tsx:9,22,26 renders a role selector in the persistent top bar and passes setRole directly; frontend/src/app/AppContext.tsx:43-47 stores role locally and :74-88 derives behavior from it. frontend/src/screens/TeamReviewsPage.tsx:40-52 gates the route by that client-selected role. Although labelled demo, the production shell has the control and the direct route still resolves/render-gates from client state, rather than a neutral capability-resolution shell. This conflicts with spec §3.0/§3.4, invariants 1-2 and 21, and acceptance §15.1.
Remediation: isolate reviewer role/state tools behind a clearly bounded demo-build-only region (preferably sign-in/demo fixture only), introduce a capability-loading/authorized capability model, and make route checks consume server capabilities. Do not let a client role selector be the source of route visibility.

HIGH

H1. Loading-state demo control is broken and can never display a persistent loading state.
Evidence: frontend/src/app/useMockList.ts:19-23 checks stateDemoControl.loadingNext but intentionally does nothing; :24 immediately runs load(), while mockFetch() at frontend/src/mock/data.ts:427 clears loadingNext and resolves. The AppShell exposes no loading control (frontend/src/app/AppShell.tsx:25 only offers failNext and emptyNext). The spec requires truthful initial/background loading and capability-loading behavior (§10.1, §15.4), while the existing mock-state preservation contract advertises loadingNext.
Remediation: implement loadingNext as a one-shot state fixture that resolves only on an explicit retry/reset, or remove the dead control and add a working test fixture. Preserve existing content for background refresh and do not show fake data/counts.

H2. Review queue is not the required operational table and lacks required decision-value columns.
Evidence: frontend/src/screens/TeamReviewsPage.tsx:115-140 and :151-175 render unordered lists of work-surface blocks. Request rows omit explicit next stage and use a generic decision button; timesheet rows omit submitted date and use no named record link/detail action. The required request/timesheet table columns are specified in §5.6 and semantic table/mobile equivalence in §9.1/acceptance §15.3.
Remediation: use the existing OperationalTable/mobile-record pattern for both tabs, add employee, localized current state, submitted date where supplied, next stage where known, and one permitted action; retain deterministic order and scope/count/freshness metadata.

H3. Mobile drawer does not implement the required modal focus/inert behavior.
Evidence: frontend/src/app/AppShell.tsx:14 handles Escape and body overflow only; :25 sets inert on the rail when closed, but the open drawer does not trap focus, make the background inert, or return focus on backdrop close. The backdrop is a generic button at :26 and clicking it closes without restoring focus. CSS at frontend/src/styles/global.css:163 places the rail as a fixed panel, but CSS cannot supply focus management. This fails spec §4.3, §9.7, §13 and invariant 22.
Remediation: add a real drawer dialog contract: focus the first meaningful item on open, trap Tab, set background inert/aria-hidden while open, close on Escape before mutation, lock scroll without clobbering prior overflow, and restore focus to the trigger for both Escape and backdrop close. Use logical inline-start positioning rather than hard-coded translateX assumptions.

H4. The review dialog is not fully authoritative and its confirmation copy exposes raw enum status.
Evidence: frontend/src/screens/TeamReviewsPage.tsx:232-238 renders currentStatus directly; for review records this is PENDING_MANAGER/SUBMITTED/etc., violating localized status/no raw enum requirements (§5.7, §9.4, §10.7, invariant 9). It also does not include version context, resulting next stage, or required reason in the confirmation content as required by §5.7. The source currently has no authoritative mutation at :206-212.
Remediation: map every state through the i18n dictionary, include record/employee/current localized state/version/decision/resulting stage/reason in the confirmation, and render the server response after mutation.

H5. HR and organization capability-composed destinations are absent.
Evidence: frontend/src/app/AppShell.tsx:17-20 defines only My work, Review work, and Updates; frontend/src/main.tsx defines only home, requests, timesheets, reviews, notifications, and login routes. There are no independently gated organization requests/timesheets, Employees, Request types, or Reports destinations. The specification explicitly requires independent capability representation when implemented (§3.3, §5.8, acceptance §15.1). If these are outside the current mock scope, the implementation must show a safe capability-gated successor or clearly preserve the inventory contract rather than silently omitting supported routes.
Remediation: reconcile the implementation inventory and current supported routes. Add only server-capability-backed routes; otherwise document and test safe unavailable direct-URL surfaces without empty unauthorized links or record-existence leakage.

H6. Form and timesheet success behavior is simulated locally and contradicts server-authoritative/read-only requirements.
Evidence: frontend/src/screens/MyRequestsPage.tsx:44 schedules local success text and navigation; :51-52 claims the request becomes read-only after a timer but does not create/update a returned request. frontend/src/screens/MyTimesheetsPage.tsx:28 returns local entries and :29 uses setSavedMessage(t("weekSubmitted")) without changing status/read-only state or a server acknowledgement. This violates spec §5.3, §5.5, §10.8 and invariants 13-15.
Remediation: keep demo behavior explicitly fixture-backed: submit through a mock mutation that returns a new authoritative record/state, then render that state and disable editing. Handle conflict, timeout, validation, and unknown outcome without clearing values or replaying mutations.

H7. Dialog backdrop mutation/discard behavior violates the decision-dialog contract.
Evidence: frontend/src/components/ui.tsx:47 closes on any mousedown on the overlay. Once a reject/return comment has been entered, backdrop click silently discards it; the spec only permits backdrop close before mutation and requires warning when entered decision text would be discarded (§9.7). The dialog also uses one fixed id dialog-title for any future multiple-dialog rendering.
Remediation: prevent backdrop close after decision text exists (or ask for confirmation), and generate stable per-instance heading/description ids.

MEDIUM

M1. AppShell does not implement the required navigation grouping/order or account surface.
Evidence: frontend/src/app/AppShell.tsx:17-20 has My work, Review work, Updates only. Account (Profile, Preferences, Sign out) is not a group; language/appearance remain persistent top-bar selectors at :26, contrary to §3.1 and §4.1. HR/organization groups are absent as noted in H5.
Remediation: move language/appearance into Preferences, provide the account entry/group only when supported, and keep sign-out/account controls at the rail bottom. Add capability-derived grouping only for actual supported capabilities.

M2. Filter and URL preservation is only partially implemented.
Evidence: frontend/src/screens/MyRequestsPage.tsx:20-23 stores only status in useSearchParams. It has no supported search/type/sort/page, no result freshness/count from the same query, and detail links do not preserve the current query/scroll/focus context. Spec §5.2 and §9.3 require the endpoint-supported subset plus URL ownership of meaningful filters/tab/sort/pagination and practical back restoration.
Remediation: preserve all supported controls in URL state, render count/scope/freshness from the query result, and pass/restore the originating query and named-record focus when opening/backing from detail.

M3. Locale/theme preferences are volatile and workflow state is not proven across changes.
Evidence: frontend/src/app/AppContext.tsx:44-47 initializes locale/appearance/role on every mount and :58-63 changes document state only. No preference persistence is implemented, and no unsaved-input/route/query preservation mechanism exists for locale/theme changes. This is contrary to spec §11 and invariant 13. The good part is that the route is not intentionally navigated by locale/theme selectors.
Remediation: persist only non-auth appearance/locale preferences as appropriate, keep route/search params and active record stable, and verify unsaved form values remain intact when changing locale/theme.

M4. RTL logical-property compliance is incomplete in the drawer implementation.
Evidence: frontend/src/styles/global.css:163 uses transform: translateX(-105%) and the RTL override translateX(105%) rather than a logical inset/displacement strategy. This is brittle for direction changes and contradicts the requirement to use CSS logical properties for drawer behavior (§11). The app otherwise uses many logical properties correctly.
Remediation: use an inline-axis transform strategy tied to a logical custom property or separate direction-aware state with documented behavior; test 320/390px in both directions.

M5. The Timeline component leaks raw actor/status/action data and does not implement all required event fields.
Evidence: frontend/src/components/record/Timeline.tsx:5-6 falls back to event.action for unknown actions and renders actor as a raw string. It omits localized from/to state descriptions and timezone context beyond browser locale formatting. The legacy review detail remains raw at frontend/src/screens/TeamReviewsPage.tsx:340-347 (ev.action and ev.to_status). This violates §9.5 and invariant 9.
Remediation: provide complete action/status maps, suppress or safely localize unknown server enums, render localized from/to states, actor where permitted, timestamp with explicit organization timezone, reason/comment, and IDs as secondary metadata.

M6. Attachments do not expose the required scan/upload truth and the editor falsely presents a permanently disabled file input.
Evidence: frontend/src/screens/MyRequestsPage.tsx:50 renders `<input type="file" disabled>` and says uploads are unavailable; detail at frontend/src/screens/RequestDetailPage.tsx:20 renders filename/type/size/status but has no progress, retry/remove/replace/download actions or clear policy supplied by server. This falls short of §9.8, §10.9 and acceptance §15.3. A demo limitation is acceptable only if the fixture clearly exercises the required states, which it does not.
Remediation: use server-provided policy and render uploading/pending/clean/failed/quarantined fixtures with permitted actions and blocking explanations; if out of scope, label the entire attachment workflow as unavailable rather than presenting a misleading editor control.

M7. The main page uses summary metrics without linking them to a same-query authorized result and home counts are derived directly from imported arrays.
Evidence: frontend/src/screens/HomePage.tsx:16-18 computes attention and review counts directly from mock arrays, while loading/error states are separately driven by useMockList calls. During loading, attentionRequests is already computed and the review counts are not tied to the query state. This violates §5.1's no-fake-zero/no-independent-count rule and invariant 18.
Remediation: derive visible rows, counts, and previews from the same resolved query object; render no count until that query resolves and label review scope/freshness from that response.

M8. Mobile timesheet rendering duplicates the desktop table in the DOM instead of replacing it semantically.
Evidence: frontend/src/screens/MyTimesheetsPage.tsx:28 renders both `.table-wrap` and `.mobile-record-list`; CSS hides the desktop table at max-width 639. The mobile fields lack `name`, `inputMode`, and the same explicit `aria-label` quality as the desktop inputs. This can create duplicate accessibility surfaces and does not robustly satisfy the seven labelled day-section contract (§4.3, §5.5, §9.1).
Remediation: use one responsive semantic representation or ensure the inactive representation is `display:none`/aria-hidden in a way verified by assistive technology; give mobile controls stable names and labels, and test exactly seven Monday–Sunday sections.

M9. The implementation uses emoji-like/platform glyphs as action icons in the review workflow.
Evidence: frontend/src/screens/TeamReviewsPage.tsx:243-250 includes ✓, ↩, and ✕ in button text. The specification prohibits emoji/platform-dependent glyphs as product icons and requires one coherent SVG set (§2.3, invariant 25). The status icons were also changed to Unicode symbols in frontend/src/components/ui.tsx:9-15, though they are aria-hidden and paired with text.
Remediation: use the approved coherent SVG icon set with aria-hidden decorative treatment; keep button labels as localized text and do not rely on glyph appearance.

M10. The six-token discipline is not fully met by the runtime CSS.
Evidence: frontend/src/styles/tokens.css:42-54 creates semantic aliases, which is reasonable, but `color-mix()` derived colors are used without measured contrast evidence; the review contains no contrast report, and `--text-muted`/washes/borders/disabled states are not demonstrated AA in all light/dark combinations. The spec explicitly says base primitive pairs do not certify derived states (§7, §15.6).
Remediation: add measured contrast verification for every actual foreground/background combination, including focus, disabled, borders, overlays, status washes, dark native controls, and forced-colors behavior.

M11. The desktop shell does not provide the optional detail/review context-column structure and review detail remains largely legacy styling.
Evidence: frontend/src/screens/TeamReviewsPage.tsx:317-358 returns a fragment with inline styles and raw timeline, unlike RequestDetailPage's new `.page`/`PageHeader`/`Timeline` structure. The specification allows a context column but requires detail/review pages to prioritize status/next-action before evidence/history (§4.1, §5.7). The queue's inline block style is also not consistently operational-table grammar.
Remediation: bring review detail through the same canonical detail template and shared components; expose status, next stage, evidence, append-only timeline, and authorized decision region in one coherent reading order.

LOW

L1. Significant changed files were compressed into mostly single-line JSX/function bodies.
Evidence: frontend/src/app/AppShell.tsx:10-26, frontend/src/screens/MyRequestsPage.tsx:20-55, frontend/src/screens/MyTimesheetsPage.tsx:13-29, frontend/src/components/ui.tsx:25-47. Build/lint pass, but this harms reviewability and raises regression risk. It also conflicts with the repository's prior readable formatting and clean-code review expectations.
Remediation: run the project formatter or reformat into readable multi-line components, keeping behavior unchanged.

L2. New components are unused or thin aliases rather than implemented contracts.
Evidence: frontend/src/components/layout/AppTopBar.tsx:1 re-exports AppShell; frontend/src/components/data/MobileRecordBlock.tsx:2 and state aliases are not used by the changed screens; `StatusActionBlock` is exported but screens use literal divs. This adds dead surface without improving consistency.
Remediation: either use the shared components in the canonical templates or remove the unused additions.

L3. Breadcrumb aria label is hard-coded in English.
Evidence: frontend/src/components/layout/PageHeader.tsx:2 uses `aria-label="Breadcrumb"`, while the application supports Arabic-first operation. This is a minor screen-reader parity issue.
Remediation: pass a localized breadcrumb label through PageHeader or add a dictionary key.

L4. The notification count is computed from the immutable module seed, not the locally marked-read list.
Evidence: frontend/src/app/AppShell.tsx:16 computes unreadCount from `notifications`; frontend/src/screens/NotificationsPage.tsx:11 updates only local page state. After marking an item read, the rail badge remains stale until remount. This is a generic UI regression in the preserved mock behavior.
Remediation: move notification read state to shared app/mock state or derive badge from the same source used by NotificationsPage and update it after mark-read.

L5. Demo sign-in accepts any non-empty credentials and silently transitions to the selected role.
Evidence: frontend/src/screens/LoginPage.tsx:11 only checks identifier/password presence then calls setRole and navigates after a timeout. This is acceptable only for a clearly bounded demo, but it must not be confused with supported authentication/CSRF behavior, which the spec explicitly preserves (§14 invariant 23).
Remediation: keep it behind demo-only build/test fixtures and document that no authentication integration is present; do not reuse this path for production authentication.

Test/browser evidence gaps

- No test files were changed or added in the commit.
- No automated route matrix, state matrix, axe/WCAG run, contrast measurement, keyboard journey, screen-reader pass, forced-colors check, 200% zoom check, or 320/390/640/1024 screenshot evidence was supplied.
- Browser verification was attempted but blocked by the configured browser profile's unavailable Chrome login databases. The dev server itself returned HTTP 200; that is not a substitute for real-browser evidence.

Preserved behavior assessment

- Routes present before and after the commit are unchanged in frontend/src/main.tsx: /login, /, /requests, /requests/new, /requests/:id, /timesheets, /timesheets/:id, /reviews, /reviews/requests/:id, and /notifications.
- Mock loading/error/empty infrastructure remains, but loadingNext is nonfunctional (H1).
- Existing mock notification mark-read remains local to NotificationsPage, but the navigation unread badge does not update (L4).
- Locale defaults to Arabic and document lang/dir are updated by AppContext; English/Arabic copy parity is incomplete in hard-coded workflow strings (H4/M5/M11).
- Theme switching and color-scheme are present; preference persistence and derived-color measurements are not.
- The production build and lint are green, but these mechanical checks do not cover the authoritative workflow and accessibility requirements.

Final classification

CHANGES REQUIRED.
