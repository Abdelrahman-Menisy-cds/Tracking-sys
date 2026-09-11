---
title: "هي فوضى؟ / Heya Fawda? — UX and Brand Direction"
status: approved-baseline-with-open-policy-decisions
owner: ux_brand_designer
workflow: BMAD BMM
scope: design-only; no application implementation authorization
---

# UX and brand solutioning

## 1. Authority, objective and evidence

Design an Arabic-first employee operations workspace where every person can answer: What needs my attention? What is its status? Who acts next? Preserve professional, auditable decisions while letting the identity provide restrained Egyptian situational comedy.

Read sources:
- [C] `docs/PROJECT_CONTEXT.md` — product identity, project separation, implementation gate.
- [K] `specs/constitution.md` §§3–8 — server authority, histories, time integrity, accessibility, appearance.
- [P] `.hermes/plans/2026-09-10_021026-employee-operations-blueprint.md` §§1,4,5,9 — locked identity, scope, workflows, unresolved policies.
- [B] `_bmad-output/planning-artifacts/briefs/brief-tracking_system_project-2026-09-11/brief.md` — actors, journeys, MVP, assumptions A1–A7.
- [T] `/home/menisy/.hermes/profiles/ux_brand_designer/TEAM_RULES.md` — planning gates and handoff discipline. No repository-root TEAM_RULES.md was found.

The user authorized this solutioning artifact. The brief and constitution still label themselves draft; this document does not retroactively approve them. All design prescriptions below are proposed UX requirements, not new business authority. `[ASSUMPTION]` flags unresolved policy or a choice requiring confirmation. Accepted requirements must be reconciled into `specs/` by Product Lead before implementation.

OBSERVATION: Source approval labels remain draft despite the request to continue an approved workflow → Product Lead should reconcile approval evidence and labels before implementation; no shared source or rule has been silently edited.

Non-goals: payroll, surveillance scores, leave balances, biometric attendance, generic workflow configuration, native apps, AI assistant, email/SMS delivery and advanced analytics. No application code, final logo artwork, usability research, browser test pass or deployment is claimed.

## 2. Experience principles

1. Arabic is the starting experience, not translated decoration. Natural Arabic labels, intact letter shaping and complete task parity reduce comprehension effort.
2. Show status, next actor and available next action together. A green manager decision must not imply final approval when HR review remains.
3. Separate personal work from reviewing others. HR visibility is not blanket permission to edit or approve.
4. Use plain professional language for permissions, reports, approvals and failures. Never joke about salary, lateness, rejection, performance or a person's ability.
5. Prefer recoverable work to surprising convenience. Explicit save/submit, preserved unsaved form state and conflict feedback take precedence over speculative autosave.
6. Show recorded hours, not inferred productivity. No invented targets, entitlement balances, overdue labels or deadline countdowns.

## 3. Information architecture and navigation

### Shared shell

Desktop: navigation rail at logical inline-start (right in Arabic, left in English), header with current section, notifications, language control and account menu; main region contains page title, scope subtitle, primary action, filters and content. Include skip-to-main link, one page H1, breadcrumb on nested details and a visible current-page navigation state with `aria-current`.

Use `العربية` and `English` as language choices, never flags. Account menu contains `الملف الشخصي / Profile`, `المظهر / Appearance`, `تسجيل الخروج / Sign out`. Appearance choices are `النظام / System`, `فاتح / Light`, `داكن / Dark`. Notifications remain a real page as well as a header entry; do not make a transient popover the only access route.

Navigation is capability-scoped, not a user-selectable role simulator. Display actual current scope; changing a view never changes authority. All roles retain self-service. Do not expose inaccessible route names, employee counts or export controls while permissions load.

| Area | Arabic / English | Employee | Manager | HR |
|---|---|---|---|---|
| Home | الرئيسية / Home | Own summaries | Own summaries + team review summary | Own summaries + organization summary |
| Personal requests | طلباتي / My requests | Own | Own | Own |
| Personal time | سجلات وقتي / My timesheets | Own | Own | Own |
| Review work | مراجعات الفريق / Team reviews | Hidden | Scoped requests + timesheets | Only if capability granted; not inferred from role |
| Organization requests | طلبات المؤسسة / Organization requests | Hidden | Hidden | Organization visibility; actions separately gated |
| Organization time | سجلات وقت المؤسسة / Organization timesheets | Hidden | Hidden | Organization visibility; actions separately gated |
| Employees | الموظفون / Employees | Hidden | Hidden | Employee administration/reporting lines |
| Request types | أنواع الطلبات / Request types | Hidden | Hidden | Approved configuration capabilities |
| Reports | التقارير / Reports | Hidden | Team scope | Organization scope |
| Notifications | الإشعارات / Notifications | Own | Own | Own |

[ASSUMPTION UX-01; B A2] Manager scope is direct reports only. Multi-role assignments, inherited HR team-review permissions and hierarchy expansion require Product Lead + architect_security approval. Do not add a role switcher or organization switcher.

Lists share search, permitted filters, sort with announced direction, result count and pagination. Counts derive from the same authorized query as rows. Keep applied filters visible as removable chips; label date ranges and active scope. Preserve non-sensitive filters when returning from details; never put sensitive request text in URLs. A row has a named link, not an invisible click-only surface. No bulk approval in this direction.

## 4. Arabic, English and bidirectional behavior

- Set document language and direction for the selected locale (`ar`/RTL, `en`/LTR). Translate navigation, validation, dates, statuses, assistive names, notifications, export controls and permission messages—not only headings. User-authored content is not auto-translated.
- [ASSUMPTION UX-02] First visit defaults to Arabic; retain an explicit locale selection for signed-in users server-side, with an account-scoped local preference for bootstrap. Anonymous locale preference may be local. Confirm persistence contract with architecture; theme persistence is mandatory independently.
- Switching language preserves route, filters, record and unsaved edits, without resubmitting or altering stored values. Move neither focus nor scroll unnecessarily; announce the change in the new language. Authored bilingual request-type names need a Product Lead content policy, not automatic machine translation.
- Use logical start/end spacing and alignment. Mirror navigation rail, breadcrumbs, directional arrows and step progression; do not mirror logos, clocks, checkmarks, attachment icons, charts' numeric axes or media controls. Temporal axes keep chronological meaning, with explicit labels.
- DOM/reading/focus order follows semantic task order in each layout. Do not reverse arrays or use visual CSS ordering to fake RTL. Forms begin at inline-start; decision actions follow their text in reading order.
- Isolate emails, IDs, filenames, URLs and mixed-language fragments with bidirectional isolation. Email/ID/time-format fields use LTR internal direction with Arabic labels outside; names and free text use content-aware direction. Never concatenate untranslated fragments into sentences. Preserve Arabic question mark in `هي فوضى؟` and Latin question mark in `Heya Fawda?`.
- [ASSUMPTION UX-03] Gregorian calendar, Arabic locale formatting and locale-appropriate display digits are proposed; calendar/digit preference needs confirmation. Accept Arabic-Indic and Latin numeric input without changing value, and normalize consistently through the approved validation contract. Avoid ambiguous numeric-only dates. Always name month and show year where ambiguity matters.
- Week start, timezone, rounding and overnight rules remain B A5. Show the authoritative timezone beside entry context and in report metadata once agreed; do not derive it silently from browser location. Audit timestamps include date, time and timezone, with localized display over an unchanged instant.
- Render durations as hours and minutes, not decimal arithmetic that could confuse 1.5 hours with 1 hour 50 minutes. Canonical storage remains minutes. Do not invent break deductions.
- No fixed-height Arabic text containers, letter spacing across Arabic connected letters, forced uppercase or truncation of critical statuses/reasons. Full text remains available for truncated secondary names via keyboard and touch, not hover only.

## 5. Core screens and journeys

Every screen below inherits the complete state contract in §6; screen-specific behavior supplements, never replaces it.

### S01 Sign-in and session recovery

Single-column form: brand + Employee Operations descriptor, language and appearance controls, identifier, password, password visibility toggle and `تسجيل الدخول / Sign in`. Identifier type follows the approved authentication contract. Allow paste and password managers; label controls explicitly. No invented registration, SSO or password-reset route. Generic credential error avoids account enumeration; inactive-account wording/contact follows security policy. On session expiry, stop pending mutations, explain sign-in is required, and return to a safe authorized destination after authentication. Preserve sensitive unsaved data in memory only where safe, not browser storage; warn when recovery cannot be guaranteed.

### S02 Role-scoped home

Employee: own pending/returned requests, current weekly timesheet status and recent notifications; primary actions `طلب جديد / New request` and `فتح سجل الوقت / Open timesheet`. Manager: separate personal section and direct-report review queue with request/time tabs. HR: clearly marked organization summaries and links to administration and authorized reviews. Cards show counts/status with data freshness and named destinations; no fabricated zeroes while loading. Do not turn hours into productivity rankings. Return reasons receive useful prominence without alarming decorative animation.

### S03 My requests and request editor

List fields: request title/type, status, submitted date, responsible reviewer where permitted, last update and details link. Editor order: active request type, title, details, type-defined approved fields, attachments, save draft and submit. Show required markers in text and explain attachment constraints from server policy before file selection. File rows show name, upload progress, status and permitted remove/retry action. No invented file types or limits. Submission is unavailable while required uploads are incomplete; explain why in persistent helper text.

Draft saving is explicit; do not label work saved until server confirmation. On submit, summarize the request and next review stage from server state; not a guessed workflow. Unsaved-navigation prompt offers stay or discard; no silent deletion. Returned record shows the correction reason above editable fields and preserves its history. No edit, attachment replacement, cancel-after-submit or reopen action unless expressly authorized by policy/capabilities.

### S04 Request detail and review decision

Header: title, identifier, status label + icon, requester where permitted, current responsible reviewer and next step. Body: details, permitted attachments, append-only history. Timeline entries show actor, action, timestamp, transition and comment; distinguish current state from past events.

Reviewer sees a separate decision region only when authorized: `اعتماد / Approve`, `رفض / Reject`, `إعادة للتعديل / Return for correction`. Open a named confirmation dialog containing person/record, current state, decision and comment; reject/return requires a visible reason field. Never preselect an adverse decision. Focus the dialog heading/first meaningful field, trap focus, allow Escape before submission, return focus to trigger. Require explicit final action; disable duplicate activation while processing. Success uses returned state: `تم إرسال الطلب إلى الموارد البشرية / Request sent to HR` is not `تم اعتماد الطلب / Request approved`.

[ASSUMPTION UX-04; B A3–A4] Manager-first conditional-HR routing and no post-submission cancellation remain provisional. Missing/changed/inactive manager, self-approval, substitute reviewer and reassignment cannot be solved with a UI override. Show a neutral policy-provided blocking reason and approved support route, not an invented recipient. Concurrent review conflict reloads latest authoritative state without replaying the attempted decision.

### S05 My timesheets and weekly editor

List by labeled week interval and status. Week detail: authoritative timezone, state, total recorded duration, correction reason if returned, daily groups and audit history. Entry fields are work date, approved time input mode, duration/start/end as applicable and description. Provide a single coherent input mode; do not solicit inconsistent start/end plus independently editable duration. Add/edit entry in a labeled form, not spreadsheet-only interaction. Daily and weekly totals recalculate for feedback but server validation governs submission.

Desktop: daily rows/table with accessible headers. Mobile: day sections with entry cards and edit buttons; maintain totals and save/submit actions in normal reading order. Submitted/approved states show a persistent read-only explanation rather than disabled-looking editable controls. Returned work is editable under policy. Submit confirmation names the week and explains it becomes read-only; success is only shown after confirmation from server. Duplicate week creation navigates to the existing authorized sheet rather than offering another container.

[ASSUMPTION UX-05; B A4–A5] Design approve/return only for timesheet review. Terminal rejection conflicts with the older scope list and needs Product Lead resolution. No reopen button or invented maximum, workweek start, break rule, overnight rule or rounding increment. Validation must explain specific approved date/overlap/timezone rules and highlight affected entries after contracts are settled.

### S06 Manager review queue and timesheet review

Request/time tabs, scope subtitle, permitted employee/date/status filters and stable sort/pagination. Detail includes employee, week/date range, daily entries, totals and history. A queue link returning from a decision retains prior filters and focus context. Approve and return use the same explicit confirmation and reason contract as S04; no generic request-rejection action reused for timesheets. Empty pending queue is not an assertion that all team work is approved. No self-review affordance inferred from being a manager.

### S07 HR employees and reporting lines

Directory: permitted employee identifier/name, department, job title, manager, role and account status; named details link. Details group identity, reporting line and access administration separately from the person's own profile. Employee create/edit uses only agreed fields and server-filtered manager choices. Server errors for self-management/cycles map to manager field plus error summary. Role/account changes show before/after values in a professional confirmation; no optimistic permission changes. Inactive state uses text, not fading alone.

[ASSUMPTION UX-06; B A2,A6] Exact editable own-profile/admin fields, account activation consequences, HR self-administration and role changes require approved authority matrix. No delete-account, impersonation or employee-record override controls are introduced. Do not promise that changing manager reassigns submitted work.

### S08 HR request types

List name, active status and approved review policy; form has bilingual name/description fields if adopted, active setting and HR-review setting only where permitted by the finalized model. Explain visibility impact using approved policy. Save displays authoritative values. Do not expose a workflow builder, assumed immediate changes to in-flight records, or hard deletion.

[ASSUMPTION UX-07; B A3] Required bilingual naming and behavior of policy edits for existing requests need Product Lead approval. In-flight impact must be stated before a review-policy change can ship.

### S09 Reports

Manager team scope / HR organization scope displayed beside report title. Choose request summary or recorded-hours summary; permitted date, employee, type and status filters, as applicable. Explicit `تطبيق الفلاتر / Apply filters` updates table, totals and scope summary together. Preserve previous results with a visible stale/updating label during refresh; do not combine new filters with apparently current old totals. Export CSV uses the exact authorized applied filters and labels, not unsaved filter inputs. Show timezone/date interval, applied scope and generation context; protect sensitive report content.

Empty result: `لا توجد نتائج لهذه الفلاتر / No results for these filters` and reset action. Export pending prevents duplicate requests; denial/error gives no download-success claim. Successful download initiation is not proof a file was saved to disk. Accessible table accompanies any later chart. No rankings, payroll values or invented overtime metrics.

[ASSUMPTION UX-08] CSV header language, encoding, duration representation and timestamp convention need Product Lead + architecture contract; propose UTF-8 with Arabic/English-friendly spreadsheet behavior and explicit units, subject to QA/security review. Server must address CSV formula injection. Export remains server-authorized after permission changes.

### S10 Notifications, profile and preferences

Notifications: read/unread label, concise event, timestamp and authorized detail link; unread is not color-only. If target is unavailable, use safe access messaging without leaking hidden details. Mark-read failure leaves/reverts unread state with retry. No email/SMS promises. Profile distinguishes editable approved fields from authoritative read-only organizational fields. Preferences show selected locale/appearance and pending/save/error status. Successful field saves are announced without moving focus. Sign out clears user-scoped in-memory data and prevents another account seeing the previous person's lists or preferences.

## 6. Complete state and interaction contract

### Global contract: applies to S01–S10

| State | Required presentation and recovery |
|---|---|
| Loading | Skeleton matches stable layout; a single localized status announcement and busy region; never show fake zero totals or records. Preserve completed user input. During background fetch, keep prior content explicitly marked updating; record decisions require current authority. |
| Empty | Distinguish first-use, zero matching filters, no pending work and no access. Offer a permitted first action, clear filters or safe back navigation. Never suggest creating another person's record. |
| Error | Separate network/server failure, expired session, safe forbidden/not-found response and conflict. Keep input in memory, provide named retry where safe, and show a non-sensitive reference if supplied. No raw exceptions or automatic mutation replay. |
| Validation | Persistent field label/help, localized inline issue linked to field, invalid state and focusable error summary linking to fields. Validate on blur/submit without interrupting composition; show server errors too. Do not clear correct values. Reject/return reason is required. |
| Disabled | Visible reason adjacent to unavailable permitted actions, not a tooltip-only explanation. Unauthorized actions absent; read-only records have a readable explanation. Pending mutation disables repeat actions and announces progress. Never use disabled Save as the sole way to discover missing fields. |
| Success | Only after server acknowledgement; inline confirmation or polite status + visible authoritative state/history. Do not rely on auto-disappearing toast; no optimistic approvals or invented saved status. |
| Keyboard | Native links/buttons/inputs, semantic labels, logical Tab/Shift+Tab order, Enter submits only intended forms, Escape closes dismissible overlays before mutation. Focus survives refresh and returns from dialogs; removed rows move focus to the next sensible item. No keyboard-only hidden features. |
| Mobile | Single-column content, labeled menu drawer and full-width forms; large touch actions, no hover dependencies or gesture-only controls. Keyboard must not hide active field, error or submit action. |
| RTL | Logical layout and correct mixed-script isolation, locale-complete messages and predictable focus order. Arabic text wraps without clipping; semantic status/action order remains intact. |

### Screen-specific acceptance overlays

L=loading; E=empty; F=failure; V=validation; D=disabled/read-only; S=success. Keyboard/mobile/RTL requirements in §§4,6,7 apply to every row.

| Screens | L / E | F / V | D / S |
|---|---|---|---|
| S01 | Authenticating, no duplicate submit / blank labeled form, no irrelevant empty illustration | Generic credentials/network, session recovery / required identifier/password | Pending submit / authorized destination after actual session confirmation |
| S02 | Scope-safe summary skeleton / no own activity or pending review with truthful action | Independent widget retry, never zero-on-error / malformed filter message if relevant | Unavailable permission-dependent actions absent / refreshed summaries announced |
| S03 | List/editor/type loading and upload progress / first request vs filtered zero vs no active types | Draft/upload save failure preserves text; submit outcome unknown is explicit / fields + file policy | Upload/policy blocking reason / saved draft or submitted state + next actor |
| S04 | Detail/history and decision progress / no attachments; history not yet available differs from failure | Safe inaccessible record, stale transition conflict / required reject-return reason | No decision for read-only or non-reviewer / resulting state and new event |
| S05 | Week/entries fetch / no sheet vs empty draft vs no filtered weeks | Save failure, duplicate week, overlap conflict / approved date-duration rules | Submitted/approved read-only / saved entry, confirmed submission or returned correction saved |
| S06 | Queue/detail fetch / no pending vs no filtered results | Decision failure retains comment; stale review reload / return reason | Action unavailable after another review / updated queue and record state |
| S07 | Directory/detail/options / no matches vs no employees | Save conflict or revoked administration / required fields, manager cycle and approved field constraints | Immutable/uneditable fields explained / authoritative employee/access values |
| S08 | Types/detail fetch / no active types vs no types | Save conflict; policy no longer permitted / approved names/config constraints | Editing pending/inaccessible policy / saved type and explicit impact from contract |
| S09 | Report/export progress / zero filtered results, no invented zero before fetch | Fetch/export failure or revoked scope / invalid interval/filter | Duplicate export prevented / updated report or download initiated, not disk-save claim |
| S10 | Notification/profile/preference bootstrap / no notifications or missing optional profile value | Read/save failure with retry or revert / permitted profile-field errors | Noneditable profile facts, pending save / confirmed read/profile/preference state |

For uncertain mutation outcomes after timeout: say `تعذّر تأكيد تنفيذ الإجراء. حدّث الحالة قبل المحاولة مرة أخرى. / We could not confirm the action. Refresh its status before trying again.` Reconcile server state before offering resubmission; do not translate a timeout into confirmed failure or success.

## 7. Accessibility and responsive requirements

Target WCAG 2.2 AA across Arabic/English and both resolved themes; this is an acceptance target, not a compliance claim.

- Text contrast: at least 4.5:1 for normal text, 3:1 for qualifying large text; essential boundaries, icons and focus indication at least 3:1 against adjacent colors. Status always has text/icon alongside color. Validate actual combinations and overlays, including disabled text for practical readability.
- Persistent, clearly visible focus ring; focus never obscured by drawers, sticky controls or virtual keyboard. Use a two-layer ring where needed to separate from colored buttons. No positive tabindex, click-only divs or shortcuts that capture typing.
- Landmark navigation, meaningful headings, form labels/help associations, accessible required/error states, table captions and scoped headers. Announce errors assertively only when necessary; use polite live regions for saves/loading. Avoid repeated announcements from every skeleton cell.
- Touch target design target 44 by 44 CSS px, with adequate separation. Meaning cannot rely on hover, motion, position or color. Attachments need named download/remove actions and readable type/size if supplied.
- Reflow at 320 CSS px and text zoom to 200%; test 400% browser zoom for equivalent narrow reflow. Page must not horizontally scroll except genuinely two-dimensional table regions, which have labels and keyboard access. Prefer mobile cards with explicit field labels for operational lists.
- Proposed layout breakpoints: below 640 px single column + modal navigation drawer; 640–1023 px compact header/drawer and adaptive two-column summaries; 1024 px and above persistent rail. Breakpoints respond to content, not device detection. Proposed max content width 1280 px; long forms max 720 px. Test long Arabic strings rather than shrinking type to fit.
- Drawer opens from inline-start, traps focus while modal, has named close control, Escape support and returns focus to menu trigger. Mobile decision dialog becomes a scrollable full-width panel with visible title and accessible actions.
- Respect reduced motion; no essential animation. Optional decorative movement is brief and disabled under reduced-motion preference. Ensure Windows/high-contrast forced-colors mode keeps boundaries, focus and statuses recognizable. Honor browser zoom and text spacing without clipping.
- Date/time inputs must support typed keyboard entry with format help; any picker is an enhancement with full keyboard navigation, not the only input route. Chart data, if later added, has equivalent table/text.
- Test real Arabic speech output and English screen readers, not only automated accessibility scanning. Verify AR/EN filenames, IDs, mixed names and punctuation with keyboard and touch.

## 8. Design system and appearance

### Typography, geometry and density

[ASSUMPTION UX-09] Proposed font pairing: Noto Sans Arabic for Arabic and Inter for Latin, with system sans-serif fallbacks. Verify distributable font licenses and self-hosting with frontend/security before bundling. Wordmark artwork is separate from body typography and must not break Arabic letterforms.

Proposed scale: body 16 px with 1.6 Arabic / 1.5 Latin line-height; helper 14 px with generous line-height; page title 28 px, section title 20 px. Do not squeeze Arabic to Latin metrics. Spacing tokens: 4, 8, 12, 16, 24, 32, 48 px; control min-height 44 px; card radius 12 px, control radius 8 px, status-pill radius fully rounded. Use borders as primary separation; restrained shadows are supplemental only. Tables prioritize scanability over compactness; never lower body size to fit more records.

### Proposed semantic color tokens

System is not a third palette: it resolves to Light or Dark. These are candidate solid-color tokens, not yet contrast-certified. Use semantic roles rather than raw brand colors in screens. Avoid opacity-derived text colors and untested gradients behind content.

| Token | Light | Dark | Usage |
|---|---|---|---|
| canvas | #F8FAFC | #0F172A | Page background |
| surface | #FFFFFF | #1E293B | Cards, dialog, controls |
| surface-subtle | #F1F5F9 | #334155 | Grouping and read-only panels |
| text | #0F172A | #F8FAFC | Primary text |
| text-muted | #475569 | #CBD5E1 | Supporting text, not low-opacity |
| border-control | #64748B | #94A3B8 | Essential control boundary |
| primary | #0F766E | #5EEAD4 | Primary action fill; link text on surface |
| on-primary | #FFFFFF | #0F172A | Primary button text/icon |
| secondary | #6D28D9 | #C4B5FD | Secondary brand accent on surface |
| focus | #1D4ED8 | #FDE047 | Outer focus ring, separated from control |
| success-text | #166534 | #86EFAC | Approved/success label |
| success-bg | #DCFCE7 | #14532D | Success container |
| warning-text | #92400E | #FDE68A | Returned/attention label with explicit wording |
| warning-bg | #FEF3C7 | #78350F | Attention container |
| error-text | #B91C1C | #FCA5A5 | Error/rejection label |
| error-bg | #FEE2E2 | #7F1D1D | Error container |
| info-text | #1E40AF | #93C5FD | Submitted/pending label |
| info-bg | #DBEAFE | #1E3A8A | Information container |

Status mapping: draft/cancelled neutral text + explicit label; pending-manager and pending-HR use information pair with different words; approved success; returned warning; rejected error. Timesheet submitted uses information. Returned is not visually treated as terminal rejection. Disabled controls use readable muted text on subtle surface plus explanation; no arbitrary opacity reduction. Hover/pressed states preserve tested fill/text and add outline/inset indicator rather than introducing untested darker/lighter fills. Selected navigation uses information pair plus persistent edge marker and current-page semantics. Destructive filled buttons, if required, need a separately validated on-error pair; do not assume status-text colors can serve every button role.

[ASSUMPTION UX-10] Palette, typography and density await design review. Intended contrast checks: text and muted text on canvas/surface/subtle; primary and secondary on surface; on-primary on primary; each status-text on its matching status-bg; border/focus against every adjacent surface; hover, selection, validation and disabled states. Automated contrast calculation was attempted using execute_code and Python through terminal; both were blocked by single-query execution approval policy. No numeric contrast ratios or pass claim are supplied. Palette approval and implementation remain gated on an actual calculator/tool run and visual/assistive validation; no approval settings were changed to bypass this block.

### Theme selection, persistence and first paint

Mandatory from K §8: preference enum is `system`, `light`, `dark`; default is `system`; explicit signed-in preference persists server-side; resolved appearance applies before main UI renders.

Proposed behavioral contract for architect_security/frontend:
1. Keep selected preference separate from effective theme. System follows OS `prefers-color-scheme`; OS changes update effective appearance only while selected preference is System. Explicit Light/Dark ignores OS changes.
2. Authentication bootstrap supplies saved preference before any personalized main UI is revealed. Never render a Light dashboard then repaint Dark. A neutral themed loading shell may use a trusted account-scoped cached hint, but no personalized shell is shown until authoritative preference is resolved.
3. [ASSUMPTION UX-11] Use a minimal account-scoped local cache as a bootstrap hint, not authority or authentication storage. Server preference wins if different. Architecture must settle bootstrap delivery, cache isolation and failure fallback. No JWT, session token, profile data or form content in preference storage.
4. User selection previews immediately and announces `جارٍ حفظ المظهر / Saving appearance`. Only server acknowledgement marks it saved and updates authoritative cache. Failure preserves the session preview with `لم يُحفظ هذا الاختيار. أعد المحاولة. / This choice was not saved. Retry.` Do not claim cross-device persistence. Superseded responses must not overwrite a newer selection.
5. Returning to System persists `system`, not its current Light/Dark resolution. Returning visits and sign-in on another device use server preference. Do not promise live cross-device synchronization; refresh/session bootstrap must reflect saved choice.
6. [ASSUMPTION UX-12] Anonymous choice is device-local; a returning signed-in preference outranks anonymous choice. Sign-out removes account-scoped hints and personalized state, then resolves the anonymous preference or System. Confirm policy with architecture to prevent shared-device preference leakage.
7. If OS preference is unavailable, propose Light fallback for System; if signed-in preference fetch fails with no trusted hint, hold main UI behind a recoverable bootstrap error rather than falsely treating Light as the saved choice. No indefinite spinner. Storage-disabled behavior uses server preference without local cache and explains any anonymous non-persistence.
8. Theme switch preserves focus, scroll, unsaved fields and status semantics; no page reload or form submission. Browser/native controls and overlays use the resolved theme too. Transition animation is optional and absent under reduced motion.

## 9. Bilingual voice and content

Core interaction copy is plain, professional Arabic with complete English equivalence. Egyptian colloquial flavor is reserved for optional mascot moments; humor never replaces the real explanation or CTA.

| Context | Arabic | English |
|---|---|---|
| Draft save | حفظ المسودة | Save draft |
| Submit request | إرسال الطلب | Submit request |
| Pending manager | بانتظار مراجعة المدير | Awaiting manager review |
| Pending HR | بانتظار مراجعة الموارد البشرية | Awaiting HR review |
| Return | إعادة للتعديل | Return for correction |
| Reason validation | اكتب سبب الإعادة للتعديل. | Enter a reason for returning this for correction. |
| Submission success | تم إرسال الطلب. | Request submitted. |
| Read-only timesheet | هذا السجل مُرسل للمراجعة ولا يمكن تعديله حاليًا. | This timesheet is submitted for review and cannot currently be edited. |
| Safe unavailable | هذا المحتوى غير متاح لك. | This content is not available to you. |
| Filter empty | لا توجد نتائج لهذه الفلاتر. | No results for these filters. |
| Retry | إعادة المحاولة | Retry |
| First-use mascot aside | نرتّبها واحدة واحدة. | One thing at a time. |
| Neutral first-use explanation | لا توجد طلبات بعد. يمكنك إنشاء طلب جديد. | No requests yet. You can create a new request. |

[ASSUMPTION UX-13] Tagline `من الفوضى إلى النظام` / `From chaos to clarity` remains a recommendation, not locked copy. Descriptor is `Employee Operations`; proposed Arabic descriptor `شؤون الموظفين` requires Product Lead review because it may suggest broader HR scope than the MVP. Never literally translate the brand name.

## 10. Original logo and mascot directions

Creative constraint: start with the small comic moment of paperwork finally becoming orderly; subtract human celebrity cues. The comedy comes from timing, expressive stationery and familiar office rhythm, not imitation. Three conceptual directions follow; these are art directions, not finished vector assets or cleared trademarks.

### A. The composed clipboard — recommended

Pitch: an original rounded clipboard initially surrounded by two wandering note slips; its clip reads as a subtly raised eyebrow, and the slips settle into neat rows. The joke is the object's mild surprise at becoming organized, not a distressed employee caricature.

Logo: Arabic wordmark `هي فوضى؟` with a friendly but legible custom rhythm; a separate geometric clipboard icon with three orderly marks. Latin companion `Heya Fawda?` uses a similarly open, rounded construction without forcing Arabic into Latin geometry. Teal carries competence; a violet note adds controlled mischief.

Mascot: a small nonhuman paper companion with abstract eyes, no face modeled on a person, costume, moustache or recognizable cinematic pose. Use in first-use onboarding and optional empty states; approval dialogs and reports use the plain mark only. Strong fit with requests and histories, but keep the clipboard visibly distinct from a medical record app.

### B. The tidy paper shuffle

Pitch: three loose rectangular slips resolve into one aligned stack. A small offset top corner supplies comic hesitation—one last piece finds its place.

Logo: abstract paper-stack icon beside the full unaltered names, with no face in the primary mark. Teal and neutral strokes dominate; a violet corner is decorative. The mascot is an expressive folded slip that can peek from an empty-state illustration without covering content. This direction is quieter and more institutional; it works well on dense HR screens and in one color.

Risk: generic document-tool appearance. Distinguish through original proportions, negative space and bilingual wordmark craft, not by borrowing a movie poster's typography.

### C. The question finds its place

Pitch: an original curved ribbon inspired by a question mark settles above a small square dot, which doubles as an orderly record card. The visual punchline is uncertainty becoming a clearly assigned item.

Logo: abstract question/card symbol alongside the exact wordmark; the Arabic `؟` and Latin `?` remain correctly drawn in their respective lockups. Do not mechanically mirror one typographic question mark into the other. Teal with a restrained warm accent in illustrations only; UI continues using validated semantic tokens.

Mascot: the ribbon bends inquisitively around a card, never impersonating a person. Most ownable conceptual link to the name, but must avoid looking like help/support or a question-only button. Keep the full wordmark on primary navigation/login; reserve the symbol for known brand contexts.

### Shared identity constraints and proposed production brief

- [ASSUMPTION UX-14] Select A unless stakeholder review favors the quieter B or abstract C. Do not finalize artwork without a direction decision, Arabic typography review and similarity/trademark review. Original intent is not proof of legal clearance.
- No film title treatments, poster layout imitation, actor likeness, character costume, catchphrases, stills, soundtrack references or identifiable performance gestures. Egyptian inspiration is everyday situational wit and conversational rhythm, not a specific entertainment property.
- Provide separate Arabic-primary and Latin-primary horizontal lockups, stacked bilingual lockup, standalone icon, one-color versions and light/dark assets. Do not cram both names into a tiny favicon. Wordmarks are not mirrored by page direction.
- Proposed clear space: one icon-dot/clip unit around each lockup. Validate minimum sizes through actual rendering; inspect icon at 16/24/32 px and wordmark at compact header widths. Remove mascot facial detail at small sizes; full name remains accessible as live text or meaningful image alternative.
- Mascot is decorative with empty alternative text when adjacent text already conveys meaning. A brand link's accessible name is the localized brand name plus Home where appropriate, not a visual anatomy description.
- Keep illustrations outside dense tables and serious decisions. No motion that suggests a record is approved before server acknowledgement. Reduced motion uses a still illustration. Do not use mascot emotion to shame a person after rejection or validation failure.
- Required later deliverables: reviewed SVG wordmarks/icons, PNG previews, monochrome and theme variants, font/license records, clear-space/min-size proof sheet, bilingual voice sheet and tested color-pair report. This artifact deliberately produces directions, not production art.

## 11. Unresolved decisions and owner handoff

| Decision | Dependency / provisional stance | Owner |
|---|---|---|
| Source approval and UX acceptance | Draft labels remain; this artifact authorizes no implementation | product_lead + user |
| Reviewer scope and HR authority | UX-01/04/06; B A2–A3; direct reports proposed, no override/self-approval assumed | product_lead + architect_security |
| Request transition/cancel/reassign rules | UX-04; B A3–A4; only granted actions exposed | product_lead |
| Timesheet terminal rejection/reopen | UX-05; B A4; approve/return proposed, no reopen | product_lead |
| Complete time policy | UX-03/05; B A5; timezone/week/breaks/overnight/rounding/limits unresolved | product_lead + architect_security |
| Attachments and editable employee data | B A6, UX-06; no invented limits or edit rights | product_lead + architect_security |
| Request-type localization/config changes | UX-07; no in-flight semantics invented | product_lead |
| Locale/calendar/digits and CSV conventions | UX-02/03/08 | product_lead + frontend_engineer + architect_security |
| Theme bootstrap/cache/failure contract | UX-11/12; server persistence and pre-main-UI resolution are mandatory | architect_security + frontend_engineer |
| Visual system, contrast and fonts | UX-09/10; candidate palette has no executed contrast pass | ux_brand_designer + qa_reviewer |
| Brand direction/descriptor/tagline | UX-13/14; A recommended, no final approval or clearance claimed | user + product_lead + ux_brand_designer |

OBSERVATION: The master plan mentions timesheet rejection in MVP scope but its state machine and endpoint outline omit it → Product Lead must resolve the terminal-rejection question before review controls and acceptance criteria are finalized; this artifact retains the brief's explicitly provisional approve/return flow.

## 12. Verification and acceptance handoff

Artifact evidence: the named sources and active profile Team Rules were read; repository status was inspected before writing and showed an existing untracked source PDF, which was left untouched. This deliverable is a Markdown solutioning specification only. Contrast tooling was attempted but blocked as recorded in §8; no usability, accessibility or application test results are fabricated.

Required later acceptance scenarios (not executed here):
1. Employee request draft → attachment validation → submit → conditional HR status → return reason → corrected resubmission, in Arabic and English.
2. Timesheet entry → invalid dates/duration/overlap → save → submit/read-only → reviewer return → employee correction, after time policy approval.
3. Manager restricted to approved team scope; HR visibility distinct from action authority; safe direct-link denial and no leaked counts/search/export/attachment metadata.
4. Keyboard-only completion, dialog focus return, mobile drawer, touch, mixed-script content and zoom/reflow in all core screens; manual screen-reader coverage in both locales.
5. Loading/empty/error/validation/disabled/success contract exercised for each S01–S10 overlay; network timeout and concurrent decision never produce false success or automatic duplicate writes.
6. System follows both OS modes and runtime OS changes; explicit overrides ignore OS; saved preference returns before main UI; sign-out/account switch/storage failure/save race/offline bootstrap behave as specified after architecture approval.
7. Text/control/focus/status contrast measured for every used pairing and state in both palettes; forced colors and reduced motion checked. Brand small-size and monochrome proofing reviewed by an Arabic reader.
8. Report filters, totals and export share authorized scope and explicit time/units; export denial or network failure never yields a false downloaded message.

Next owners: product_lead resolves/records policy and approval decisions; architect_security settles capability, error, bootstrap and preference contracts in parallel. Frontend/backend implementation starts only after shared approvals and complete acceptance criteria. qa_reviewer later verifies real rendered behavior as a read-only gate. No commit, push, deployment or external handoff has been performed by producing this artifact.
