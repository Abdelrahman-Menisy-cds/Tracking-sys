# Independent GPT-5.5 UX critique

Repository reviewed: `/home/menisy/Desktop/Me/tracking_system_project`

Review scope: `frontend/README.md`, `frontend/package.json`, all current files under `frontend/src`, the product/UX/PRD/epic planning artifacts under `_bmad-output/planning-artifacts/`, and both repository design skills (`.agents/skills/frontend-design/SKILL.md` and `.agents/skills/bmad-agent-ux-designer/SKILL.md`). The repository has no literal `product/UX/PRD` directory; the corresponding PRD, UX direction, product policy, brief, and epics were reviewed at their actual paths. This is an independent critique. It does not rely on another agent report.

This document is critique only. No application, backend, planning, or Git files were changed.

## Executive verdict

The prototype is competent as a stateful visual demo, but it currently looks like a generic internal SaaS starter adapted to Arabic rather than an employee-operations product with a distinct point of view. The strongest evidence is structural: the home page is a collection of count/status cards, the review queue is a vertical list of near-identical cards, most details are boxed into repeated rounded panels, and the shell exposes demo controls and role switching as product chrome. The interface says “dashboard template” before it says “what needs my attention, who acts next, and what I can safely do.”

The prototype also under-represents the approved product contract. It has employee requests, personal timesheets, a manager/HR review demo, details, notifications, and bilingual/theme scaffolding, but not the planned HR administration, request-type administration, reports, profile/preferences, or the complete server-truthful lifecycle. Some apparent gaps are acceptable demo limitations; they should not be mistaken for implementation defects until the real API and capability model exist. The UX risk is that the demo's visual grammar may become the product's information architecture by accident.

Priority order:

1. Reframe the shell and home around work queues, next actor, current state, and explicit next actions.
2. Make list density and scanning appropriate to operational work: tables for comparison, compact rows for queues, cards only for genuinely self-contained summaries or mobile reflow.
3. Remove demo-only controls from any product-like presentation and keep role/capability boundaries visible without a role simulator.
4. Design the complete state model, especially returned work, cancellation, terminal timesheet rejection/replacement, HR reopen, missing reviewers, conflicts, upload quarantine, and unknown mutation outcomes.
5. Test Arabic/English, RTL/LTR, mobile, 200% zoom, keyboard, forced colors, and long real-world content before treating the visual system as finished.

## What is currently working

The implementation has several good foundations worth preserving:

- Arabic-first locale handling with an English parity path, document direction changes, logical CSS properties, and `<bdi>` around mixed-script content.
- A capability-shaped navigation demo: team review is not shown for the employee role in the shell.
- A real requests table rather than cards on the personal requests page.
- A weekly timesheet table with explicit duration and unpaid-break minutes, readable totals, and a persistent read-only explanation.
- Status labels paired with icons rather than color alone.
- Explicit draft/submit actions, validation, unsaved-change warning, decision confirmation, required reject/return reason, loading/error/empty/success demo states, skip link, visible focus, reduced-motion handling, mobile drawer Escape behavior, and dialog focus trapping.
- A visual identity direction tied to paperwork becoming orderly, rather than an unrelated abstract technology motif.
- Honest README disclosure that this is mock data with no backend integration.

These are foundations, not proof that the current interaction model satisfies the approved product contract. Several of them are implemented only as demo behavior; the real system must preserve server authority and truthful outcomes.

## 1. Current employee requests UI: what is wrong and why

### 1.1 The request list is the best pattern, but still too shallow

`MyRequestsPage` uses a table with title, type, status, last update, and a details link. That is directionally right for operational records. It still omits information the UX direction and product contract say is central: the responsible reviewer/next actor where permitted, submission date, and a useful indication of why a returned request needs attention. A user can see “Returned for correction,” but the list does not help them understand the correction task before opening each record.

The status filter is a single select above the table. It is serviceable for a demo but weak for a real work queue:

- There is no search, sort, pagination, result count tied to the displayed query, or visible applied-filter state.
- The filter is not reflected in a shareable or restorable query state; returning from details cannot reliably preserve the user's context.
- There is no distinction between first use, zero records, and zero records after filtering beyond copy in the empty component.
- The table's final “Details” column duplicates the linked title. A named title link is sufficient unless there is another row action.
- Long Arabic titles, bilingual request-type names, IDs, and status text need deliberate wrapping and column priority rather than relying on a generic overflow wrapper.

Alternative pattern: use a compact, sortable operational table on desktop with columns ordered by decision value: request title/type, status plus next actor, submitted/updated date, and one named action. Put search and permitted filters in a toolbar, show the active scope and result count, and retain those filters on return. On mobile, reflow each row into a labeled record block rather than merely allowing a wide table to scroll. Tradeoff: a table is denser and better for comparison, but requires explicit responsive semantics and more careful column prioritization.

### 1.2 The new-request form is a generic form, not a policy-aware submission path

The editor currently contains type, title, details, a disabled file input, and three actions. The approved product says request type controls routing; returned work carries a correction reason; attachments have file-type, count, size, asynchronous scan, quarantine, and replaceability rules; success must be server-confirmed and must name the next stage without claiming final approval.

The current form's strongest weakness is the disabled attachment control. It visually advertises a capability that cannot be used, while the helper copy gives fixed limits even though the demo has no upload. In a production flow, this should become an attachment area with per-file progress, pending/clean/failed states, retry/remove affordances, and a clear explanation that a pending or failed file cannot be submitted. In a demo, either show a clearly labeled unavailable capability or omit the control; a disabled fake affordance creates an expectation the product cannot satisfy.

The form also has no returned-request mode. The correction reason should be above the editable fields, visually associated with the current revision, while history remains append-only. It should be impossible to mistake “returned” for a fresh draft or a rejection. The form needs a concise submission review step or summary where the authoritative type/routing outcome is known; do not make users infer the reviewer from a generic hint.

Alternative pattern: a staged but non-wizard form. Keep one page and one reading order, but introduce a clear “Request type and review path” context block, the editable fields, an attachment list, and a final action region that states what submit will do. This is more transparent than a multi-step wizard and less overwhelming than a long undifferentiated form. Tradeoff: more visible explanation consumes vertical space; it prevents routing surprises and reduces correction loops.

### 1.3 Request detail is visually boxed and operationally incomplete

`RequestDetailPage` puts details, attachments, and history in three repeated cards. The sections are understandable, but the hierarchy is flat: the current state, next actor, next allowed action, and audit history have similar visual weight. A reviewer or employee should be able to answer these in seconds:

- What is the current state?
- Who acts next, if known and permitted?
- What can I do now?
- What changed most recently?

A detail page should use a strong record header with title, status, submitted metadata, next actor/step, and permitted action region. Details and attachments can be grouped as content sections; history should be a timeline or event table with explicit current-state emphasis, actor, timestamp, transition, and comment. Repeated rounded containers are not enough to express hierarchy.

The current history renders raw status enum values in places (`from_status`, `to_status`) and raw action values. That violates the product/UX requirement for localized, plain status and action language. It also makes the audit trail look like a developer payload. Each event needs localized action/state labels while preserving IDs and filenames with LTR isolation.

The detail page also lacks a request cancellation affordance for eligible drafts/submitted requests, although the approved policy allows cancellation before decision. The action should not be invented for every state: capability and state must decide whether it appears. If real integration does not yet expose this, show no action rather than an always-disabled mystery control.

## 2. Why the interface feels generic or AI-generated

This is not mainly a color problem. It is a repeated default decision pattern:

- Identical rounded cards are used for counts, notifications, queue records, details, skeletons, and empty states. The same surface treatment no longer communicates what kind of information is inside.
- `HomePage` begins with a generic “welcome + role” heading, then three metric cards, then recent notifications, then pending requests. The arrangement resembles a dashboard template and does not reflect urgency, sequence, or the employee's next task.
- The review queue uses cards for records that need comparison and triage. Each card repeats title, metadata, status, and a decision button; this is a list disguised as a set of panels.
- The shell contains controls that are appropriate for a visual demo—“Switch role (demo)” and “View-state tools”—inside the primary navigation. This makes the product look like a design review harness, not a finished employee workspace.
- The recurring arrow suffix in links (`→`) and mixed icon/emoji affordances (`+`, `✓`, `✕`, `🗂️`, `☰`) are not consistently tied to direction, action, or a coherent icon system. In RTL, a literal arrow is especially easy to misread as decoration or fail to mirror correctly.
- The brand direction asks for restrained situational comedy, but the current UI mostly uses generic SaaS surfaces and occasional emoji. That is neither a distinctive brand moment nor disciplined institutional UI.
- Inline styling in screens produces a page-by-page assembly feel instead of an intentional layout system.
- “Light/dark/system” is exposed as a select in the header, giving a settings implementation prominence equal to work. Language and appearance belong in preferences/account controls unless there is a strong product reason to keep them always visible.
- The design skills explicitly warn against the SaaS-card kit, repeated rounded surfaces, generic labels, and decorative motion. The current implementation exhibits several of those traits even though its token palette is restrained.

Concrete alternative: define a small number of structural patterns rather than one universal card:

1. Page frame: title, scope, primary action, and short explanatory subtitle.
2. Work queue: table/compact list with row separators, status, next actor, and action.
3. Summary strip: a few counts only when they answer a decision question; each count links to the exact filtered list.
4. Record header: state, ownership, dates, and allowed action.
5. Evidence panel: details, attachments, and history, each with a meaningful heading and distinct density.
6. Mobile record block: labels and values, not a shrunken desktop card.

Tradeoff: fewer surface variants reduce visual novelty but increase information hierarchy and product specificity. Distinctiveness should come from the clipboard/paper identity, Arabic-aware typography, clear queue language, and disciplined hierarchy—not from adding gradients, shadows, or decorative illustrations everywhere.

## 3. Dashboard usefulness

The current home has useful ingredients but weak prioritization. For an employee it shows pending request count, current timesheet status, notifications, and pending requests. For manager/HR it adds a combined team queue count. Problems:

- `pendingTeam` is the combined length of `teamRequests` and `teamTimesheets`, not necessarily pending items. A dashboard count that says “team review queue” must use the same authorized pending query as the queue rows; otherwise it can be misleading.
- The current timesheet is selected as `myTimesheets[0]`, not derived from an authoritative current week. A real dashboard should show the organization-week context and freshness, not whichever mock object happens to be first.
- A single number does not identify urgency, oldest waiting work, returned corrections, missing reviewer, or the next action.
- Recent notifications are shown as three repeated cards without clear unread/read treatment or a strong relationship to actionable work.
- Errors are rendered independently but the layout does not preserve a clear “updating” state for already-visible content. A failed widget should not silently look like a zero or make the page appear complete.
- Manager and HR are treated almost identically in the home despite the approved distinction between direct-report review, organization visibility, and separately gated HR actions.
- There are no reports, employees, request types, or organization summaries in the current shell even though the approved epics and UX direction include them. This is acceptable for a bounded visual demo only if the boundary remains explicit.

Better dashboard pattern: a “needs attention” first section followed by personal status and recent activity. For employee:

- Returned requests/timesheets first, with correction reason and direct action.
- Submitted work awaiting a named reviewer/step.
- Current week timesheet state and an action to open or continue it.
- New request action.
- Recent notifications as a compact activity list.

For manager:

- Personal work separate from “direct reports requiring review.”
- Queue summary by requests/timesheets and status, with oldest/latest context where the API supplies it.
- A direct link into the same filtered queue, not a separate dashboard-only interpretation.

For HR:

- Organization summary only for capabilities actually granted.
- Separate operational review, employee administration, request types, and reports entry points.
- No implied ability to decide or edit merely because a count is visible.

Tradeoff: an attention-first home is less visually impressive than a grid of metrics, but it reduces time-to-next-action and avoids decorative analytics that the product explicitly excludes. Validate by asking each role to find their next action without opening more than one page.

## 4. IA and navigation

The current navigation has Home, My requests, My timesheets, Team reviews when the demo role allows it, and Notifications. That is a reasonable prototype subset, but it is not yet the approved information architecture.

Issues:

- “Home” is a generic label and destination. It should be a role-scoped work overview, not an undifferentiated dashboard.
- “Team reviews” combines request and timesheet review behind tabs. That can work for a small queue, but the navigation and page title should clarify scope and pending work. It must not become a substitute for HR organization views.
- HR administration, employees, request types, reports, profile, and preferences are absent. Do not add them as empty nav links just to match a spec; introduce each only with real capability and state behavior.
- The role switcher is a demo mechanism, not product IA. In the real application the server supplies capabilities; changing a view must never change authority.
- Language and appearance selects compete with work in the header. The approved direction places account/preferences in an account menu and keeps notifications as both a page and header entry.
- The shell lacks a clear current section/title relationship and nested breadcrumb treatment is implemented as a small back link on detail screens. A back link is useful, but nested details should also communicate parent context and preserve list filters/focus.
- No visible scope summary exists for manager or HR pages beyond a demo sentence. Scope, date range, and applied filters must be explicit near list content.

Alternative IA for the MVP, without inventing new business modules:

- Home / My work
- My requests
- My timesheets
- Review queue (only when review capability exists)
- Organization work (HR visibility capability only; split requests/timesheets if the data model demands it)
- Employees (HR employee-management capability)
- Request types (HR configuration capability)
- Reports (manager/HR report capability)
- Notifications
- Account: profile, preferences, sign out

This is a capability map, not a claim that every role sees every item. The tradeoff is more navigation structure than the demo needs, but it prevents HR functions from being hidden inside a generic “Team reviews” page and makes permission boundaries legible.

## 5. Cards versus tables

Use cards for:

- A small, role-specific summary whose contents are not being compared with neighboring records.
- A single record header or evidence group.
- A mobile reflow of a desktop row, provided every field has a visible label.
- Empty/error/first-use guidance when the message and recovery action form one unit.

Use tables or compact list rows for:

- My requests, where users compare title/type/status/date and scan many records.
- Manager review queues, where the reviewer compares requester, type, date, status, and action.
- HR employee directory, request types, reports, organization requests, and organization timesheets.
- Timesheet daily entries on desktop, where the date is a row header and numeric values align.
- Audit/history when chronological comparison and actor/time scanning matter.

The current personal requests table and timesheet editor demonstrate that the codebase can support tables. The review queue is the clearest place to stop using cards. A dense table with a sticky or repeated header, one primary named record link, status/next-actor fields, and an action column will make decisions faster. On mobile, switch to record sections with labels; do not force a six-column table into a 320px viewport.

Tradeoffs:

- Tables improve scanability and batch comparison but require responsive reflow, column prioritization, and accessible headers.
- Cards are easier to style and reflow but create vertical bloat, hide comparison, and invite duplicate button placement.
- A hybrid compact list can be appropriate where records have only three or four fields; it should still use consistent columns/labels, not become a collection of ornamental cards.

Validation check: give a manager ten mixed requests and timesheets and measure whether they can identify the oldest pending item, the current requester, and the correct decision action without opening every record.

## 6. Workflows by role, without adding requirements

### Employee

The approved employee journey is: sign in, create/edit a draft, attach permitted files, submit, track status/reviewer/history, correct returned work, and resubmit. The current prototype covers the skeleton of this path but not the authoritative attachment flow, returned-reason prominence, cancellation-before-decision, server-confirmed outcomes, session expiry, conflict handling, or unknown submit outcomes.

The employee home should answer “what do I need to do?” rather than merely “how many things exist?” The request detail should make next actor and next action explicit. The timesheet should show the authoritative organization timezone, Monday–Sunday interval, duration and unpaid break semantics, correction reason when returned, read-only state after submission, and replacement/reopen implications only where the approved policy exposes them.

### Manager

The approved manager journey is: open an active direct-report queue, inspect request/timesheet evidence and history, approve/reject/return according to the record's legal state, provide required reasons, and see the updated authoritative state. The current demo provides an approval modal but does not persist the decision, update the queue, expose conflicts, or distinguish the final HR step from manager approval in a durable way.

The queue should keep the manager's scope and filters visible, preserve context after a decision, and make stale/concurrent decisions safe. A decision dialog should summarize the record, current state, selected outcome, and required comment; it should not be the only place to discover what the action does. The post-decision message must use the returned state, not a generic “approved” success.

### HR

The approved product distinguishes HR organization-wide visibility from separate capabilities for employee administration, reporting lines, request types, reviews, and reports. The current role demo treats HR mostly as manager-plus. That is a dangerous shortcut if carried forward: HR is not a superuser and visibility is not action authority.

The HR experience should show scope and capability boundaries directly: read-only organization records should not look editable; employee/reporting-line changes need authoritative confirmation and audit; request-type changes should explain their approved impact without implying retroactive workflow changes; reports should state scope, date interval, timezone, applied filters, and export limits. These are not optional decoration; they are how the product communicates least privilege.

## 7. States and edge cases the current UI under-models

The README lists loading, empty, error, validation, disabled/read-only, and success. The approved artifacts require more specific states. The following are the highest-risk gaps:

### Requests

- Draft, submitted, pending manager, pending HR, approved, rejected, returned, cancelled must have localized labels and action availability.
- Returned requests need a prominent correction reason and editable permitted fields; submitted/decided attachments become immutable except approved returned replacement behavior.
- Cancellation is available only for draft/submitted before decision and needs explicit confirmation plus history.
- No manager blocks submission except approved HR-only types; inactive/missing reviewer is flagged to HR, not silently rerouted.
- A manager cannot self-approve; a requester is excluded from their own queue.
- A stale detail or decision must produce a conflict/reload path, not a false success.
- A network timeout after submit/decision must say the outcome could not be confirmed and require refresh/reconciliation before retry. The current simulated timeout model does not exercise this.
- Attachment upload needs unsupported type, size/count/total quota, pending scan, failed scan, retry, quarantine, and private-download states.

### Timesheets

- No sheet yet, draft, submitted, returned, approved, rejected, replacement workflow, and HR reopen need distinct copy and actions.
- Monday–Sunday organization-timezone context must be visible; browser timezone must not silently define the week.
- Negative, invalid, duplicate week, out-of-week, daily >24h, weekly >168h, and any future interval-mode validation need field/entry-specific errors.
- Rejected records are terminal/read-only and lead to a new replacement workflow; they are not simply another editable card.
- HR reopen of approved/rejected records requires capability, reason, confirmation, and append-only audit.
- A “save” that only changes local React state is not a truthful saved state. The demo copy currently says demo, but the interaction pattern must not be copied unchanged into production.

### Lists and shell

- Distinguish loading from an existing list refreshing; do not replace visible content with a generic skeleton unnecessarily.
- Distinguish first-use empty, filter-empty, no pending work, no access, and unavailable record.
- Preserve filters, focus, selected record, and unsaved edits during locale/theme changes and return navigation.
- Hide inaccessible actions rather than exposing disabled controls with no explanation; for permitted but temporarily unavailable actions, explain why.
- Keep unread state server-confirmed; local mark-read should be replaced by authoritative mutation behavior.
- If permissions load later, do not briefly show a broader nav or count.

## 8. RTL, LTR, mobile, 200% zoom, and accessibility

### RTL/LTR

The use of logical properties and `<bdi>` is a good start, but the UI still contains literal directional arrows and mixed concatenated metadata. `← My requests`, `A · B · C`, raw IDs, timestamps, and status transitions need content-aware direction and localized sentence construction. Directional arrows should be semantic icons that mirror only when the meaning is directional; a history transition arrow and a navigation back arrow do not necessarily share the same visual behavior.

Arabic needs real content tests: long request titles, names with Latin fragments, Arabic-Indic and Latin numbers, filenames, emails, IDs, English request-type names inside Arabic text, and long correction reasons. Do not rely on `text-wrap: balance` or flex wrapping as a localization strategy. Check that status pills and buttons expand without clipping, that the rail opens from logical inline-start, and that DOM order remains task order rather than being visually reversed.

### Mobile

The 390px screenshot claim in the README is useful evidence that a path was considered, not evidence of complete mobile usability. The current mobile drawer is a reasonable foundation, but the overall design still assumes desktop cards/tables and desktop header controls. At mobile widths:

- Put the page title, scope, and one primary action in a stable order.
- Make filters a named disclosure or bottom sheet with applied-filter summary; do not let a long select stack push the work queue out of reach.
- Convert table rows to labeled record sections for requests and review; retain scan order and status/action proximity.
- Make timesheet day sections explicit and keep total/save/submit actions visible in normal reading order.
- Make decision dialogs scrollable with the record identity, current state, reason field, and final action all reachable without losing context.
- Ensure the virtual keyboard does not obscure the focused reason or submit action.
- Remove demo state tools and role switching from a product-like mobile shell.

### 200% zoom and text reflow

The CSS uses fixed rail widths, a 1280px max content width, inline widths for numeric controls, and a table overflow wrapper. These may be acceptable at ordinary desktop sizes but need direct testing at 200% zoom and at 320px CSS width. “No critical horizontal scrolling” does not mean a table can simply overflow: only genuinely two-dimensional data regions should scroll, with an accessible label and keyboard access. Forms, dialogs, filters, banners, long statuses, and header controls should reflow without clipping or forcing the user to scroll sideways.

Check at 200% zoom:

- shell/header controls do not overlap or create a hidden primary action;
- Arabic labels and error messages are not clipped by fixed heights;
- dialog heading, close control, reason field, and confirm action remain reachable;
- focused elements are not covered by sticky or fixed UI;
- table headers and row labels remain understandable when the table scrolls;
- no essential information is communicated only by color, icon, or position.

### Accessibility

The prototype includes meaningful positive work, but a11y should be assessed behaviorally rather than by the presence of ARIA attributes. Specific concerns to verify:

- `NavLink` is given `aria-current="page"` unconditionally in JSX; the routing library may manage the active state, but this should be verified so inactive links do not announce themselves as current.
- The dialog uses `aria-label` rather than a heading relationship; verify that screen readers announce the visible title and that focus lands on a meaningful control, not merely a heading.
- The mobile drawer has Escape and inert handling, but focus trapping and focus return should be tested with keyboard and a screen reader, including locale changes and route changes.
- Skeleton rows should not create repeated noisy live announcements. A single busy region with stable labels is preferable.
- Status icons and pills need contrast checks in every theme; “text plus icon” does not guarantee adequate contrast or comprehension.
- Tables need captions, correct row/column headers, and a clear mobile alternative. Numeric inputs need localized labels that include the day without relying on an ISO string being understandable.
- Error summaries should link to every invalid field, preserve values, and announce only the necessary update.
- Forced-colors mode, increased text spacing, reduced motion, keyboard-only operation, and screen-reader output in Arabic and English are not covered by the code alone.

## 9. Concrete alternative product pattern

A coherent redesign can remain restrained and still be distinctive:

### Shell

Use a capability-scoped rail at logical inline-start, with the current area and unread notifications. Move language, appearance, profile, and sign-out into an account/preferences menu. Keep one small brand mark and the live product name; remove demo role/state controls from the primary shell. On mobile, use a named drawer with focus trap and a compact header containing menu, current section, and notifications.

### Home

Replace the generic card grid with:

1. Page title and one-sentence scope/freshness context.
2. “Needs your attention” compact queue: returned work first, then pending employee action, then review work for reviewers.
3. A small personal status strip for current requests/timesheet, with exact links to filtered records.
4. Recent activity as a compact list with unread/read state and record link.

Use a summary count only when it is a truthful projection of the same query as the destination list. No invented productivity metrics, deadlines, or zeros while loading.

### Requests

Desktop table; mobile labeled rows. Toolbar with search, permitted filters, sort, result count, and active-filter chips. Returned records carry a visible reason. Detail header shows status, next actor, current action, and last update before details/attachments/history.

### Timesheets

Desktop day table with a strong week header, organization timezone, total recorded duration, state, and correction reason. Mobile day sections. Keep input mode duration-per-day and make read-only state explicit. Put save/submit actions in a stable action region, with server-confirmed feedback.

### Review

A two-tab or segmented queue can remain if request and timesheet review share real scope and decision mechanics. Prefer a table/compact list over cards. Keep employee, type/week, current state, submitted date, and allowed action in one row. Open a named decision dialog with current state and reason requirements. After success, update the row from returned server state and preserve queue filters/focus.

### Visual language

Use teal as the competent operational anchor and the violet paper accent sparingly in brand moments. Let borders and spacing create hierarchy. Use the composed-clipboard idea in the mark and selected empty/first-use moments only; do not put mascot/emoji in rejection, approval, or dense report contexts. Keep typography Arabic-aware and avoid a single universal card radius as the answer to every boundary.

## 10. Risks and tradeoffs

- More dense tables improve operational speed but can feel less welcoming to employees. Use cards only for personal summaries and mobile reflow, not as the universal desktop list.
- A more informative home requires trustworthy server-derived counts, scope, freshness, and status. Building the visual treatment before the data contract risks another layer of false certainty.
- Capability-scoped IA is safer than role-based assumptions but can make navigation vary between users. Explain scope and unavailable access neutrally; do not expose a role switcher as compensation.
- Showing next actor improves accountability but may disclose reviewer identity or routing details that a user is not authorized to see. The server must provide a permitted label or a neutral policy message.
- Strong returned/review attention can improve correction completion but can also feel punitive. Use plain professional copy and no alarm animation; distinguish returned from rejected.
- A mobile card reflow is accessible only if labels and reading order are designed intentionally. Simply stacking desktop cells produces repetition and hidden context.
- Removing decorative cards and emoji may make the demo appear less “designed.” That is an acceptable trade: hierarchy, copy, and a specific paper-work identity should carry the product personality.
- The approved policy includes terminal timesheet rejection/replacement and HR reopen; the current UX direction contains older provisional language. UI implementation should follow the approved product policy and state machine after reconciliation, not silently choose whichever screen is easiest.

## 11. Validation checks before implementation is considered UX-ready

### Product and workflow checks

- For employee, manager, and HR, write the shortest path to the next action and verify the home page supports it without invented metrics.
- Verify every visible status has: localized label, current-state meaning, next actor where permitted, and allowed next action.
- Verify request routing examples: manager-only, manager-then-HR, HR-only, no manager, inactive reviewer, HR substitution, self-approval, returned correction, cancellation, and stale decision.
- Verify timesheet examples: empty week, draft, submitted read-only, returned correction, approved, rejected replacement, HR reopen, duplicate week, invalid duration, week boundary, and timezone display.
- Verify attachment examples: valid, unsupported, too large, quota exceeded, pending scan, failed scan, returned replacement, immutable submitted file, and unauthorized download.
- Verify filters, counts, dashboards, and exports all use the same scope and applied query; no dashboard number may be a different computation from its destination list.

### Visual and content checks

- Review desktop, 390px mobile, 320px reflow, and 200% zoom in Arabic RTL and English LTR.
- Use long Arabic titles, long English names, mixed-script names, filenames, UUID-like IDs, long reasons, and empty/error messages.
- Remove demo role/state controls from the product-facing shell and verify no raw enum or developer-oriented copy remains.
- Measure contrast for normal text, muted text, borders, focus rings, status pairs, buttons, dialogs, and both themes; do not treat candidate tokens as already certified.
- Check that brand and any humor stay out of serious decisions, rejection/error states, and dense operational tables.
- Confirm the visual system uses distinct patterns for summary, queue, detail, evidence, empty, and error rather than one card treatment everywhere.

### Interaction and accessibility checks

- Complete request submission, returned correction, timesheet submission/correction, manager decision, notification mark-read, and preference changes keyboard-only.
- Verify focus on route changes, filter changes, error summaries, dialog open/close, drawer open/close, row removal, and locale/theme changes.
- Test screen readers in Arabic and English; verify labels, table headers, status announcements, dialog title, busy regions, and error associations.
- Test reduced motion and forced-colors mode.
- Simulate network failure and timeout after every mutation. The UI must never claim success until authoritative confirmation and must not blindly replay a mutation.
- Test stale/concurrent decision and permission revocation while viewing a detail. The UI should safely reload or show unavailable/conflict without leaking record existence.

## Final assessment

The prototype has a usable accessibility and state-handling skeleton, but its current composition is still a generic card-based dashboard with a demo harness embedded in the product surface. The highest-value change is not a new color palette. It is to make the interface operationally legible: attention first, next actor, current state, allowed action, scope, and recoverable history. Use tables and compact rows for work queues, reserve cards for summaries and mobile reflow, and let the bilingual paper-work identity provide the distinctive character. Then validate every state and role at real content lengths, RTL/LTR, mobile, keyboard, and 200% zoom before treating the redesign as complete.
