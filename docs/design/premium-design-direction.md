# هي فوضى؟ — Premium Design Direction

Status: proposed experience refinement for user approval; not a replacement for approved business, security, or design contracts.  
Deliverable scope: this document only. Repository research was read-only; no application edits, additional documents, installations, or commits. GPT-only authorship; no Claude or GLM execution or design conclusions used.

## 1. Direction in one sentence

**An Arabic-first operational desk where every request and every week reads as a clear, accountable record: what happened, who acts next, and what you can safely do now.**

Premium means reduced uncertainty, not increased decoration. The experience should feel composed, precise, humane, and dependable under repeated daily use. An employee correcting a returned timesheet should feel as well served as a manager reviewing a long queue. Quiet polish must survive Arabic wrapping, dark mode, slow responses, rejected work, keyboard use, and dense records—not merely a populated desktop screenshot.

The existing product philosophy, **the next clear action**, remains the foundation. This direction gives that philosophy a reusable design-pattern vocabulary and a recognizable finish. “Design-skills-library-style” is interpreted as the craft and consistency of a curated system of patterns, not a new employee-facing marketplace, component gallery, or AI prompt library.

## 2. Evidence and authority

### Sources studied

| Source | Contribution and limits |
|---|---|
| `.hermes/plans/2026-09-10_021026-employee-operations-blueprint.md` | Product identity, BMAD process, stack, MVP and deferred features; historical sections contain older workflow/model assumptions. |
| `docs/PROJECT_CONTEXT.md` | Arabic-first bilingual employee operations identity and project boundaries. |
| `docs/design/final-design-specification.md` | Existing operational-desk authority: capability IA, six colors, typography, layouts, truthful states, accessibility, and workflow invariants. This proposal preserves those contracts. |
| `specs/request-state-machine.md`, `specs/timesheet-state-machine.md` | Approved routing, terminal states, correction, cancellation, and exceptional reopen boundaries. These take precedence over simplified historical plan diagrams. |
| `docs/design/GPT_TEAM_REDIRECT.md` | GPT-only redesign constraint and exclusion of Claude conclusions. |
| `docs/design/frontend-implementation-inventory.md` | Historical demo inventory and preservation checklist; not a current completeness certificate. |
| `docs/design/gpt55-independent-implementation-review.md` | Prior GPT review of a named commit, identifying authority, localization, state, and accessibility risks. Its findings require rechecking against subsequent edits. |
| `frontend/src/main.tsx`, `frontend/src/screens/HomePage.tsx`, `frontend/src/styles/tokens.css`; source-file inventory | Current route surface, mock-driven home behavior, and already-aligned base visual tokens. Source inspection only, not rendered verification. |
| [TypeUI Premium](https://www.typeui.sh/design-skills/premium) | Public page text was accessible. Describes restrained surfaces, measured type/spacing, component-state contracts, and testable accessibility. No premium download, installation, screenshots, or private content was used. |

The original PDF is treated as upstream context mediated by the master plan and approved requirements; it was not independently re-extracted for this direction. This document makes no new claim about its exact wording.

### Reference translation, not imitation

Borrow the method: content over chrome, deliberate spacing, consistent states, restrained color, and measurable quality gates. Do not borrow TypeUI's blue/purple palette, Apple imitation, Latin-only typographic assumptions, marketing heroes, or generic component coverage indiscriminately.

Our translation is distinct: teal actions, one violet paperwork gesture, Arabic-native type rhythm, correction-first queues, minute-based weekly ledgers, and visible decision provenance. Do not introduce a seventh primitive color or a competing font/shape system to make the interface look “more premium.”

### What exists versus what is intended

Current routing includes sign-in, home, personal requests/create/detail, personal timesheets/detail, team reviews/request review detail, and notifications. Organization administration, reports, and dedicated preferences are not present as standalone routes in the inspected router. They are capability-dependent target surfaces, not delivered features.

Current home code imports mock arrays, derives attention and counts separately from async list results, selects the first timesheet as the current week, and names Cairo in copy. These are concrete seams to address later: the premium contract requires the resolved authorized query, the actual organization week, and returned timezone—not merely better styling around seeds. Existing color and sizing tokens already substantially match the approved specification; the largest improvement is compositional and behavioral consistency, not wholesale retheming.

OBSERVATION: the master plan retains non-GPT model assignments and the inventory refers to pending Claude-era reports, while the current request and redirect require GPT-only work → treat those passages as historical, use current approved contracts, and request separate authorization before anyone updates shared guidance. No shared guidance is changed here.

## 3. Experience principles and boundaries

1. **Attention before activity.** Returned work with its reason outranks a feed of completed actions. An old request is not automatically overdue.
2. **One continuous record.** Identity, authoritative state, next actor, evidence, decision, and history belong to one coherent document—not a wall of equal cards.
3. **Calm is not faint.** Strong readable text, explicit boundaries, visible focus, and recoverable errors are premium qualities.
4. **Density follows the task.** Comparison is compact; writing and consequential decisions have breathing room. Arabic text is never reduced to fit a Latin-shaped box.
5. **Authority is visible but not invented.** Visibility does not imply permission. A returned status, review-stage label, or disabled explanation must reflect policy and server data.
6. **Continuity is polish.** Back navigation restores the queue. Locale changes preserve drafts. A timeout preserves uncertainty rather than manufacturing success.
7. **Character appears at the edges.** The brand is memorable at entry; difficult employment decisions remain professional and emotionally neutral.

In scope: design direction for existing MVP employee requests, review, weekly duration records, notifications, scoped administration/reporting, and preferences where supported.

Not introduced: payroll, leave balances, clock-in/out, surveillance, employee scores, rankings, utilization targets, invented SLA timers, batch approvals, arbitrary workflow building, native apps, or an assistant. A future assistant must not displace core navigation or become the only way to perform a task.

## 4. Visual language: composed paperwork, not simulated paper

### Composition and identity

Use a quiet canvas and continuous working surfaces. Align section titles, table text, fields, and action edges to a common grid. Use separators to express record structure; do not put every sentence, statistic, or event in a rounded container.

The live-text Arabic name **هي فوضى؟** leads the brand. Use **Heya Fawda?** in English-facing contexts, never a literal translation. Descriptor: `شؤون الموظفين / Employee Operations`. The composed clipboard/paper-stack mark with one violet slip is the signature. Limit it to the shell lockup, sign-in, and selected first-use states. Avoid paper textures, torn edges, stamps, cartoon bureaucracy, gradients, glass panels, and floating ornamental blobs.

Welcome may use `من الفوضى إلى النظام / From chaos to clarity`. Operational pages do not repeat the tagline. No jokes in correction, rejection, permissions, quarantine, or error copy.

### Color contract: preserve the approved six primitives

| Token | Light | Dark | Role |
|---|---|---|---|
| Ink | `#172033` | `#F8FAFC` | Text and neutral structure |
| Canvas | `#F5F7F9` | `#0F172A` | Application background |
| Surface | `#FFFFFF` | `#1E293B` | Work regions, fields, dialogs |
| Action | `#0F766E` | `#5EEAD4` | Primary action, links, approved/confirmed result |
| Signal | `#6D28D9` | `#C4B5FD` | Brand slip, focus, pending/unread/returned signal |
| Critical | `#B91C1C` | `#FCA5A5` | Rejection, destructive actions, blocking errors |

Derive borders, washes, overlays, muted text, and hover fills from these tokens. Status always includes localized text and a distinguishable symbol; returned work additionally has a logical-start rule and correction reason, so it cannot be mistaken for pending. Draft and cancelled share neutral color, not identical wording or iconography. Do not make an entire queue colorful.

Light primary buttons use surface text on action; dark buttons use canvas text on action. Focus retains the approved 3px signal ring with at least 2px separation. Validate actual derived pairings; this document does not certify contrast.

### Typography, shape, and rhythm

Retain Noto Sans Arabic and Inter, with the specified system fallbacks. Self-host only after license/asset review. Arabic body/control text is 16px with 1.65 line height; English is 16px with 1.5. Metadata is 14px, not tiny gray fine print. Headings retain 32px desktop/28px mobile page titles, 22px section titles, and 18px record titles. Use 400/600 for body and controls, 700 for the approved heading hierarchy—not bold on every table value. No tracked Arabic, all-caps navigation, decorative numbering, or monospace audit prose.

Use tabular numerals where available for comparable dates and durations. Totals use hours and minutes, not decimal hours or oversized “performance” figures. Allow multiline labels and statuses to increase row height.

Retain the 4px spacing scale, 8px working-surface radius, 12px dialog radius, and fully rounded status pills. Maintain 32/24/16px desktop/tablet/mobile page padding and 24–32px section spacing. Controls retain at least 44px height and icon targets at least 44 × 44px. Borders establish layers; shadows are not required for comprehension.

Motion proposal: brief 120–180ms color/opacity feedback for controls; no celebratory approval animation, row flight, parallax, or delayed page reveal. Reduced motion removes nonessential movement and skeleton animation. Motion must never delay a decision or encode status.

## 5. Information architecture and role-specific screens

Navigation follows authenticated capabilities. Resolve capabilities before showing protected labels, counts, records, or actions. No production role switcher. Demo controls, if retained by a future implementation task, belong in an explicitly labelled demo-only reviewer panel.

| Group | Destinations | Visibility |
|---|---|---|
| My work | `الرئيسية / Home`, `طلباتي / My requests`, `سجلات وقتي / My timesheets` | Granted personal capabilities, including managers and HR acting for themselves |
| Review work | `مراجعات الفريق / Team reviews`, with Requests and Timesheets tabs | Explicit review capability; managers see active direct reports only, never their own submissions |
| Organization | Organization requests, Organization timesheets, Employees, Request types, Reports | Each independently granted and supported; no empty placeholder links |
| Updates | `الإشعارات / Notifications` | Authorized recipient scope |
| Account | Profile where supported, Preferences, Sign out | Language and appearance inside Preferences; sign-in also exposes them |

Desktop uses the 248px rail at logical inline-start, compact context bar, and content width up to 1280px. Details use a reading column up to 760px with an optional context column up to 320px when space permits. Below 1024px use the drawer shell. Below 640px use a single-column operational layout. Collapse earlier when available content width or zoom requires it.

### Employee surfaces

- **Home:** returned corrections first; other actionable drafts next; submitted work with its actual stage; current organization week; recent notifications. New request is the header primary action; Open timesheet is secondary. Review previews, when granted, are a separate section, not mixed into personal work.
- **My requests:** title/type, status, next actor or safe stage, submitted date/draft, last update, distinct permitted action. A returned row exposes a concise reason and correction route. Full reasons remain available without hover.
- **Request editor:** one page: type → supplied routing explanation → title/type-defined fields → details → attachments → action summary → save draft/submit. No artificial wizard for a short form.
- **Request detail:** state and next action before the evidence; continuous content, file ledger, then chronological history. Approved/rejected/cancelled records read as records, not disabled forms.
- **My timesheets:** meaningful week intervals, timezone, authoritative state, recorded duration, and permitted action. The weekly editor is a seven-day ledger, not a clock-in tool.

### Manager surfaces

- **Home:** personal work remains intact. A separate direct-report preview links to the exact authorized filtered queue; counts come from that same query.
- **Review queue:** Requests and Timesheets tabs; visible scope, actual sort choice, filters, count, and freshness. Request rows show identity/type, employee, status, submitted date, next stage where known, and review action. Timesheet rows show week, employee, status, duration, submission date where supplied, and review action.
- **Review detail:** inspect full evidence/history before committing. The desktop context column can summarize current state and available decisions; on mobile it becomes an in-flow summary with the final decision region after evidence. No bulk decisions or row-level one-click approval.

### HR surfaces

HR is capability-composed, not “manager plus everything.” Organization visibility may be read-only even when a personal/team review capability exists elsewhere.

- **Organization records:** shared list/detail grammar with an explicit organization scope and no unauthorized decision controls.
- **Employees:** separate identity, reporting line, role/account state, and read-only profile facts. High-impact changes explain the supplied consequences before confirmation; never expose password values or security secrets.
- **Request types:** type identity, active state, approved routing policy, and server-provided in-flight impact. This is configuration, not a drag-and-drop workflow builder.
- **Exceptional actions:** manager substitution and approved-timesheet reopen are dedicated, reasoned, confirmed, audited flows, only where explicitly permitted.
- **Reports:** filter-led workspace showing scope, date interval, timezone, units, applied filters, freshness, totals and table. Apply filters explicitly. CSV export visibly respects the approved 10,000-row bound; narrowing is the recovery when exceeded. Do not claim a file was saved to the device merely because generation or download initiation succeeded.

## 6. Design skill / pattern catalog

This is a design contract catalog, not an instruction to install external skills or create additional files. Each pattern has a trigger, required composition, behavior, and failure mode. Future designers and GPT implementers should reference these stable IDs rather than inventing independent screen styles.

| ID / skill | Use when | Composition and required behavior | Reject |
|---|---|---|---|
| P01 — Capability shell | Entering or changing authenticated context | Neutral loading shell → authorized grouped navigation; drawer focus isolation and focus return; account preferences separated from work | Role switcher as authorization; protected-content flash |
| P02 — Attention-first desk | Opening Home | Returned reason/action → other actionable work → week → updates; counts and links share resolved scope | KPI gallery, fake zero, urgency inferred from age |
| P03 — Query ledger | Comparing requests, weeks, employees, or reviews | Header/scope → supported toolbar → applied filters/count/freshness → semantic table → pagination; URL and back-context preservation | Card wall, dead filters, generic Details duplication |
| P04 — Status/action sentence | Displaying any actionable record | Localized status + identity + permitted next actor/stage + permitted action; explicit read-only/blocking explanation | Pill alone, raw enums, invented approver |
| P05 — Continuous case file | Reading or reviewing a request | Identity/state → content → attachment ledger → append-only timeline → authorized decision region | Equal-weight card fragments; evidence hidden behind a summary |
| P06 — Correction loop | Work is returned | Actual reason above editable fields; retain history; preserve valid input; save and explicit resubmit | Treating return as rejection; erasing previous evidence |
| P07 — Weekly ledger | Recording or reviewing time | Seven Monday–Sunday sections, organization timezone, duration and unpaid-break minutes, separate totals; mobile labelled days | Decimal hours, start/stop timer, productivity ranking |
| P08 — Deliberate decision | Approve, reject, return, cancel, reopen, substitute | No preselection; identity/current state/version context/resulting stage; reason where required; explicit confirmation; block duplicate activation | Optimistic success, instant approval shortcut, automatic retry |
| P09 — Evidence ledger | Attaching or inspecting files | Filename/type/size + upload and scan state + permitted recovery/download; policy from server | Pending/quarantined file appearing ready; pretend upload |
| P10 — Provenance timeline | Explaining what happened | Chronological action, permitted actor, timestamp/timezone, from/to state, reason; latest event anchored without hiding older events | Raw API verbs, editable history, latest-only story |
| P11 — Truthful async surface | Fetching, saving, refreshing, or recovering | Initial skeleton; updating existing data; separate validation/conflict/unknown outcome; persistent acknowledged result | Timer-driven success; stale data presented as fresh |
| P12 — Scoped report | Preparing authorized operational output | Apply filters → scoped result/freshness → bounded export; hours/minutes and request summaries, no inferred performance | Unbounded export, decorative charts, unsupported metrics |
| P13 — Bilingual continuity | Switching language/appearance or rendering mixed content | Independent full-sentence translations; logical layout; isolated identifiers; route/query/draft/focus preserved | Mirrored strings/data arrays; form reset; Latin-only overflow fixes |
| P14 — Quiet update | Reading notifications | Localized event, time, unread label, safe related-record link; mark-read and badge share confirmed state | Confetti, stale badge, link revealing inaccessible records |

A later pattern specimen should document anatomy, permitted capabilities, Arabic/English content, desktop/mobile composition, keyboard path, and applicable state cases. This catalog does not add a production “Design library” navigation item. The employee encounters a coherent tool, not its internal design documentation.

## 7. Critical workflows and component behavior

### Request creation and correction

1. Choose a supported request type. Present its supplied route, including HR-only routing when applicable. Never universally promise manager-first routing.
2. Complete the labelled fields and attachments. A missing/inactive reviewer produces the policy explanation and supported escalation, never a client-selected substitute.
3. Save draft or inspect the submission summary. Submission names the resulting stage without promising approval.
4. While submitting, retain content, show progress, and prevent duplicate activation. Render success only from acknowledgment and show the returned state/history.
5. Returned work reopens permitted fields with the correction reason above them; resubmission follows stored routing policy. Cancellation is shown only if the current authoritative policy permits it. Terminal request records have no reopen action.

### Weekly time entry

Open the actual organization week, not the first sorted record. A missing sheet offers supported creation; a duplicate-week conflict links to the existing sheet while preserving entered values until intentional reconciliation. Enter work-date duration minutes, unpaid-break minutes, and optional description. Preview separate hours/minutes totals; do not silently round or invent break deductions.

Submission explains read-only consequences. Returned sheets expose reason and correction/resubmission; submitted and approved sheets are read-only. Rejection is terminal. A replacement, where supported, is a distinct linked record rather than an edit to the rejected sheet. Approved-sheet reopen is an explicit HR exception with reason and audit, not an employee convenience.

### Review and exceptional decisions

Open a named record from the preserved queue; inspect evidence; choose Approve, Reject, or Return for correction. No decision is preselected. Reject/Return require a visible reason. The confirmation names employee/record, current localized status, relevant version context, chosen decision, and known resulting stage. Manager approval must say Awaiting HR review when HR remains.

On conflict, show/reload authoritative state and require reconsideration; preserve safe authored text without automatically applying it to the newer record. On an unknown timeout, say confirmation was not received and require reconciliation before retry. Never claim either success or definite failure while outcome is unknown. After acknowledged completion, show a persistent result, refresh the exact queue, and restore meaningful focus to the next available record or queue heading if the prior row disappeared.

### Shared component rules

- **Buttons:** one page-header primary action; secondary navigation remains visually quieter. Native links navigate, buttons mutate. Hover, focus-visible, pressed, disabled-with-reason, submitting, and confirmed states are explicit. Unauthorized actions are absent, not gray teasers.
- **Forms:** visible persistent labels, required text/semantics, suitable input modes, linked help/errors, paste allowed. Focus an error summary after failed submission; each error links to its field. Never clear valid fields or interrupt Arabic composition. Warn before abandoning unsaved work, including sign-out.
- **Filters:** only endpoint-supported controls. Applied filters can be removed; Clear all restores the supported baseline. Show actual selected ordering rather than the implementation phrase “deterministic order.” Preserve search, tabs, filters, sort, and pagination in meaningful URL state. Sensitive free-text content must not be copied into URLs.
- **Tables:** named record links, meaningful captions, scoped headers, comparable alignment, localized sort semantics. Use pagination for large sets; virtualization requires separate accessibility proof. Never make a generic row container the sole keyboard interaction.
- **Dialogs/drawers:** labelled modal, focus trap, background inertness, scroll containment, Escape before mutation, and trigger focus restoration. Backdrop dismissal cannot silently discard a reason. At narrow widths use a scrollable panel with all actions reachable above/around the virtual keyboard.
- **Tabs:** semantic Requests/Timesheets tablist, visible active state, keyboard navigation matched to reading direction. Tabs never look like irreversible actions.
- **Feedback:** one useful live announcement per transition, not one per skeleton cell. An inline result or recovery region carries consequential information; a toast only supplements it.

## 8. Operational density and responsive behavior

Premium is not synonymous with spacious cards. Use three task-driven densities without adding an unapproved density preference:

| Surface | Density strategy | Never sacrifice |
|---|---|---|
| Queue/list | Compact aligned rows; 12px block/16px inline cell padding as baseline; metadata grouped below identity only where useful | Status, next stage, named link, readable Arabic, accessible targets |
| Editor/detail | One reading column, 20–24px field gaps, 24–32px sections; optional quiet context column | Correction reason, input labels, evidence, complete history |
| Decision/recovery | Deliberate spacing around identity, consequence, reason, final action | Full consequence and recovery copy at zoom/mobile sizes |

At 320–639px, comparison rows become labelled record blocks with the same critical facts and one clear action. Timesheets become exactly seven labelled day sections; no sideways spreadsheet is required to finish the week. At tablet widths filters wrap or use a named panel. Desktop offers width for comparison, not extra decorative summaries.

Rows and controls grow with content. Long Arabic titles/reasons remain readable; do not depend on tooltips to reveal decision-critical text. A sticky action bar is optional only after proving it does not obscure focused controls, errors, content, or the virtual keyboard at 320px and 200% zoom. Preserve a logical DOM reading order independent of visual columns.

## 9. Arabic RTL / English LTR as equal operating modes

Arabic is the initial locale; System is the default appearance. Support explicit Light/Dark and saved user preferences through the approved persistence contract. A preference is not saved until acknowledged; a stale preference conflict must not silently overwrite a newer choice.

Set document `lang` and `dir`. Use logical spacing, borders, alignment, rail placement, and drawer origin. Mirror directional navigation—not the brand, clock, calendar, paperclip, download, checkmark, numeric axes, or chronology. Do not reverse arrays to create RTL.

Use Noto Sans Arabic for Arabic and Inter for Latin, without forcing Arabic onto Latin line metrics. Isolate names, emails, IDs, URLs, filenames, and mixed content with `bdi` or equivalent; email/ID/numeric controls may retain internal LTR direction while their label/layout remains RTL. Protect the live brand and identifiers from browser translation. Use locale-aware date/number formatting with explicit organization timezone for weeks, reports, and authoritative timestamps. Digit acceptance/normalization follows input/server policy and must not change meaning.

Author full sentences separately in each language. Examples are proposed copy, not evidence of implemented localization:

| Intent | Arabic | English |
|---|---|---|
| Submit request | إرسال الطلب | Submit request |
| Correct returned work | تعديل الطلب وإعادة إرساله | Correct and resubmit request |
| Intermediate approval result | بانتظار مراجعة الموارد البشرية | Awaiting HR review |
| Read-only week | تم إرسال سجل الوقت للمراجعة. لا يمكن تعديله في هذه الحالة. | This timesheet has been submitted for review and cannot be edited in its current state. |
| Unknown decision outcome | لم نتلقَّ تأكيدًا للقرار. حدّث السجل للتحقق من حالته قبل إعادة المحاولة. | Decision confirmation was not received. Refresh the record to check its state before retrying. |
| Empty review queue | لا توجد عناصر بانتظار مراجعتك حاليًا. | Nothing is currently awaiting your review. |

Locale/theme changes must preserve route, active record, filters, typed reason, unsaved entries, and meaningful focus. Test mixed-script names and long filenames in both directions—not merely translated navigation.

## 10. State quality is the premium experience

| State | Required presentation | Recovery / boundary |
|---|---|---|
| Initial loading | Structural skeleton, no invented counts/data; neutral capability shell | One polite announcement |
| Background refresh | Existing authorized content with Updating/freshness context | Do not represent stale content as a newly confirmed result |
| First use | One purposeful explanation and supported creation action | Brand gesture allowed here |
| Filter-empty | Explain no matches and expose Clear filters | Not “you have no requests” |
| No review work | No items currently awaiting this reviewer | Not “everything approved” |
| No access/unavailable | Neutral safe message | No record-existence or storage-detail leak |
| Validation | Focused summary and field-level reasons | Preserve valid input |
| Read-only | State and explicit edit restriction, readable values | Only permitted exceptional actions |
| Conflict | Explain record changed; reconcile latest state | No automatic mutation replay |
| Unknown outcome | Confirmation not received | Refresh/reconcile before retry |
| Attachment pending/quarantined | Explicit scan truth and safe explanation | Only permitted retry/remove/replace/download |
| Session expired | Explain need to sign in again, no submission claim | Protect drafts according to security policy; do not add browser-storage persistence for sensitive content |
| Confirmed success | Persistent returned state and updated provenance | Toast is secondary, queue/badge derive from confirmed source |

## 11. What makes this unlike generic AI SaaS

- Its hero is the next accountable action, not a marketing headline inside an app.
- Its signature is an Arabic wordmark and a single composed-paper gesture, not a gradient orb or sparkle button.
- Its home arranges correction and responsibility, not a grid of invented KPIs.
- Its repeated unit is a request case file or weekly ledger, not a universal rounded card.
- Its manager view separates personal work from review authority; HR visibility is not superuser power.
- Its status language explains intermediate stages, locks, and reasons instead of calling every positive click “Done.”
- Its time totals record duration without moral judgment or surveillance language.
- Its polish includes long Arabic corrections, keyboard focus, safe unknown outcomes, and restored queue context—not just animation.
- Its pattern catalog contains domain-specific contracts and anti-patterns, not an indiscriminate list of fashionable UI components.

## 12. Testable design acceptance and handoff

These are future implementation gates, not tests executed during this documentation task. Preserve the full acceptance matrix in the approved design specification; the gates below sharpen the premium direction.

| Gate | Scenario and observable pass condition |
|---|---|
| G01 — Immediate orientation | On home, a list, and detail, the user can identify record/status, permitted next actor/stage, and available next action without relying on color or opening a tooltip. |
| G02 — Correction clarity | Returned request and week show the actual reason before editable fields; correction/resubmission retains prior history and valid input after server validation errors. |
| G03 — Authority | Test employee, manager, HR visibility-only, and HR exceptional capabilities. Protected data never flashes; personal work cannot appear in self-review; unauthorized actions remain absent on direct URLs and navigation. |
| G04 — Real consequences | A manager approval requiring HR renders Awaiting HR review; submitted timesheets become read-only only after acknowledgment; rejected records cannot be edited as replacements. |
| G05 — Honest latency | Exercise initial loading, refresh, conflict, unknown timeout, and session expiry. No fake zero, timer-based success, lost valid input, or automatic mutation retry appears. |
| G06 — Query continuity | Apply supported filters/sort/tab/page, open a record, and return. Query and meaningful focus restore; visible counts and exports match the same authorized scope. |
| G07 — Bilingual continuity | Enter an Arabic reason with mixed Latin ID/filename, switch Arabic/English and Light/Dark/System. Content, route, filters, record, and focus remain meaningful; no glyph clipping or reordered identifiers. |
| G08 — Responsive work | Complete request submission, seven-day entry, review decision, and recovery at 320px, 390px, tablet, desktop, and desktop 200% zoom in both directions. No page-level horizontal scroll or hidden final action. |
| G09 — Accessible interaction | Keyboard-only journeys finish; modal/drawer focus is trapped/restored; screen readers in Arabic and English announce labels, table relationships, statuses, errors, and results. Test text spacing, reduced motion, and forced colors. |
| G10 — Measured contrast | Verify actual text pairings against WCAG AA (4.5:1 normal text, 3:1 qualifying large text) and meaningful controls/focus against applicable 3:1 requirements. Measure derived washes and dark/native states, not only primitive colors. |
| G11 — Evidence safety | Exercise upload/pending/clean/quarantined states; unavailable private downloads remain safe; chronology preserves reasons and localized state transitions. |
| G12 — Visual restraint | Audit representative pages with shadows/animation removed. Hierarchy survives; only approved primitives/typography/shapes remain; no KPI gallery, emoji icons, all-caps/letterspaced Arabic, or decorative card repetition. |

### Decisions, assumptions, and open approvals

- Recommended visual decision: refine the existing operational desk; retain the six-token palette, typography, clipboard gesture, and capability IA rather than introducing a second theme.
- Interpretation requiring user ratification: “design-skills-library-style” means pattern-led craftsmanship, not an employee-facing pattern marketplace. This document does not scope that marketplace.
- Proposed refinement requiring design approval: the short motion timing and new bilingual example copy. Neither changes business policy.
- Business-rule boundary: no new rule is approved here. If requirements and actual API behavior disagree on cancellation eligibility, routing, substitution, reopen, break arithmetic, or attachment policy, obtain explicit owner approval and architecture/security reconciliation before implementation; do not solve it with UX inference.
- Implementation assumption: current inspected frontend remains a mock-driven demo. Route presence and token alignment do not establish real authentication, capability enforcement, mutation truth, rendered accessibility, or backend integration.
- Evidence limitation: this pass performed document/source research and fetched reference text. It did not run the app, validate screenshots, measure contrast, or retest historical review findings.

### Next handoff

Objective: approve this premium refinement, then realize it without weakening the existing operational contract.

Artifact: `docs/design/premium-design-direction.md` only.

Next owners after approval: UX/brand validates representative employee correction, weekly ledger, manager review, and HR read-only/exception compositions in Arabic and English; architecture/security confirms supported capabilities and unresolved policy boundaries; frontend implements shared patterns under a separate authorized task; QA verifies the full state/direction/theme/viewport matrix with actual rendered evidence. Keep every subsequent lane GPT-only under the current team constraint.

No implementation, additional artifact, board decomposition, or commit is authorized by this document.
