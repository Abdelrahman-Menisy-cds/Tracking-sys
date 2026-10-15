# GPT-5.5 Premium Frontend Implementation Review

Review target: commit 3dcd0809be3308f7b8c8a9ff95c54881d64e020f
Review scope: frontend source and commit diff, against `docs/design/final-design-specification.md` and `docs/design/premium-design-direction.md`, with the prior review claims in `docs/design/gpt55-independent-implementation-review.md` rechecked.
Mode: independent GPT-only, read-only source review. No production source, tests, configuration, or shared rules were changed.

## Verification evidence

- `git rev-parse HEAD`: `3dcd0809be3308f7b8c8a9ff95c54881d64e020f`.
- `git diff --stat 3dcd080^ 3dcd080`: 14 frontend files changed, 984 insertions and 492 deletions.
- `npm run lint` from `frontend`: PASS, with the existing Fast Refresh warnings in `src/app/AppContext.tsx:266` and `:272`.
- `npm run build` from `frontend`: PASS; TypeScript build and Vite production build completed successfully.
- `git diff --check 3dcd080^ 3dcd080`: PASS; no whitespace errors.
- A local Vite preview/browser smoke was not completed: the safe command runner blocked starting the dev-server command in this headless single-query context. No rendered-browser, axe, screen-reader, focus, contrast, viewport, forced-colors, or 200% zoom evidence is therefore claimed.
- `TEAM_RULES.md` was requested at the repository root but is absent at `/home/menisy/Desktop/Me/tracking_system_project/TEAM_RULES.md`; this review follows the supplied task rules and the two approved design documents.

## Findings

### CRITICAL

#### C1 — Personal request detail directly discloses direct-report records to an employee

Evidence: `frontend/src/screens/RequestDetailPage.tsx:12-15` builds `all = [...myRequests, ...teamRequests]` and resolves any `id` from that combined array. There is no capability or scope check. An employee can navigate directly to `/requests/r-2001` and receive the direct-report request title, requester, details, attachment metadata, status, and timeline, even though `/reviews` itself displays an unavailable surface for that role. The route and record lookup are client-controlled mock data, not a neutral no-access response.

This violates the approved authority and scope rules: direct URLs must enforce the same scope as navigation and must not leak record existence (`final-design-specification.md` §3.3, §15.1); manager review scope must remain separate from personal work; unauthorized data must not be exposed (invariants 1, 2, 6, 16). It also contradicts the premium authority gate G03.

Reproduction: start the frontend at this commit, use the default employee context, request `/requests/r-2001`, and inspect the rendered record. Expected: a neutral unavailable/forbidden surface with no team-record existence or content. Actual source path resolves the team record and renders it.

Recommendation: resolve personal detail only from the authorized personal collection/capability response. Keep review detail under a separately capability-gated route and return the same safe unavailable surface for an employee, including unknown IDs. Add a route matrix test for employee, manager, and HR direct URLs.

#### C2 — The client-side role switch still controls effective authorization and mutations

Evidence: `frontend/src/app/AppShell.tsx:157-190` exposes the role selector in the running application shell. `frontend/src/app/AppContext.tsx:92-119` stores `role` in React state and derives `capabilities.canReview` from it. `TeamReviewsPage.tsx:53-55` and `ReviewRequestDetailPage.tsx:177` use that derived state as their authorization gate. The implementation labels the tools as demo-only, but there is no build-time/demo-build gate; the persistent app shell remains the authority for route visibility and review capability in this build.

The approved design permits reviewer tools only in a separately bounded demo region; it does not permit a client-selected role to be the source of capability authorization (`final-design-specification.md` §§3, 3.4, invariants 1, 2, 21; premium direction §5 and G03). A label is not an authorization boundary.

Reproduction: open the app, change `Switch role (demo)` from Employee to Manager, then open `/reviews`; the client state alone grants the review destination and decision controls. Expected: server-capability resolution controls access, with a neutral loading shell before resolution. Actual: local role state does.

Recommendation: keep the selector only behind an explicit demo/test build boundary and make it select a fixture identity, not capabilities. Route visibility and all returned record/actions must come from a capability-scoped data boundary. Add a capability-loading fixture that proves protected labels/counts/records do not flash.

#### C3 — Role switching does not isolate personal data or in-memory mutations between demo identities

Evidence: `AppContext.tsx:95-99` creates one shared `myRequestItems`, `myTimesheetItems`, and `notificationItems` state for the whole provider. `saveDemoRequest` at `:131-153` writes a newly created request to that shared personal list while deriving its requester from the currently selected role. `submitDemoTimesheet` mutates the same shared personal list. `markNotificationRead` similarly updates one shared notification collection. Switching the role in `AppShell.tsx:175-179` changes the role and navigates home but does not reset or namespace any of these collections.

Consequently, a request created or a notification marked read under one selected identity remains visible after switching to another identity. This violates the requested role-switch isolation claim and the requirement that the demo must not imply cross-user authority. It also makes a manager's personal surface contain mutations authored as a different demo identity.

Reproduction: in the demo, create/save a request as Employee, switch to Manager, open My requests; or mark a notification read as Employee, switch role, and reopen Notifications. Expected: independent fixture state per identity or a clearly reset isolated session. Actual: provider-global state is reused.

Recommendation: namespace all demo records and notification state by fixture identity, or reset every identity-scoped collection on role change. Ensure the selected fixture's personal records, team records, and actor identity cannot bleed into another role.

### HIGH

#### H1 — Review queue does not actually refresh to the pending queue after an acknowledged decision

Evidence: `TeamReviewsPage.tsx:49-50` loads the entire `teamRequestItems`/`teamTimesheetItems` arrays. `AppContext.tsx:174-212` changes a decided record's status and sets `can_decide: false`, but does not remove it from the review query or apply a pending-only filter. `TeamReviewsPage.tsx:74-91` then renders the same record as a no-action row and its table caption still counts the entire array. There is no queue refresh from a pending authorized query.

The spec requires the exact queue to refresh after server confirmation, preserving filters and showing the authoritative result (`final-design-specification.md` §5.7, §§9.3–9.4, invariants 15 and 18; premium G04/G06). A completed decision remaining in the review queue with “No action” is not the required review-table semantics.

Reproduction: use the Manager fixture, open Reviews → Requests, decide `r-2001`, close the dialog. Expected: returned authority is shown and the pending review queue refreshes with the item removed or otherwise filtered out. Actual source retains `r-2001` in the queue and changes only its status/action cell.

Recommendation: model a pending review query separately from the record store; after the mutation resolves, refresh/filter from the returned authorized query and recompute result count/caption. Preserve tab and filters and focus the next row or queue heading.

#### H2 — Timesheet review rows lack a named interval/detail target and organization-timezone semantics

Evidence: `TeamReviewsPage.tsx:65-71` renders the first timesheet column as a bold `sheet.week_start` only, with no named link or interval end. The review queue has no timesheet detail route in `main.tsx:27-31`. The required review columns specify a named week interval, and the weekly contract requires Monday–Sunday interval and organization timezone (`final-design-specification.md` §§5.5–5.6, §9.1; premium P03/P07).

The request tab has a named record link, but the timesheet tab does not provide equivalent record navigation/evidence. A lone ISO start date is not a Monday–Sunday interval and is insufficient for an informed decision.

Recommendation: display localized Monday–Sunday start/end with the returned organization timezone, provide a named timesheet detail/review route where supported, and preserve equivalent labelled mobile content. Do not invent an end date if the backend does not supply enough information; show a safe unavailable state instead.

#### H3 — Review decisions have no stale-version or unknown-outcome path and can update from a stale closure

Evidence: `AppContext.tsx:174-212` waits a fixed `demoDelay`, then maps the current array by ID and increments `request.version`/`sheet.version`; it performs no version comparison, conflict fixture, or unknown timeout result. `DecisionDialog` catches every failure as a generic network error (`TeamReviewsPage.tsx:122-131`) and offers the confirm action again after the error. The `DemoFixture` union only covers ready/loading/empty/error, not conflict or unknown outcome.

The specification requires a stale decision to reload and ask for reconsideration, and an unknown timeout to require reconciliation without replaying the mutation (`final-design-specification.md` §§5.7, 10.5–10.6; premium P08/P11 and G05). The current happy-path mock cannot demonstrate these mandatory states.

Recommendation: add explicit, non-replaying conflict and unknown-outcome fixtures. Return a versioned authoritative record, disable duplicate activation while submitting, and on conflict/unknown show Refresh/reconcile rather than treating the result as generic retryable failure.

#### H4 — The dialog's post-success focus restoration targets a control that has been removed

Evidence: `Dialog` restores `previouslyFocused` in `ui.tsx:106-119`. On a decision success, the invoking table button is replaced by a muted “No action” span because `can_decide` becomes false (`TeamReviewsPage.tsx:63,71`), and the dialog is then closed by its Close button (`:136-141`). The saved focus target is therefore no longer in the document. There is no focus move to the next available record or queue heading.

The approved contract requires meaningful focus restoration after a mutation result, especially when the prior row disappears (`final-design-specification.md §§5.7, 13; premium §7/G06/G09).

Recommendation: after acknowledged completion, close with a callback that focuses the next actionable row, the remaining queue heading, or another stable landmark. Verify both request and timesheet tabs with keyboard-only interaction.

#### H5 — Confirmed review success omits the resulting-stage explanation required for the final acknowledged result

Evidence: `DecisionDialog` includes version and resulting state while editing (`TeamReviewsPage.tsx:146-151`), but the confirmed branch at `:136-141` renders only “decision confirmed”, the subject, and the returned current state. It does not retain/render the resulting stage as an explicit fact, nor does it expose an updated timeline in the dialog/detail after the row mutation.

For an approval that requires HR, the pre-confirmation helper can calculate `stPendingHr`, but the confirmed result does not state the next stage in its success content. The requirement is to show the returned state and, where known, resulting next stage (`final-design-specification.md §5.7; premium G04).

Recommendation: render the server/mock-returned status, next stage, version, and updated provenance in the persistent success region; specifically state “Awaiting HR review” for HR-routed approval.

### MEDIUM

#### M1 — Language and appearance remain persistent top-bar selectors, contrary to the approved account/preferences placement

Evidence: `AppShell.tsx:208-221` renders language and appearance selects in the app header on desktop. No Preferences route or account group exists in `main.tsx`, and the rail contains no account section. The approved contract places these controls in Preferences (with sign-in access allowed), not as persistent work-page selectors (`final-design-specification.md §§3.1, 4.1; premium §5).

Recommendation: move them into a supported Preferences/account surface, or explicitly document the current demo limitation without presenting the top-bar controls as the production shell contract. Persist only non-auth preferences through the approved preference mechanism and test route/query/unsaved-input continuity.

#### M2 — Home still selects the first timesheet as the current week

Evidence: `HomePage.tsx:25` sets `currentWeek = timesheetState.phase === "ready" ? timesheetState.data[0] : null`. The data is not selected by organization current-week semantics or returned timezone. This is the exact preservation risk identified in the prior review and conflicts with the premium weekly-ledger requirement (premium §6 and G05; `final-design-specification.md` §5.1 and invariant 18).

Recommendation: use the server/mock query's explicit current-week identity and organization timezone. When no current sheet exists, render the no-week state and supported creation action rather than an arbitrary first record.

#### M3 — Home exposes review preview for `role !== employee`, not for a resolved capability/query result

Evidence: `HomePage.tsx:39` gates the review preview with `role !== "employee"`, while the queue counts are loaded from the shared team arrays. This is equivalent to the current demo's role-derived capability and remains incorrect for a capability-composed implementation. It also does not state separate authorized scope/count freshness from a single pending query in the data model.

Recommendation: gate preview with resolved capability and a scoped pending query object; share the exact query/count source with Team Reviews and hide the preview while capability state is unresolved.

#### M4 — State fixtures are global and the loading fixture is not a bounded initial/background state

Evidence: `stateDemoControl` in `mock/data.ts:409-412` is a module-global fixture. `useMockList.ts:21-30` leaves the list in loading forever when the fixture is `loading`; changing the fixture dispatches an event and re-runs every mounted list. This can be useful for manual inspection, but it is not a per-route initial/background fixture and can put unrelated surfaces into an indefinite loading state. There is no explicit “updating existing data” state.

Recommendation: scope fixtures to a selected route/query and add a reset/recovery control that is visible and deterministic. Distinguish initial skeleton from background updating and verify no fake counts/records are shown.

#### M5 — Locale and timeline copy are only partially independent/localized

Evidence: `TeamReviewsPage.tsx:57-71`, `RequestDetailPage.tsx:9-20`, `MyTimesheetsPage.tsx:30,36,89-96`, and `NotificationsPage.tsx:15,30,33` contain many inline Arabic/English strings outside the dictionary. `Timeline.tsx` now maps known action/status enums and formats Cairo time, which is an improvement, but actor names are rendered as raw `event.actor` at `:35` and the review/request details do not consistently expose actor permission or an explicit organization-timezone label beside each event.

Recommendation: centralize complete workflow sentences in the bilingual dictionary, use a structured permitted actor/name field, and render explicit timezone context for authoritative event timestamps. Test long Arabic reasons, mixed IDs, and English LTR without reordering.

#### M6 — Mobile drawer focus isolation does not include the backdrop and does not restore focus when the viewport changes while open

Evidence: `AppShell.tsx:44-80` traps Tab only among focusable elements inside `railRef`. The backdrop button at `:194` is outside the rail and is not inert; if it receives focus, the trap does not redirect it. The effect also exits when `isCompact` becomes false without a close/focus restoration path. Browser-rendered verification was unavailable, so this is a source-level concern requiring manual confirmation.

Recommendation: implement the drawer as a single modal surface whose backdrop is non-focusable or explicitly included in a robust modal focus contract; close and restore focus on breakpoint transition. Verify Escape, backdrop click, Tab/Shift+Tab, background inertness, scroll lock restoration, and 320/390px RTL/LTR.

#### M7 — Request and timesheet forms still present unsupported attachment input instead of exercising attachment truth

Evidence: `NewRequestPage` at `MyRequestsPage.tsx:68` renders a disabled file input and a “uploads unavailable” note. `RequestDetailPage.tsx:20` shows only filename/type/size/status and no upload progress, pending/failed/quarantined recovery actions, or policy supplied by a server/mock boundary.

The demo disclaimer is honest, but the acceptance matrix requires applicable attachment states to be exercised and pending/quarantined files never to look ready (`final-design-specification.md §§9.8, 10.9, §15.3; premium P09/G11). This remains incomplete rather than a false success claim.

Recommendation: either provide explicit fixture-backed upload/scan states and permitted actions, or clearly mark the whole attachment workflow unsupported and exclude it from the claimed design-complete acceptance evidence.

### LOW

#### L1 — Breadcrumb accessibility label remains hard-coded in English

Evidence: `PageHeader.tsx` was changed for the new layout, but the prior review's hard-coded `aria-label="Breadcrumb"` issue remains in the changed component. Arabic screen-reader parity requires a localized label.

Recommendation: use a dictionary key for the breadcrumb landmark label.

#### L2 — OperationalTable duplicates desktop and mobile representations in the DOM

Evidence: `frontend/src/components/data/OperationalTable.tsx:4-5` always renders both `.table-wrap` and `.mobile-record-list`; CSS only hides the table at `global.css:182`, and does not explicitly apply `aria-hidden`/inert to the inactive equivalent. `MyTimesheetsPage.tsx:92-93` does the same for the seven-day editor.

Recommendation: use one responsive semantic representation where practical, or prove that the inactive representation is removed from the accessibility tree at each breakpoint. Preserve exactly seven labelled day sections on mobile.

#### L3 — No measured contrast or full acceptance-matrix evidence is included

Evidence: the commit supplies no contrast report, axe results, screen-reader pass, keyboard journey log, forced-colors result, reduced-motion result, increased-text-spacing result, or 320/390/640/1024/200% rendered evidence. `npm run lint` and `npm run build` passing do not establish these contracts.

Recommendation: attach reproducible real-browser evidence for all implemented routes/states, measure derived light/dark pairings and focus/border/disabled/overlay states, and report fixture, viewport, expected result, and actual result.

#### L4 — The commit retains compressed one-line JSX in several high-risk workflows

Evidence: `MyRequestsPage.tsx`, `MyTimesheetsPage.tsx`, `RequestDetailPage.tsx`, `HomePage.tsx`, and portions of `AppShell.tsx`/`TeamReviewsPage.tsx` contain dense single-line render paths. This did not fail lint/build, but it makes keyboard/state/access-control review and future regression diagnosis materially harder.

Recommendation: format high-risk route and mutation code into readable blocks; keep behavior unchanged and add focused tests rather than treating lint/build as workflow evidence.

## Corrections that are now supported by source

- Demo transitions for new requests, timesheet submission, and review decisions are explicitly labelled non-persistent in user-facing copy and are held in React state rather than written to a backend.
- Review decision choices are not preselected; Reject and Return require a non-empty comment in the dialog.
- Review request rows now use an operational semantic table with named request links, employee, localized status pills, submitted date, next-stage text, and action columns.
- Status pills and the shared Timeline use SVG icons and known bilingual action/status maps; raw enum values are no longer the primary status-pill text in those updated surfaces.
- The notification badge now derives from shared `notificationItems` and responds to the local mark-read update.
- The mobile drawer adds a Tab trap, Escape handling, main-content inertness, and body-overflow restoration for its ordinary compact-open path.
- `npm run lint`, `npm run build`, and `git diff --check` pass as reported above.

These improvements do not resolve the critical direct-URL disclosure, client-role authorization, or cross-role data isolation findings, nor the high-severity queue, conflict, focus, and review-evidence gaps.

## Verdict

CHANGES REQUIRED

The production build is mechanically green, and several prior claims were corrected in source. Approval is blocked by direct-URL personal-scope leakage (C1), client-side role-derived authorization (C2), and cross-role mutation/data bleed (C3). The review queue also does not refresh to authoritative pending semantics after decisions, and the mandatory conflict/unknown-outcome and rendered accessibility/responsive evidence is absent. No merge approval should be granted until the critical findings are corrected and the required real-browser matrix is executed with reproducible evidence.
