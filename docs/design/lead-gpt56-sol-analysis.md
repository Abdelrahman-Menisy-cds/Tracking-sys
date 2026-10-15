# هي فوضى؟ — Lead product-design analysis

Status: decision-ready redesign proposal
Owner: lead product designer (GPT-5.6-sol)
Scope: visual and interaction direction for the existing Arabic-first employee requests and time-tracking website

## 1. Executive decision

Adopt a work-queue-first redesign called “The next clear action.” Keep the approved product contract and the existing demo’s behavior, but replace the current generic dashboard/card treatment with a quiet operational workspace: a directional rail, a single attention-led main column, explicit workflow context, and one memorable brand gesture—the composed clipboard’s orderly “stack”—used sparingly in the shell and first-use states.

The product’s primary job is not to make HR operations look busy. It is to let a person answer, quickly and without inference:

1. What needs my attention?
2. What is its authoritative status?
3. Who acts next?
4. What can I do now, and what will become read-only after I do it?

This proposal does not add payroll, biometric attendance, leave balances, employee scoring, deadlines, rankings, external messaging, workflow configuration, an assistant, or native mobile behavior. It uses the approved boundaries: requests, daily-duration weekly timesheets, scoped review, in-app notifications, scoped reports, auditable history, Arabic/English parity, and server-enforced authority.

Decision requested from implementation/design review:

- Choose Alternative A, “The operational desk,” below.
- Approve the six semantic color tokens as a starting candidate, then run an actual contrast check for every foreground/background/state pairing before implementation clearance.
- Treat the existing React routes and accessible behaviors as preservation constraints, not as proof that the current visual hierarchy is final.

## 2. Evidence and first-principles diagnosis

### What the repository says the product is

The approved PRD describes an Arabic-first bilingual employee-operations application, not a generic workflow builder. Employees manage their own requests and weekly time records; managers review active direct reports; HR has organization visibility and separately gated administration/decision capabilities. Django is the authority for scope, transitions, audit, and exports. Requests snapshot the manager at submission. Timesheets use Monday–Sunday weeks, daily duration and unpaid break minutes, with immutable submitted/approved records except for the explicitly audited HR reopen path.

The approved UX direction makes the experience rule explicit: show status, next actor, and available next action together. It also requires professional language around permissions, approval, rejection, performance, and recorded time; Egyptian situational humor may exist only as restrained optional brand behavior.

### What the current frontend visibly does

This is a visual demo with mock data and no backend integration, as stated by `frontend/README.md` and the source comments. The current implementation already contains useful behavior to preserve: Arabic-first `dir="rtl"`, English parity, logical CSS properties, `<bdi>` isolation, loading/error/empty branches, 44px controls, status text plus icon, a focus-trapped decision dialog, Escape-to-close navigation, and read-only timesheet treatment.

The visual diagnosis below is therefore a source-based design critique, not a claim of completed user research or a measured usability study.

### Why the current UI reads as generic, template-like, or AI-generated

1. **The same SaaS card is the answer to almost every hierarchy problem.** `global.css` applies one `.card` recipe—white/surface fill, one border, 12px radius, padding, and bottom margin—to home metrics, list rows, detail sections, empty states, notifications, and dialog-like content. `HomePage.tsx`, `MyRequestsPage.tsx`, `MyTimesheetsPage.tsx`, and `TeamReviewsPage.tsx` repeat the same card framing. When every object has equal enclosure, a request needing correction and a quiet informational block carry the same visual weight. This is a recognizable generated-dashboard pattern rather than a model of employee work.

2. **Repeated inline flex layouts flatten the page rhythm.** Many screens use the same “space-between, wrap, gap” header construction for titles, statuses, and actions. That is mechanically responsive, but it does not express a difference between a page title, a workflow alert, a record identity, and a destructive decision. A robust layout should make the difference structural, not leave it to incidental spacing.

3. **The shell is a generic rail plus controls rather than an operational instrument.** `AppShell.tsx` has a 232px rail, a generic header, and three compact selectors for demo role, language, and appearance. A persistent “Switch role (demo)” control is appropriate for a prototype reviewer, but it visually competes with real work and can make the product feel like a role-play template. In the real product, capability-scoped navigation must be derived from the authenticated account; role changing is not a user workflow.

4. **The visual language uses default dashboard tropes without enough subject-specific structure.** The home screen leads with repeated cards and large numeric counts, then repeats notifications and pending requests. The product’s distinctive subject is paperwork moving through accountable review, yet the current page does not make assignment, review stage, or correction loop the main visual grammar. The clipboard identity exists as a small SVG mark, but the body remains mostly interchangeable with an unrelated admin SaaS.

5. **Decorative symbols substitute for a considered icon system.** Source copy uses `+`, `→`, `←`, `☰`, `✕`, `✓`, `↩`, `⏳`, and `🗂️` in controls and states. Some are useful as supplemental symbols, but the mixture of emoji, text arrows, and typographic marks produces platform-dependent rendering and a “generated demo” feel. Directional actions also need semantic mirroring rules in RTL/LTR, not character substitution. Status icons should be consistent, accessible, and secondary to the label.

6. **The typography is technically sensible but visually unopinionated.** `tokens.css` names Noto Sans Arabic and Inter, while `global.css` sets a conventional 28px H1, 20px H2, standard sans body, and small muted metadata. This is legible groundwork, not a distinctive product voice. The current pages do not use a clear type hierarchy to distinguish “attention,” “record identity,” “supporting evidence,” and “audit chronology.” The fix is not a decorative display font or all-caps micro-labels; it is more deliberate Arabic/Latin metric handling and hierarchy.

7. **The palette is a candidate token sheet, not yet a product point of view.** The current teal/violet/status palette is inherited from the UX direction and is explicitly not contrast-certified. In the interface, primary teal, violet accents, blue information, green success, amber warning, and red error coexist with surface cards. Without a strict rule about where accent color is allowed, the page becomes a collection of semantic tints. The redesign should spend color on action and state, while the canvas and surfaces stay calm.

8. **The current status model is correct but under-explained in layout.** `RequestStatusPill` and `TimesheetStatusPill` pair icon and text, which is good. But in list rows the pill is often just a neighboring element, while the responsible reviewer/next stage is not consistently presented beside it. A user sees “Awaiting manager review” but should also see the next actor and the available action, where permitted. A pill cannot carry the whole workflow explanation.

9. **The demo exposes implementation/test affordances in the product chrome.** The always-visible demo banner and reviewer-only state tools are honest and useful for a prototype. They also necessarily make the product look like a showcase build. Keep them in the demo environment, but isolate them in a clearly bounded environment notice and a reviewer tools panel; do not let them define the production shell.

10. **Some current copy and data presentation reveal prototype seams.** The editor disables attachment upload and labels it as a demo limitation. Detail views display raw-looking IDs and status event names, while the event history uses `CREATE`, `SUBMIT`, and direct status codes. The redesign should keep identifiers available where useful, but make human-readable localized actions primary and isolate IDs as secondary LTR data. The real product must render server-authoritative state, not the current mock shortcut.

The conclusion is not “add more decoration.” It is to give the information a product-specific order: attention first, workflow second, evidence third, audit history fourth. This is what makes the interface feel authored rather than assembled.

## 3. Experience principles

1. **Attention before activity.** Lead with items that require a permitted action or correction. Do not turn every count into a KPI.
2. **Status is a sentence, not a color.** Every state names what happened, who acts next, and what the current user may do.
3. **Personal work and review work are separate rooms.** A manager’s own requests/timesheet remain self-service; direct-report review is a separate capability-scoped area.
4. **A record is a chain of accountable events.** Details, attachments, current state, and append-only history should read as one record—not as unrelated cards.
5. **Professional first, local character second.** Use the clipboard/ordered-paper identity in welcome and appropriate first-use emptiness. Never use humor in a rejection, correction, permission, or failure explanation.
6. **Calm surfaces, decisive controls.** Borders, spacing, and typography create hierarchy. Color marks action and state; shadows and gradients do not create hierarchy.
7. **Preserve user effort.** Never clear valid input after a validation, network, timeout, or conflict response. Do not claim save or approval until the server confirms it.
8. **Direction is a behavior.** Arabic is not an English page with mirrored alignment. Reading order, form sequence, breadcrumbs, navigation edge, icons, mixed-script identifiers, and dates need explicit RTL/LTR rules.

## 4. Workflows and information architecture

### Shared task model

The primary workflow objects are “my requests,” “my weekly time,” “review work,” and “notifications.” Every actionable object should expose this compact sentence structure:

`[status]  [record identity]  [who acts next]  [permitted action]`

Examples, using approved vocabulary only:

- `بانتظار مراجعة المدير — إجازة اعتيادية — المدير يراجع الآن — عرض الطلب`
- `معاد للتعديل — تصحيح سجل وقت — أنت — تعديل وإعادة الإرسال`
- `مُرسل للمراجعة — أسبوع 14–20 سبتمبر — المراجع — فتح السجل`

The next actor is server-derived. The UI must not invent a reviewer when a manager is missing/inactive; it shows the policy-provided HR flag/blocking explanation instead. A manager approval must not look like final approval when HR review remains.

### Employee navigation and workflows

Persistent primary navigation, in Arabic at the inline end and in English at the inline start:

- الرئيسية / Home
- طلباتي / My requests
- سجلات وقتي / My timesheets
- الإشعارات / Notifications

Account menu:

- الملف الشخصي / Profile
- المظهر / Appearance
- تسجيل الخروج / Sign out

Employee request workflow:

1. Home shows returned work first, then pending requests, then current-week timesheet status.
2. “طلب جديد / New request” opens a focused editor: request type, title, approved type-defined fields, details, attachments, save draft, submit.
3. The type’s review path is described in plain text from server policy; the employee never chooses an approver.
4. Before submit, show a short confirmation summary and the resulting review stage; do not promise a final outcome.
5. Detail view combines state, current responsible reviewer/next step, content, attachments, and append-only timeline.
6. Returned requests put the reason above the editable fields and retain prior history. Draft/submitted cancellation is explicit and only available before a decision.

Employee time workflow:

1. Home offers the current week and its status.
2. Week editor presents Monday–Sunday in organization timezone, daily duration minutes, unpaid break minutes, and optional description as the approved fields.
3. Totals are shown as hours and minutes, never decimal-hour arithmetic. Validation explains daily/weekly limits and invalid values without inferring productivity.
4. Submission confirmation states that the record becomes read-only. Returned records surface the correction reason and allow correction/resubmission. Rejected records are terminal; a replacement workflow is a distinct record.

### Manager navigation and workflows

Manager sees all employee navigation plus a clearly separated:

- مراجعات الفريق / Team reviews
- التقارير / Reports (team scope)

The review room has two explicit tabs: requests and timesheets. Its header states “active direct reports only,” the applied filters, result count, and last refresh/updating status. There is no organization-wide manager view, hierarchy expansion, role switcher, or bulk approval.

Review workflow:

1. Queue rows sort deterministically and expose named record links.
2. Each row shows employee, record identity/week, status, submission date, and the available decision action only when capability and state permit it.
3. Detail opens with the decision region adjacent to the current state and next-step explanation.
4. Approve, reject, and return are separate explicit choices; reject/return require a visible reason. The dialog names the record, current state, selected decision, and comment.
5. After a decision, show the server-confirmed resulting state and refresh the queue. A stale/concurrent decision reloads the latest state without replay.

### HR navigation and workflows

HR sees the employee navigation plus only capabilities actually granted. Target IA from the approved PRD includes:

- مراجعات الفريق / Team reviews, only where review capability exists
- طلبات المؤسسة / Organization requests, visibility separate from decisions
- سجلات وقت المؤسسة / Organization timesheets, visibility separate from decisions
- الموظفون / Employees
- أنواع الطلبات / Request types
- التقارير / Reports, organization scope

These are target information-architecture destinations in the product contract; they do not authorize adding functionality to the current visual demo without the corresponding backend capability. HR is an application role, not a superuser.

HR workflows should make authority boundaries visible:

- Employee administration separates identity, reporting line, role/account status, and read-only personal profile facts.
- Request-type configuration states the approved routing policy and any in-flight impact before saving; it is not a workflow builder.
- Organization lists, dashboards, details, attachments, events, and exports use the same server-derived scope. A view permission does not imply a decision/edit control.
- Manager substitution and timesheet reopen are exceptional explicit actions, requiring the approved reason, confirmation, and audit event. They should never appear as casual row actions.
- Reports show scope, date interval, timezone, units, filters, and generation context beside the result. CSV export is bounded to 10,000 rows and never claims more than download initiation.

## 5. Page and layout structure

### The “operational desk” frame

Desktop (1024px and wider):

- A 248px logical inline-start navigation rail, with brand lockup, primary navigation, and account controls at the bottom.
- A compact top bar in the content region: current section, notifications, language, appearance, account entry. The production shell does not expose role switching.
- A centered content measure of 1200–1280px with a readable primary column. Avoid filling the viewport with equal cards.
- A page header containing one H1, a plain-language scope/date subtitle when needed, and one primary action.
- An optional attention strip immediately below the header, only when there is returned work, an actionable review queue, a blocking condition, or a stale/updating result.
- Main content in a 760px reading column plus an optional 320px context column on detail/review pages. On simple list pages, use one full-width operational column.

Tablet (640–1023px):

- Compact header and a drawer/rail trigger.
- Two-column summary layouts only when each column remains readable; otherwise one column.
- Keep filter controls in a wrapping toolbar, not a row that clips.

Mobile (320–639px):

- One column, top bar with menu trigger, page title, and notification entry.
- Navigation is a modal drawer from logical inline-start with focus trap, named close action, Escape support, and focus return.
- Attention strip precedes the first list. Primary action is full-width or has a clear 44px target.
- Record rows become labeled cards. Timesheet rows become day sections with entry cards; no spreadsheet interaction is required to discover or complete the task.

### Page templates

Home:

`H1 + greeting/scope` → `attention strip` → `primary actions` → `my work queue` → `current week` → `recent notifications` → optional scoped review preview.

List:

`breadcrumb where nested` → `H1 + scope` → `primary action` → `search/filter/sort toolbar` → `applied filters + result count` → `table or labeled cards` → `pagination`.

Editor:

`breadcrumb` → `H1 + state` → `returned/blocking explanation if any` → `form sections` → `attachments` → `save draft / submit action group` → server-confirmed inline status.

Detail/review:

`back/breadcrumb` → `record identity + status` → `next actor/action panel` → `details` → `attachments or week entries` → `append-only timeline` → decision region only when authorized.

Report:

`H1 + scope/timezone` → `filter form` → explicit Apply filters → stale/updating marker → totals/table → bounded export action.

Do not make every section a floating rounded card. Use three levels: canvas, a bordered surface for a coherent working region, and a quiet inset for metadata/read-only context. A full-bleed divider or background change may separate regions without adding another box.

## 6. Typography and information density

### Type direction

Use Noto Sans Arabic for Arabic and Inter for Latin with system fallbacks, subject to license/self-hosting review already identified in the UX direction. Keep the family pairing stable rather than introducing a decorative display face. The product’s distinction comes from order and copy, not novelty typography.

Suggested scale:

- Body: 16px; line-height 1.6 Arabic, 1.5 Latin.
- Helper and metadata: 14px; line-height at least 1.5, never used for critical instructions alone.
- Page H1: 30–32px, weight 700.
- Section H2: 22px, weight 700.
- Record title: 18–20px, weight 700.
- Large operational value: 28–32px only for a meaningful count or duration total, always paired with a label and destination.
- Buttons/inputs: 16px; minimum height 44px.

Do not use all caps, tracked-out Arabic, monospace metadata, eyebrow labels above every heading, italic emphasis on a single headline word, or decorative “01 / 02 / 03” numbering unless the content is an actual sequence such as a workflow timeline.

### Density rules

- Default list row: 12–16px block padding, 16px inline padding, one primary line, one supporting line, status and action aligned without crowding.
- Table body: 14–16px; 12px cell padding minimum. Keep headers short, explicit, and scoped.
- Forms: one field per row in the reading column; two columns only for genuinely paired fields and only when labels remain clear at 200% zoom.
- Keep line length below 80 characters for explanatory text. Use readable wrapping rather than shrinking Arabic.
- Show no more than the information required to decide or act at first glance. Put IDs, audit request IDs, MIME details, and secondary timestamps behind a secondary metadata line or disclosure while keeping them accessible.
- Use tabular numerals for dates/durations where supported. Keep email, ID, URL, filename, and time-format strings LTR internally with `<bdi>` or an equivalent isolation strategy.

## 7. Six semantic color tokens

These are six named semantic tokens for the redesigned base system. Hex values are candidates and require measured contrast verification before shipping. Status semantics should use text/icon plus the token, never color alone.

| Token | Hex | Role |
|---|---|---|
| `ink` | `#172033` | Primary text, strong headings, high-confidence content |
| `canvas` | `#F5F7F9` | Page background; keeps the workspace quiet without the common warm-cream AI palette |
| `surface` | `#FFFFFF` | Working surfaces, form fields, dialogs, table body |
| `teal-action` | `#0F766E` | Primary action, active links, confirmed operational affordances |
| `violet-signal` | `#6D28D9` | Secondary brand signal, unread marker, composed-clipboard accent; not a second primary CTA everywhere |
| `focus-alert` | `#1D4ED8` | Keyboard focus ring and high-visibility attention boundary; never the only status cue |

Status backgrounds should be derived only after the contrast pass, with the same semantic rules in light and dark themes: neutral for draft/cancelled, information for pending/submitted, success for approved, attention for returned, and error for rejected. The redesign must not assume the status text colors can also serve as destructive button fills. Dark theme needs explicit surface/text/status pair review rather than simply inverting these six values. System resolves to light or dark and persists as `system`, `light`, or `dark` according to the approved policy.

## 8. Component patterns

### Shell and navigation

- `BrandLockup`: live text for `هي فوضى؟`, separate compact composed-clipboard mark, no mirrored wordmark. Descriptor is `شؤون الموظفين / Employee Operations` only if that approved copy remains; otherwise use the project’s agreed descriptor.
- `PrimaryNav`: capability-scoped links, visible current-page marker, `aria-current`, no inaccessible route names or counts while capabilities load.
- `AttentionStrip`: one message, one recovery/action path, explicit severity, no mascot in serious decisions.
- `AccountMenu`: profile, appearance, sign out; language uses `العربية` and `English`, never flags.

### Buttons and forms

Use verbs that predict the result: “حفظ المسودة / Save draft,” “إرسال الطلب / Submit request,” “تأكيد القرار / Confirm decision,” “إعادة المحاولة / Retry.” Primary, secondary, and destructive button roles must remain visually distinct. A pending mutation disables duplicate activation and announces progress; a disabled permitted action has an adjacent reason. Unauthorized actions are absent rather than merely disabled.

Every field has a visible label, stable help/error association, required text, and server-error mapping. Validation uses an error summary linked to fields plus inline messages; valid values remain intact. File rows show filename, allowed type/size information when supplied by policy, upload progress, scan state, and named retry/remove actions. Pending/quarantined files cannot look approval-ready.

### Table pattern

Use a real `<table>` for desktop operational data with caption, `scope="col"`/`scope="row"`, visible headers, deterministic sort direction, and a named link in the primary cell. Recommended request columns: request/title, type, requester where permitted, status, next actor, last update, action. Recommended timesheet columns: employee where permitted, labeled week interval, status, total recorded duration, last update, action.

At mobile width, transform to labeled cards or a carefully stacked row—not an unlabeled horizontal scroll by default. If a genuinely two-dimensional table remains, provide an explicit region label, keyboard-accessible scrolling, and preserve headers. Never hide critical status or action in hover.

### Card pattern

Cards are reserved for coherent objects or summaries, not every paragraph. A work item card has:

- identity link and optional type/week;
- status plus plain-language next actor;
- one supporting metadata line;
- one permitted primary action;
- a visible correction/blocking reason when present.

Summary panels may use a stronger top rule or quiet surface contrast, but never turn every metric into a large numeral. No invented targets, overdue labels, productivity scores, or rankings.

### Filter pattern

A filter toolbar begins with search (if the endpoint supports it), then permitted status/type/employee/date filters, sort, and an explicit “تطبيق الفلاتر / Apply filters” action for reports. Applied filters remain as removable chips with a “Clear all” action. Show result count and scope/date interval from the same authorized query as the rows. On mobile, filters open in a named panel and display an applied-filter summary when closed. Preserve filters when returning from detail.

### Status pattern

Use a localized label and a consistent small icon, with color as reinforcement:

- Draft / مسودة — editable preparation.
- Awaiting manager review / بانتظار مراجعة المدير — manager is next.
- Awaiting HR review / بانتظار مراجعة الموارد البشرية — HR is next.
- Submitted for review / مُرسل للمراجعة — timesheet is read-only while under review.
- Approved / معتمد — final only where the configured workflow says so.
- Returned for correction / معاد للتعديل — requester/employee has a corrective action.
- Rejected / مرفوض — terminal for the approved relevant workflow; timesheet replacement path is explained separately.
- Cancelled / ملغى — no further action.

Place the next-actor sentence adjacent to the status on details and review rows. Do not encode “manager approved” as “final approved” when HR is still required.

### Timeline pattern

Render history as an append-only vertical timeline with a visible spine, one event marker per event, and chronological order. Each event contains localized action, actor where permitted, timestamp rendered in locale with timezone context, transition label, and comment/reason. The current event/state is visually anchored; past entries are quieter but fully readable. Keep raw event codes out of the primary reading line; retain IDs and request IDs in secondary accessible metadata. Do not use decorative numbered steps for an audit history unless the numbers communicate event order.

### Dialog pattern

Decision dialogs must identify the record and current state, offer an unselected choice among approve/reject/return, expose a required reason field for reject/return, trap focus, support Escape before submission, return focus to the trigger, and show only server-confirmed result. A stale conflict is a recovery state, not a success toast.

## 9. Truthful states

Apply these patterns to every target page, including current demo routes S01–S10 and the capability-gated HR destinations in the product contract.

- **Loading:** skeleton mirrors the eventual structure; one polite localized announcement; do not show fake zero counts, empty rows, or disabled controls without explanation. For background refresh, preserve old content and mark it “updating.”
- **Empty:** distinguish first use, no matching filters, no pending review, and no access. First-use requests invite “إنشاء طلب جديد / Create a new request.” Filter emptiness offers clear filters. A manager’s empty queue must not say or imply that every item is approved.
- **Error:** separate network/server failure, expired session, safe forbidden/not-found, validation, and conflict. Preserve safe input; retry reads rather than replaying mutations. Show a request/reference ID only when the server supplies one.
- **Validation:** place a localized error summary before the form, link to the invalid field, retain valid values, explain the approved time/file rule, and avoid interrupting Arabic composition.
- **Disabled/read-only:** state why the control is unavailable beside it. Submitted/approved timesheets show a readable explanation, not merely grey fields. Do not expose controls the user cannot authorize.
- **Success:** announce only after server acknowledgement, show the resulting state/history, and use persistent inline confirmation for consequential actions. Do not rely on a disappearing toast or say a file was saved to disk when only download initiation was confirmed.
- **Conflict:** explain that the record changed elsewhere or the week already exists, show the latest authoritative state, offer “Refresh record” or navigation to the existing weekly sheet, and never automatically repeat a submit/decision.
- **Unknown timeout:** say the action could not be confirmed, instruct the user to refresh status before retrying, and do not label it success or failure.
- **Attachment scan:** visually distinguish uploading, pending scan, clean, and quarantined/failed. Pending or failed files cannot be presented as evidence ready for approval.
- **Permission/loading boundary:** while capabilities are unresolved, do not flash HR routes, employee counts, review actions, or export controls.

## 10. Responsive, RTL/LTR, and accessibility behavior

Target WCAG 2.2 AA, 320px reflow, 200% text/browser zoom, keyboard-only operation, reduced motion, and forced-colors consideration. These are acceptance targets, not claims that the existing demo has passed them all.

### RTL/LTR

Set `lang` and `dir` on the document for the selected locale. Use logical properties for layout and spacing. Mirror navigation rail, breadcrumbs, directional progression, and directional icons where their meaning is directional; do not mirror logos, checkmarks, clocks, attachment icons, media controls, numeric axes, or chronology. Keep DOM/focus order semantic rather than reversing arrays with CSS. Use `<bdi>`/isolation for IDs, emails, URLs, filenames, names mixed with Latin text, and event identifiers. Date/time strings are localized around an unchanged instant; internal numeric fields remain keyboard-friendly LTR where appropriate. Arabic and Latin digits are accepted as policy allows; never use ambiguous numeric-only dates in explanatory copy.

### Zoom and reflow

At 200% zoom, the navigation collapses before content becomes unusably narrow, buttons wrap without clipping, long Arabic labels grow vertically, and dialogs become scrollable panels. The H1 and primary action may stack. Two-column forms collapse to one. Tables become labeled cards at the content breakpoint; any remaining scroll region has a name and keyboard access. No essential information depends on hover, fixed height, color, animation, or a hidden tooltip.

At 320px CSS width, the reading order remains: page title, context/status, primary action, content, recovery/action. Sticky controls must not cover focused fields or error messages. Virtual keyboard behavior must keep the active field and submit/recovery action visible.

### Accessibility mechanics

- Skip link to main content and one H1 per page.
- Real landmarks and `aria-current` on the current navigation item.
- Visible focus ring with sufficient separation from adjacent surfaces and a focus target that is not obscured.
- Native links/buttons/inputs; no clickable divs or positive tabindex.
- Tables with captions and scoped headers; cards preserve equivalent labels.
- Dialog focus trap, initial meaningful focus, Escape close before mutation, and focus restoration.
- Status, unread state, required fields, and validation use text and semantics in addition to color.
- Live regions announce loading, saving, confirmed success, and critical errors once, without repeating every skeleton cell.
- Respect `prefers-reduced-motion`; do not use a page-load cascade or hover animation as visual identity.
- Test Arabic screen-reader output, English screen-reader output, mixed names/IDs, keyboard order, and forced colors manually after implementation.

## 11. Compact alternatives

### Alternative A — The operational desk (recommended)

```text
+----------------------+----------------------------------------------+
| هي فوضى؟             | الصفحة الحالية          [الإشعارات] [الحساب] |
| الرئيسية              +----------------------------------------------+
| طلباتي                | H1: ما يحتاج انتباهك الآن                    |
| سجلات وقتي            | [تنبيه/تصحيح]                                |
| مراجعات الفريق*      | [طلب جديد] [فتح سجل الوقت]                  |
| الإشعارات             |                                              |
|                      | | قائمة العمل |        | سياق الحالة |       |
| الملف / المظهر        | | status · next |        | reviewer/history |     |
+----------------------+----------------------------------------------+
```

The main column is a queue, not a gallery of KPI cards. A context column appears only when it helps decide a record. This directly encodes the product’s status/next-actor/action principle.

### Alternative B — The two-room ledger

```text
+------------------+--------------------------------------------+
| ذاتي             | H1: عملي                                   |
| - طلباتي         | +------------------------------------------+
| - سجلات وقتي     | | الطلبات الشخصية | سجلات الوقت            |
|                  | +------------------------------------------+
| مراجعة الآخرين   | H1: مراجعات الفريق                         |
| - طلبات الفريق   | [طلبات] [سجلات وقت] [filters]              |
| - سجلات الفريق   | [dense table / mobile cards]               |
+------------------+--------------------------------------------+
```

This is strongest when the distinction between self-service and review work is the dominant mental model. It is more explicit than the current shell, but it risks making Home feel like a directory and can create duplicate navigation concepts for managers.

### Alternative C — The chronological casebook

```text
+----------------------+----------------------------------------------+
| navigation           | H1: سجل العمل                                |
|                      | [filter] [search]                             |
|                      |                                              |
|                      |  ● اليوم  Returned — تصحيح مطلوب              |
|                      |  │  record + next action                      |
|                      |  ● أمس    Submitted — بانتظار المراجعة        |
|                      |  │  record + reviewer                         |
|                      |  ● سابقًا Approved — مكتمل                    |
+----------------------+----------------------------------------------+
```

This makes auditability and chronology memorable, and it is a good detail-page pattern. As the primary home/list IA it is weaker: chronology is not the same as attention, and a timeline-first home can bury a returned request or pending review among completed history.

## 12. Choice, rationale, risks, and validation

### Choice: Alternative A — The operational desk

Choose A because it maps one-to-one to the approved first-principles job: attention, status, next actor, action. It works for the employee’s corrective loop, the manager’s scoped queue, HR’s capability-gated organization work, and the detail page without pretending that all records are KPIs. It gives the composed clipboard identity a meaningful place: a small ordered stack can appear in first-use/empty states, while the serious workflow surface stays restrained.

A also has the safest implementation seam. The existing routes, list-state union, status components, dialogs, and scope-sensitive mock shapes can remain behavior contracts while the shell, page templates, tokens, and repeated card markup are refactored. The design can be implemented incrementally without claiming that mock role switching is production authorization.

### Risks and mitigations

- **Queue-first home may make completed work less visible.** Mitigate with clear “all requests,” “all timesheets,” and notification destinations; do not remove history.
- **The context column may become a second dashboard.** Limit it to next actor, policy explanation, and selected record context; collapse it on narrow widths.
- **Six tokens do not by themselves solve contrast or dark mode.** Run automated and manual contrast checks across all actual pairings, status surfaces, focus, disabled, hover, and forced-colors modes.
- **Arabic/Latin type metrics may increase vertical height.** Accept vertical growth; test long Arabic strings and use responsive stacking instead of shrinking type.
- **HR IA could be mistaken for permission to build unapproved capabilities.** Gate each destination by the existing permission matrix and keep unavailable routes out of the navigation. Reconcile any implementation work with backend authority.
- **Replacing cards may obscure the fact that the current demo is intentionally a visual demo.** Keep the mock-data banner in demo builds, but style it as a bounded environment notice rather than product content.
- **A new shell can regress existing accessibility behavior.** Preserve skip link, `aria-current`, focus restoration, dialog trap, `<bdi>`, logical properties, 44px targets, and state branches as explicit regression criteria.

### Validation criteria before implementation sign-off

1. **Workflow comprehension:** In moderated or internal task testing, participants can identify status, next actor, and available action on request and timesheet list/detail screens without relying on color. Record task errors and questions; do not claim success before testing.
2. **Arabic-first parity:** Every S01–S10 route has complete Arabic and English copy parity, correct direction, sensible line breaks, mixed-script isolation, and equivalent action order. Switch locale without losing route, filters, focus, record, or unsaved edits.
3. **Authorization presentation:** Employee, manager, and HR views expose only the routes/actions represented by the approved permission matrix. A manager sees active direct reports only; HR visibility and action controls remain separate; no counts or names flash during capability loading.
4. **State truthfulness:** Exercise loading, first-use empty, filtered empty, no-pending-work, error/retry, validation, disabled/read-only, success, unknown timeout, duplicate-week, and stale-decision conflict. No mutation is replayed automatically and no unconfirmed operation is announced as successful.
5. **Responsive matrix:** Test 320px, 390px, tablet, and desktop at normal and 200% zoom in both directions. Verify no clipped Arabic, hidden submit/error, obscured focus, accidental horizontal page scroll, or unusable table/card transformation.
6. **Keyboard and assistive technology:** Complete employee request creation/submission, returned correction, timesheet entry/submission, manager decision, mobile drawer, notification mark-read, and report filtering with keyboard only. Test at least one Arabic and one English screen-reader pass.
7. **Visual system:** Confirm the six token roles are used consistently; measure contrast for text, muted text, action fills, status text/backgrounds, controls, focus rings, overlays, disabled states, light/dark themes, and forced colors. Verify that removing all shadows/gradients still leaves clear hierarchy.
8. **Content integrity:** Review every status sentence against the request/timesheet state machines. The UI never calls manager approval final when HR approval remains, never infers productivity from recorded hours, never invents a reviewer, and never changes immutable history.
9. **Regression safety:** Keep the existing route inventory and state handling as test fixtures. Run the frontend build/lint plus real-browser journeys after the redesign; no design clearance is implied by this proposal alone.

## 13. Implementation boundary and handoff

This file is a design proposal only. It does not authorize editing application code, backend code, planning artifacts, data, or permissions. The first implementation pass should retokenize and restructure the shell/page templates before visual polish, then migrate one low-risk screen at a time: sign-in, notifications, request detail, home, requests, timesheets, and finally review queue/dialogs. Preserve the current data/state interfaces until a separate API integration decision is made.

Open items already identified by the repository remain open where applicable: final font licensing/self-hosting, measured contrast, final brand lockup/descriptor clearance, exact report CSV conventions, and any implementation details that must be reconciled with backend authority. This proposal does not resolve a business rule by visual preference.
