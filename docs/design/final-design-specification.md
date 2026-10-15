# هي فوضى؟ — Final Design Specification

Status: approved design authority and implementation source of truth  
Scope: Arabic-first employee requests and time-tracking web application  
Decision: Alternative A, **The operational desk**

## 1. Authority and product philosophy

This document is the final design contract. It supersedes design alternatives and unresolved visual recommendations in the prior design reports. The implementation inventory remains authoritative only for facts about the current demo and its preservation constraints. Where the current visual demo differs from this document, this document governs the redesign; backend authorization, validation, state transitions, and returned server data remain authoritative for product behavior.

The product philosophy is **the next clear action**.

Every work surface must let a person identify, without inference:

1. what needs attention;
2. the record’s authoritative status;
3. who acts next, when that information is permitted;
4. what the current user can do now;
5. what becomes read-only after the action.

The product is an operational desk, not an analytics dashboard. Attention comes before activity; accountable workflow comes before decorative metrics. Personal work and review work are separate capabilities even when one person has both. A record is presented as one chain of state, evidence, action, and append-only history.

The visual system is calm and work-focused:

- use typography, spacing, rules, and alignment to create hierarchy;
- reserve color for action, state, focus, and the brand gesture;
- use tables or compact rows for comparison and queues;
- reserve cards for a coherent object, a small summary, or mobile row reflow;
- do not use shadows, gradients, floating panels, KPI galleries, emoji, or repeated rounded cards as the primary visual grammar;
- never infer productivity, urgency, a deadline, or authority from recorded time or request status.

## 2. Arabic-first brand direction

### 2.1 Identity

The Arabic product name is primary: **هي فوضى؟**. The approved English rendering is **Heya Fawda?**. Use live text for the name; do not bake the wordmark into an image. Use `translate="no"` on the brand name so browser translation does not alter it.

The brand idea is paperwork moving from disorder to accountable order. The composed-clipboard mark is the one memorable gesture: an orderly clipboard or paper stack with one restrained violet slip. Use it in the shell lockup, sign-in, and selected first-use empty states. Do not repeat it in tables, decision dialogs, approvals, rejections, validation, permissions, errors, reports, or audit history.

Arabic is the default locale and initial direction. Arabic copy is written first, then English is authored for meaning parity rather than mechanically translated. The descriptor is:

- Arabic: `شؤون الموظفين`
- English: `Employee Operations`

The production tagline, when a welcome or sign-in context has room for it, is:

- Arabic: `من الفوضى إلى النظام`
- English: `From chaos to clarity`

Do not place the tagline in dense operational pages.

### 2.2 Voice

Use professional, plain, active language. Buttons describe the result: `حفظ المسودة`, `إرسال الطلب`, `إرسال الأسبوع للمراجعة`, `تأكيد القرار`, `إعادة المحاولة`. The same action keeps the same name in the initiating control, confirmation, progress state, and server-confirmed result.

Restrained Egyptian character may appear only in welcome and first-use brand moments. It must not appear in rejection, return-for-correction, permission, conflict, timeout, attachment quarantine, destructive confirmation, or validation copy. Errors state what happened and the recovery action; they do not apologize or use vague language.

### 2.3 Icon direction

Use one coherent SVG icon set with consistent stroke, optical size, and accessible treatment. Decorative icons are `aria-hidden="true"`. Icon-only controls require an accessible name and a minimum 44 × 44 CSS-pixel target. Do not use emoji or platform-dependent glyphs as product icons.

Mirror only icons whose meaning is directional, such as back, next, drawer direction, or breadcrumb progression. Do not mirror the logo, checkmark, clock, paperclip, calendar, download, status symbol, numeric axis, or timeline chronology.

## 3. Capability-based information architecture

Navigation is derived from authenticated server capabilities, never from a client-side role switch. While capabilities are unresolved, render a neutral shell/loading state and do not flash protected routes, names, counts, exports, or actions.

### 3.1 Shared destinations

Visible to authenticated users when their base self-service capabilities are granted:

1. `الرئيسية / Home` — role- and capability-scoped work overview.
2. `طلباتي / My requests` — the user’s requests.
3. `سجلات وقتي / My timesheets` — the user’s weekly time records.
4. `الإشعارات / Notifications` — in-app notifications and related-record navigation.

Account menu:

- `الملف الشخصي / Profile`, when supported;
- `التفضيلات / Preferences`, containing language and appearance;
- `تسجيل الخروج / Sign out`.

Language options are `العربية` and `English`, never flags. Appearance options remain `System`, `Light`, and `Dark`; the saved preference is distinct from the resolved theme.

### 3.2 Review capability

Show `مراجعات الفريق / Team reviews` only to a user with review capability. The destination contains two explicit tabs:

- `الطلبات / Requests`;
- `سجلات الوقت / Timesheets`.

For a manager, the visible scope is active direct reports only. The requester must not appear in their own review queue, and the interface must not imply hierarchy expansion, organization-wide access, bulk approval, or self-approval.

### 3.3 Organization visibility and HR capabilities

Show each destination independently and only when its corresponding capability exists:

- `طلبات المؤسسة / Organization requests` — organization request visibility;
- `سجلات وقت المؤسسة / Organization timesheets` — organization timesheet visibility;
- `الموظفون / Employees` — employee administration;
- `أنواع الطلبات / Request types` — request-type administration;
- `التقارير / Reports` — team or organization reporting according to the returned scope;
- `مراجعات الفريق / Team reviews` — only if HR also has review capability.

HR is not a superuser. Visibility does not imply decision, edit, export, reopen, substitution, employee-management, or request-type-management authority. A direct URL without capability returns a safe unavailable/forbidden surface without leaking whether a record exists.

### 3.4 Navigation grouping and order

The rail groups capabilities in this order:

1. **My work:** Home, My requests, My timesheets.
2. **Review work:** Team reviews, only if granted.
3. **Organization:** Organization requests, Organization timesheets, Employees, Request types, Reports, each independently gated.
4. **Updates:** Notifications.
5. **Account:** Profile, Preferences, Sign out.

Do not add empty navigation links for unimplemented or unauthorized destinations. Demo-only role and state controls belong in a separately labelled reviewer-tools panel available only in demo builds; they are not production navigation or top-bar controls.

## 4. Application shell and page templates

### 4.1 Desktop shell: 1024 CSS px and wider

- Place a 248px navigation rail at logical inline-start.
- Put the brand lockup at the rail top, navigation groups below it, and account access at the bottom.
- Use a compact content top bar for current section, notifications, and account entry. Language and appearance live in Preferences, not as persistent selectors.
- Constrain the content region to 1280px maximum and center it within the available area.
- Use one main reading column up to 760px and an optional context column up to 320px on detail/review pages. Simple lists and operational tables may use the full content width.
- A page header contains one `h1`, one scope/date/freshness line when needed, and at most one primary action.
- Place an attention strip immediately after the header only for returned work, actionable review work, a blocking condition, a stale result, or background updating.

### 4.2 Tablet shell: 640–1023 CSS px

- Collapse the rail into a named drawer controlled from the top bar.
- Use one column by default. Retain two columns only when each remains at least 300px wide and reading order is unchanged.
- Filters wrap within a toolbar or open in a named panel; they never clip or force page-level horizontal scrolling.

### 4.3 Mobile shell: 320–639 CSS px

- Use one column and a compact top bar with menu, current section, and notifications.
- Open navigation as a modal drawer from logical inline-start. Trap focus, support Escape before any mutation, lock background scrolling, mark the background inert, and return focus to the trigger.
- Order content as page title, scope/status, attention or correction reason, primary action, content, then recovery/secondary actions.
- Make the principal page action full width where that improves clarity; all targets remain at least 44 × 44 CSS px.
- Convert operational tables into labelled record blocks. Convert weekly time rows into seven labelled day sections. Do not require horizontal spreadsheet interaction to complete a task.

### 4.4 Canonical page templates

Home:

`H1 and scope/freshness → attention strip → primary actions → my work queue → current week → recent notifications → optional scoped review preview`

List:

`breadcrumb when nested → H1 and scope → primary action → filter/search/sort controls → applied filters and result count → table or labelled mobile rows → pagination`

Editor:

`breadcrumb → H1 and state → correction/blocking reason → policy context → form sections → attachments → save/submit actions → persistent server-confirmed state`

Detail/review:

`breadcrumb/back link → record identity and status → next actor/action panel → content/evidence → attachments or weekly entries → append-only timeline → authorized decision region`

Report:

`H1 and scope/timezone → filters → Apply filters → stale/updating indicator → totals and table → bounded export action`

Sign-in:

`brand lockup → H1 → authentication fields → primary sign-in action → language and appearance access`. Demo role selection and demo-data notice may exist only in a clearly bounded demo region.

## 5. Page structures and supported workflows

### 5.1 Employee home

The employee home is a work overview, not a metric dashboard.

1. Show returned requests or timesheets first, each with the correction reason and direct action.
2. Show other work that needs employee action.
3. Show submitted work with authoritative status and next review stage when the server permits disclosure.
4. Show the current Monday–Sunday timesheet and its state, using organization timezone context.
5. Offer `طلب جديد / New request` and `فتح سجل الوقت / Open timesheet`.
6. Show recent notifications as a compact activity list.

A count may appear only when it is computed from the same authorized query as its linked destination. Never render zero while loading and never label all records as pending merely because they are present.

### 5.2 My requests list

Desktop uses a real table. Required columns, in decision-value order:

1. named request title link and request type;
2. status;
3. next actor or neutral next-stage label, when permitted;
4. submitted date or `Draft` where applicable;
5. last update;
6. one permitted action, only when distinct from the title link.

Returned rows include a concise correction reason without requiring the detail page. The list supports the endpoint-backed subset of search, status, type, sort, and pagination. It displays scope, result count, applied filters, and query freshness. URL query parameters preserve filters, sort, tab, and page; returning from detail restores query state, scroll/focus context where practical, and the named record link.

Mobile reflows each row into a labelled record block containing the same critical information. It is not an unlabeled stack of table-cell values.

### 5.3 New, draft, and returned request editor

Use a single-page, non-wizard form with one reading order:

1. request type;
2. server-provided review-path explanation;
3. title;
4. approved type-defined fields, if supplied;
5. details;
6. attachments;
7. action summary;
8. Save draft and Submit request.

The employee never chooses an approver. If a manager is missing or inactive, show the server-provided blocking or HR escalation explanation; never invent or silently reroute a reviewer. Before submission, show a concise confirmation summary naming the request, current state, and resulting review stage. Do not imply final approval.

Returned mode places the reviewer’s correction reason above editable fields and retains all prior history. Only fields permitted by policy are editable. Eligible cancellation for a draft or submitted request before decision is explicit, confirmed, and recorded in history; do not expose cancellation in ineligible states.

Validation uses a summary before the form linked to invalid fields plus inline messages. Preserve every valid value after client validation, server validation, a network error, timeout, conflict, or locale/theme change. Warn before abandoning unsaved edits through route navigation, browser navigation, or sign-out.

### 5.4 Request detail

The record header contains:

- request title and type;
- localized status;
- requester where scope permits;
- submitted and last-updated times;
- next actor/next stage where permitted;
- current permitted action;
- secondary isolated record ID.

Below the header, present request details, attachments, and an append-only timeline as one continuous record. The status/next-actor/action block has higher emphasis than evidence; audit history is quieter but complete. Raw enum values never appear in primary copy.

### 5.5 My timesheets list and weekly editor

The list identifies each Monday–Sunday week, authoritative organization timezone, status, total recorded duration, last update where supplied, and permitted action. Totals are always hours and minutes, never decimal hours and never a productivity score.

The weekly editor contains exactly seven Monday–Sunday day rows/sections. Supported entry fields are:

- work date;
- duration in minutes;
- unpaid break in minutes;
- optional description.

Desktop aligns the days in a table with dates as row headers. Mobile uses one labelled day section per date. The week header always shows the localized interval and organization timezone. Show recorded-time and unpaid-break totals separately.

Client feedback may explain invalid, negative, out-of-week, over-daily-limit, over-weekly-limit, or duplicate-week values, but final validity is server-authoritative. Submission confirmation states that the sheet becomes read-only. Submitted and approved records are read-only. Returned records show the correction reason and allow correction/resubmission. Rejected records are terminal and read-only; when supported, the interface points to a distinct replacement record rather than editing the rejected record. HR reopen is never shown as an employee action.

### 5.6 Manager home and review queue

The manager’s own requests and timesheets remain in **My work**. Direct-report review is a separate **Review work** area.

The manager home may show a direct-report attention preview only from the same authorized pending query as Team reviews. It must state `active direct reports only`, include separate request and timesheet counts when useful, and link to the exact filtered queue.

The Team reviews page contains Requests and Timesheets tabs. The header shows scope, applied filters, result count, and last refresh/updating state. Queue order is deterministic and exposed to the user. Do not provide bulk decisions.

Request review table columns:

1. named request link and type;
2. employee;
3. localized current state;
4. submitted date;
5. next stage after the manager decision, where known;
6. available review action.

Timesheet review table columns:

1. named week interval;
2. employee;
3. localized current state;
4. total recorded duration;
5. submitted date where supplied;
6. available review action.

### 5.7 Review detail and decision workflow

The review detail page places decision context next to the current state. Show the full evidence and history before or alongside the decision region; do not require a reviewer to make a decision from a summary card alone.

Approve, Reject, and Return for correction are separate choices. No choice is preselected. Reject and Return require a visible reason. The confirmation dialog names:

- the record and employee;
- the current authoritative state and version context;
- the selected decision;
- the resulting next stage where known;
- the required reason/comment.

During submission, prevent duplicate activation and announce progress. After success, render the state returned by the server, refresh the queue from authority, preserve filters, and restore meaningful focus. Manager approval must display `Awaiting HR review` rather than `Approved` when HR approval remains.

A version/stale conflict reloads the latest state and asks the reviewer to reconsider; it never replays the decision automatically. An unknown timeout instructs the reviewer to refresh the record before another attempt.

### 5.8 HR work

HR home is capability-composed, not “manager plus everything.” It separates:

- HR’s personal work;
- review work, only if granted;
- organization visibility;
- employee administration;
- request-type administration;
- reports.

Organization requests and timesheets use the list/detail structures above with organization scope. Read-only access must look read-only: omit decision/edit controls rather than implying authority.

Employee administration separates identity, reporting line, account/role state, and read-only profile facts. Request-type administration displays the approved routing policy and explains server-provided in-flight impact before saving; it is not a workflow builder.

Manager substitution and timesheet reopen are exceptional actions. Show them only with their explicit capabilities, reason requirement, confirmation, resulting state, and audit consequence. Never expose them as casual table-row shortcuts.

Reports state scope, date interval, organization timezone, units, applied filters, result count, and generation freshness beside the result. Filters apply only after `تطبيق الفلاتر / Apply filters`. CSV export is bounded to 10,000 rows. Success copy may confirm that download generation or initiation started; it must not claim that a file was saved to the user’s device.

## 6. Typography

Use self-hosted fonts after license review; use `font-display: swap` and preload only the critical weights.

- Arabic: `Noto Sans Arabic`, fallback `Segoe UI`, `Tahoma`, `sans-serif`.
- Latin: `Inter`, fallback `Segoe UI`, `system-ui`, `sans-serif`.

Type scale:

| Role | Size | Weight | Line height |
|---|---:|---:|---:|
| Page `h1` | 32px desktop; 28px mobile | 700 | 1.35 Arabic; 1.25 Latin |
| Section `h2` | 22px | 700 | 1.4 Arabic; 1.3 Latin |
| Record title / `h3` | 18px | 700 | 1.5 Arabic; 1.4 Latin |
| Body and controls | 16px | 400 or 600 | 1.65 Arabic; 1.5 Latin |
| Metadata/helper | 14px | 400 or 600 | 1.55 Arabic; 1.5 Latin |
| Operational total | 30px maximum | 700 | 1.25 |

Use the operational-total size only for a meaningful count or duration paired with a label and destination. Keep explanatory lines below 80 characters where layout permits. Use tabular numerals for dates, durations, and number columns. Do not use all caps, tracked Arabic, decorative italics, monospace metadata, routine eyebrow labels, or decorative `01 / 02 / 03` markers.

Do not shrink text to solve Arabic wrapping. Let labels, buttons, pills, rows, and headings grow vertically. Use `text-wrap: balance` only for short headings and `overflow-wrap: anywhere` or equivalent for user content and long identifiers.

## 7. Six-token color system

These are the only six primitive color tokens. Each token has a light and dark value; all borders, muted text, hover fills, disabled fills, overlays, and status washes are derived with `color-mix()` from these primitives. Do not introduce an unreviewed seventh primitive.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-ink` | `#172033` | `#F8FAFC` | Primary text and strongest neutral structure |
| `--color-canvas` | `#F5F7F9` | `#0F172A` | Page background |
| `--color-surface` | `#FFFFFF` | `#1E293B` | Working regions, fields, dialogs, tables |
| `--color-action` | `#0F766E` | `#5EEAD4` | Primary actions, links, approved/success state |
| `--color-signal` | `#6D28D9` | `#C4B5FD` | Brand slip, focus ring, pending/unread/returned signal |
| `--color-critical` | `#B91C1C` | `#FCA5A5` | Rejection, destructive action, blocking error/quarantine |

Primary button treatment:

- light: action background with surface text;
- dark: action background with canvas text.

Critical button treatment follows the same foreground rule using `--color-critical`. Secondary controls use surface, ink, and a derived ink border. Focus uses a 3px `--color-signal` outer ring with at least 2px separation from the component edge; forced-colors mode uses the system focus color.

Status mapping:

- Draft and Cancelled: neutral derived from ink/canvas; labels and icons differ.
- Awaiting manager, Awaiting HR, Submitted: signal outline/wash plus localized text and icon.
- Approved: action outline/wash plus localized text and icon.
- Returned: signal with a stronger logical-start rule and correction text; it must remain visually and verbally distinct from pending.
- Rejected: critical outline/wash plus localized text and icon.
- Attachment pending scan: signal.
- Attachment clean: action.
- Attachment failed/quarantined: critical.

No meaning depends on hue. Every status has text; correction, rejection, and quarantine also include a reason or next step. Measure every actual foreground/background pairing after derivation. The primitive pairs selected here already provide strong base contrast, but that does not certify derived washes, borders, disabled states, or component combinations.

## 8. Spacing, density, and shape

Use a 4px base spacing scale:

`4, 8, 12, 16, 24, 32, 48, 64px`.

Rules:

- page inline padding: 32px desktop, 24px tablet, 16px mobile;
- major page-region gap: 32–48px;
- section gap: 24–32px;
- related control/content gap: 8–16px;
- default table cell padding: 12px block and 16px inline;
- compact queue row: 12–16px block padding and 16px inline padding;
- form field gap: 20–24px;
- one form field per row in the reading column; two columns only for semantically paired fields that remain readable at 200% zoom;
- controls: minimum 44px height and 44 × 44px target;
- working-surface radius: 8px;
- dialog radius: 12px;
- status-pill radius: fully rounded;
- tables and continuous evidence regions use dividers rather than separate cards.

Use three elevation levels without shadow dependence:

1. canvas;
2. surface with border for one coherent working region;
3. quiet inset derived from canvas for metadata or read-only context.

A clear hierarchy must remain if every shadow and animation is removed.

## 9. Component contracts

### 9.1 Tables and mobile rows

Use semantic `<table>` markup with a descriptive caption, visible headers, `scope="col"`, row headers where appropriate, deterministic sort controls, and a named record link in the primary cell. Sort controls expose direction in text/semantics. Do not duplicate a generic Details link when the title already provides the only navigation action.

At the responsive content breakpoint, replace comparison tables with equivalent labelled record blocks. Preserve every critical label, status, next actor, and action. A genuinely two-dimensional table may retain horizontal scrolling only inside a named, focusable region with preserved headers; page-level horizontal scrolling is prohibited.

For more than 50 rendered rows, use server pagination and/or measured list virtualization without breaking table semantics, focus, or browser find expectations.

### 9.2 Cards and working regions

A card is allowed for one coherent object or mobile row. It may contain:

- a named identity link and type/week;
- status and next actor;
- one supporting metadata line;
- one permitted primary action;
- a correction/blocking reason.

Do not wrap each paragraph, metric, notification, timeline event, or form section in the same card treatment. Empty/error guidance may use a single bounded region when message and recovery form one unit.

### 9.3 Filters, tabs, and query state

A list toolbar starts with supported search, then supported status/type/employee/date filters, sort, and actions. Reports always use an explicit Apply filters action. Show applied filters as removable labelled chips and provide Clear all. Show authorized scope, result count, and date interval from the same query as the rows.

On mobile, filters open in a named modal or disclosure panel; the closed control summarizes the number or names of active filters. URL query parameters own filter, sort, tab, pagination, and expandable-panel state where deep linking is meaningful. Locale and theme changes preserve route and query state.

Review tabs use the WAI-ARIA tabs pattern, including arrow-key movement that respects reading direction. Do not style tabs as primary mutation buttons.

### 9.4 Status and next-action block

Status is not a pill alone. On every list/detail/review record, present the compact logic:

`localized status → record identity → next actor/stage → permitted action`

The next actor is server-derived and disclosed only when permitted. If unknown, missing, inactive, or blocked, use the server’s neutral policy explanation. The interface never invents a person or calls manager approval final while HR review remains.

### 9.5 Timeline

Render audit history as an append-only vertical timeline in chronological order, with a visible spine and one event marker per event. Each event contains:

- localized action;
- actor where permitted;
- localized timestamp with timezone context;
- localized from/to state description;
- comment or reason when present;
- secondary isolated event/request identifiers where useful.

The current event is anchored visually; older events remain readable with lower emphasis. Never make raw action/status enums the primary line. Timeline numbers are allowed only if they genuinely communicate event order.

### 9.6 Forms and action regions

Every control has a visible label, meaningful `name`, appropriate `type` and `inputmode`, autocomplete policy, and stable help/error association. Email, username, code, ID, and filename inputs disable spellcheck where appropriate. Never block paste.

Required state is communicated in text and semantics, not only an asterisk. Placeholders are optional examples ending in `…`, never substitutes for labels. Inputs preserve content during errors. Compound controls use `:focus-within` where needed.

Keep consequential action regions in normal reading order. A sticky action bar is permitted only if it does not cover focused elements, validation, or content at 320px, with a virtual keyboard, or at 200% zoom.

### 9.7 Dialogs

A dialog uses `aria-labelledby` connected to its visible heading, `aria-describedby` where useful, and `aria-modal="true"`. On open, focus the first meaningful control or heading according to task context. Trap focus, make background content inert, lock and contain scrolling, support Escape before submission, and restore focus to the invoking control.

Decision dialogs are scrollable within the viewport and keep record identity, current state, reason, and final action reachable on mobile. Clicking the backdrop may close only before a mutation begins and never when it would silently discard entered decision text without warning.

### 9.8 Attachments

The attachment area displays policy supplied by the server rather than hard-coded universal limits. Each file row shows:

- isolated filename;
- type and formatted size;
- upload progress;
- scan state: uploading, pending, clean, failed/quarantined;
- named retry, remove, replace, or download action when permitted;
- clear blocking explanation.

Pending, failed, or quarantined files never look ready for approval. Submitted attachments are immutable except for explicitly permitted replacement during a returned correction workflow. Private attachment access follows record scope; a forbidden or unavailable download does not disclose storage details.

## 10. Truthful system states

Every page and component must implement the applicable states below.

### 10.1 Loading and refreshing

- Initial loading skeleton matches the eventual structure and does not display fake counts or records.
- One polite live-region message announces loading; skeleton cells are hidden from assistive technology.
- During background refresh, preserve existing content, mark it `Updating`, and prevent stale content from appearing newly authoritative.
- Capability loading never flashes protected content.
- Loading motion stops under reduced motion.

### 10.2 Empty

Distinguish:

- first use;
- no matching filters;
- no pending review work;
- no record for the selected week;
- no access/unavailable record.

First use offers the supported creation action. Filter-empty offers Clear filters. An empty review queue says no work is currently pending; it never implies every record is approved. No-access uses neutral safe wording and no creation CTA.

### 10.3 Error and expired session

Separate network/server failure, expired session, forbidden/not found, validation failure, conflict, and attachment failure. Errors name a recovery action. Retry read operations; do not blindly replay mutations. Preserve safe input and show a request/reference ID only when returned by the server. Expired sessions return to sign-in without claiming unsaved work was submitted.

### 10.4 Validation

Place a localized error summary before the form and focus it after failed submission. Each summary link moves focus to its invalid field. Keep inline field errors associated through `aria-describedby`; set `aria-invalid`. Preserve valid fields and do not interrupt Arabic input-method composition.

### 10.5 Conflict and duplicate week

A stale version or concurrent decision states that the record changed, renders the latest authoritative state, and offers Refresh record. Never automatically repeat Submit, Approve, Reject, Return, Cancel, Reopen, or substitution.

If the week already exists, link to the existing sheet. Do not create a duplicate or clear entered values until the user intentionally leaves or reconciles them.

### 10.6 Unknown mutation outcome

If a timeout or connection loss leaves the result unknown, say that confirmation was not received. Direct the user to refresh/reconcile the record before retrying. Do not label the action successful or failed and do not automatically replay it.

### 10.7 Read-only and disabled

Unauthorized actions are absent. A permitted but temporarily unavailable action may be disabled only with a nearby reason. Submitted, approved, rejected, and otherwise immutable records include a readable read-only explanation above the content; grey fields alone are insufficient.

### 10.8 Success

Announce success only after authoritative server acknowledgment. Consequential success remains inline long enough to understand the resulting state and updated timeline; a disappearing toast is not the sole confirmation. Copy names the actual result returned by the server. Download/export success never claims a browser saved a file when only generation or initiation is known.

### 10.9 Attachment states

- Uploading: progress and Cancel where safe.
- Pending scan: not ready; submission blocked if policy requires a clean result.
- Clean: available as evidence.
- Failed/quarantined: critical treatment, reason when safe, and permitted retry/remove/replace action.

## 11. RTL, LTR, localization, and mixed content

Set document `lang` and `dir` for the active locale. Use CSS logical properties for all layout, spacing, borders, positioning, and drawer behavior. Do not reverse data arrays to produce RTL. DOM order and focus order follow task meaning in both languages.

Mirror the rail, breadcrumbs, directional progression, and directional icons. Keep the brand lockup and non-directional icons unchanged. Build Arabic and English sentences independently; do not concatenate fragments with middle dots or raw arrows.

Wrap IDs, emails, URLs, filenames, UUIDs, request codes, and mixed-script names in `<bdi>` or an equivalent Unicode isolation strategy. Use internal `dir="ltr"` for email, URL, ID, time-code, and suitable numeric-entry controls. Add `translate="no"` to brand names, identifiers, and code tokens.

Use `Intl.DateTimeFormat` and `Intl.NumberFormat`; do not hard-code display formats. Display organization timezone context wherever a week, report interval, or authoritative timestamp could otherwise be ambiguous. Never use ambiguous numeric-only dates in explanatory copy. Arabic-Indic and Latin digits are accepted according to server/input policy; normalization must not change stored meaning.

Changing locale or appearance preserves the current route, query filters, active record, meaningful focus, and unsaved input. Do not reload or reset the workflow merely to change direction.

## 12. Responsive and zoom requirements

### 12.1 Required widths

- **320px:** minimum supported CSS viewport; one-column labelled content; no page-level horizontal scroll.
- **390px mobile:** primary mobile verification width.
- **640–1023px tablet:** drawer shell; filters wrap or use a panel; optional two-column content only under the stated minimum width.
- **1024px and wider desktop:** full rail and operational tables.

Breakpoints respond to available content width, not device identity. The shell may collapse earlier if 200% zoom makes the content region too narrow.

### 12.2 200% zoom and text spacing

At 200% browser zoom and with increased text spacing:

- navigation collapses before the work area becomes unusable;
- page header and primary action stack;
- two-column forms and context layouts collapse to one;
- buttons, tabs, status labels, and errors wrap without clipping;
- dialogs become scrollable panels and remain fully operable;
- tables become labelled rows unless genuinely two-dimensional;
- focused controls and errors are not obscured by sticky/fixed UI;
- no critical information depends on hover, fixed height, tooltip, color, animation, or position.

At 320px, reading order remains title, context/status, action, content, recovery. The virtual keyboard must not hide the focused field or make the final/recovery action unreachable. Account for safe-area insets in full-bleed drawer/dialog layouts.

## 13. WCAG 2.2 AA and accessibility contract

WCAG 2.2 AA is the minimum target, including Arabic and English operation.

Required mechanics:

- a keyboard-visible skip link to main content;
- semantic landmarks and exactly one page `h1`;
- hierarchical headings;
- `aria-current="page"` only on the active navigation link;
- native links for navigation and buttons for actions;
- no clickable generic containers or positive `tabindex`;
- visible `:focus-visible` treatment with the focused item unobscured;
- 44 × 44 CSS-pixel minimum pointer targets for primary controls and icon controls;
- captions and scoped headers for tables; equivalent labels in mobile reflow;
- status, unread, required, validation, and selection states communicated without color alone;
- one concise live-region announcement for loading, saving, confirmed success, and critical errors;
- focus management for route changes, dialogs, drawers, error summaries, removed rows, and mutation results;
- `prefers-reduced-motion` support; no identity depends on animation;
- forced-colors support using system colors and borders that survive color replacement;
- browser zoom must remain enabled; never set `user-scalable=no` or `maximum-scale=1`;
- dark mode sets `color-scheme: dark`; native controls have explicit foreground/background treatment;
- text and meaningful UI contrast meet AA for every actual state, not just base tokens.

Manual accessibility verification must include keyboard-only completion of sign-in, request creation/submission, returned correction, timesheet entry/submission, manager decision, mobile drawer, notification mark-read, preferences, and report filtering. Perform at least one Arabic and one English screen-reader pass. Test mixed names/IDs, long correction reasons, reduced motion, forced colors, and increased text spacing.

## 14. Implementation invariants

The following rules cannot be traded away during implementation:

1. The server is authoritative for capabilities, scope, validation, versions, statuses, next actor, transitions, export bounds, and mutation results.
2. The UI exposes no route, count, name, record, or action before capability resolution permits it.
3. Arabic is the default locale; Arabic and English have complete meaning and workflow parity.
4. Status, next actor/stage, and permitted next action appear together wherever a decision is made.
5. A manager’s self-service work is separate from direct-report review work.
6. Manager scope is active direct reports only unless a different returned capability explicitly changes scope.
7. HR visibility never implies edit or decision authority.
8. Manager approval is not displayed as final when HR approval remains.
9. Request history and timesheet history are append-only in presentation; raw enums are not primary user-facing copy.
10. Submitted/approved timesheets are read-only; rejected timesheets are terminal; returned timesheets support correction; reopen is an audited HR exception.
11. Recorded time is shown as hours and minutes and is never framed as employee performance.
12. The UI never chooses an approver or silently reroutes around a missing/inactive reviewer.
13. Valid user input survives validation, network, timeout, conflict, locale, and theme changes.
14. Mutations are not replayed automatically after errors, conflicts, or unknown outcomes.
15. Success appears only after server acknowledgment and uses the returned resulting state.
16. Unauthorized actions are absent; temporarily unavailable authorized actions include a visible reason.
17. Attachments expose upload and scan truth; pending/quarantined files never look approval-ready.
18. Filters, counts, previews, lists, reports, and exports use the same authorized scope and query semantics.
19. URL state preserves meaningful filters, tabs, sort, and pagination; back navigation restores context.
20. Desktop comparison uses tables/compact rows; mobile uses equivalent labelled record blocks.
21. Demo role/state controls remain isolated from production chrome.
22. Existing accessibility foundations—skip link, document language/direction, logical properties, mixed-script isolation, 44px controls, reduced motion, drawer Escape/focus return, dialog focus management, semantic tabs, and truthful loading/error/empty/read-only states—must not regress.
23. Authentication integration uses the supported session/CSRF contract; credentials or bearer tokens are not stored in local storage.
24. The six primitive color tokens are fixed. Derived colors require measured contrast and may not introduce an unreviewed primitive.
25. The interface remains understandable with shadows, gradients, color, animation, and hover removed.

## 15. Acceptance criteria

Implementation is design-complete only when all criteria below are demonstrated with real rendered behavior.

### 15.1 Information architecture and authorization

- Each test account sees only capability-granted destinations and actions.
- Employee, manager, and HR navigation follows the grouping and order in this specification.
- Direct URLs enforce the same scope as navigation and do not leak record existence.
- Manager personal work and direct-report review are visibly separate.
- HR organization visibility, administration, review, report, export, substitution, and reopen capabilities are independently represented.
- No protected navigation or data flashes while capabilities load.

### 15.2 Workflow comprehension and truth

- On each request/timesheet list and detail, a user can identify localized status, next actor/stage where permitted, and current action without relying on color.
- Returned work exposes the correction reason and direct corrective action.
- Submission explains the resulting review/read-only state.
- Manager approval that requires HR produces Awaiting HR review.
- Stale decisions, duplicate weeks, and unknown mutation outcomes use the specified reconciliation flows and never replay mutations.
- All success states are produced from server-confirmed responses.
- No UI text infers productivity, deadline, urgency, or authority not supplied by requirements/server policy.

### 15.3 Page and component behavior

- Home is attention-first and contains no generic KPI-card gallery.
- My requests and review queues use semantic desktop tables or compact aligned rows; mobile shows equivalent labelled records.
- Request detail and review detail prioritize state/next action before evidence and timeline.
- Weekly timesheets contain Monday–Sunday, organization timezone, minute inputs, and hours/minutes totals.
- Filters show applied state, scope, count, freshness, and persist in the URL/back path.
- Decision dialogs have no preselected outcome; Reject and Return require reasons.
- Attachments visibly support every applicable upload/scan/error/read-only state.
- Report scope, timezone, units, filters, freshness, and 10,000-row export bound are visible where reports are implemented.

### 15.4 State matrix

Exercise and pass:

- initial loading and background updating;
- first-use empty, filter-empty, no-review-work, no-week, and no-access;
- network/server error, session expiry, validation, forbidden/not found;
- success, read-only, disabled-with-reason;
- stale/version conflict, duplicate week, and unknown timeout;
- attachment uploading, pending scan, clean, failed/quarantined;
- request Draft, Awaiting manager, Awaiting HR, Approved, Rejected, Returned, Cancelled;
- timesheet no sheet, Draft, Submitted, Returned, Approved, Rejected, replacement link, and authorized HR reopen.

No state may clear valid input, expose an unauthorized control, show raw enums as primary copy, display fake zero data, or announce an unconfirmed outcome.

### 15.5 Responsive and localization matrix

Test Arabic RTL and English LTR in light and dark modes at:

- 320px;
- 390px;
- representative tablet width;
- desktop width;
- desktop at 200% zoom;
- 320px with increased text spacing.

Pass conditions: no clipped Arabic, accidental page-level horizontal scroll, hidden primary/recovery action, obscured focus/error, overlapping shell controls, broken mixed-script order, or loss of route/filter/unsaved state during locale or theme changes.

### 15.6 Accessibility and visual system

- Automated accessibility checks report no critical/serious violations on every implemented route and state fixture.
- Keyboard-only journeys listed in section 13 complete successfully.
- Arabic and English screen-reader passes correctly announce headings, labels, table relationships, statuses, tabs, dialogs, busy state, errors, and resulting state.
- Reduced motion, forced colors, browser zoom, and increased text spacing remain usable.
- All text, control, focus, border needed for comprehension, status wash, disabled state, overlay, and dark-mode contrast pairings are measured and meet WCAG 2.2 AA.
- The six tokens are used consistently; no seventh primitive, decorative gradient, emoji icon, or universal card treatment appears.
- Removing all shadows and animations leaves the hierarchy clear.

### 15.7 Regression verification

- Every current route and supported workflow continues to render or has an explicitly capability-gated successor.
- Production build, typecheck, and lint pass.
- Real-browser journeys cover all implemented roles/capabilities, both directions, state fixtures, dialogs, and drawer behavior.
- Current preservation behaviors listed in the implementation inventory do not regress unless this specification explicitly replaces their product presentation.

## 16. Assumptions

1. The current frontend remains a mock-data visual demo until a separately authorized backend integration task wires the supported API.
2. Backend capability and state-machine contracts remain the authority; this specification does not create permissions or transitions.
3. The approved request states are Draft, Awaiting manager review, Awaiting HR review, Approved, Rejected, Returned for correction, and Cancelled.
4. The approved timesheet states are Draft, Submitted for review, Returned for correction, Approved, and Rejected; rejected is terminal, with a distinct replacement flow where supported.
5. Weeks are Monday–Sunday in organization timezone and time is recorded as duration minutes plus unpaid break minutes.
6. Request types determine routing; employees do not choose approvers.
7. Attachments and reports obtain limits and policy text from the server. The only fixed report limit in scope is the approved CSV maximum of 10,000 rows.
8. Noto Sans Arabic and Inter may be self-hosted only after license and asset review; the defined fallbacks are acceptable until then.
9. Light, Dark, and System appearance modes remain supported because they already exist in the frontend contract.
10. Search and individual filter fields appear only where the corresponding endpoint supports them; the structural filter pattern remains fixed.

## 17. Out of scope

Do not add or imply:

- payroll, compensation, benefits, or leave-balance calculation;
- biometric attendance, clock-in/clock-out, location tracking, or native mobile behavior;
- employee scoring, productivity scoring, utilization rankings, leaderboards, targets, or invented KPIs;
- deadlines, overdue labels, service-level timers, or urgency not supplied by policy;
- bulk approval or bulk destructive actions;
- organization-wide manager access or hierarchy expansion;
- employee-selected approvers, self-approval, or silent reviewer rerouting;
- an arbitrary workflow builder or retroactive request-type workflow changes;
- external messaging, chat, email orchestration, or an assistant;
- client-side authorization, local-storage authentication tokens, or frontend-authored authoritative statuses;
- adding HR routes as empty placeholders before their capability and supported behavior exist;
- backend/API integration, application code changes, backend changes, planning-document changes, or Git operations as part of this design-specification task.
