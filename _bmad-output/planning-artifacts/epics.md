---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
status: ready-for-development
validated: 2026-09-11
user_approval_date: 2026-09-11
project: Heya Fawda?
inputDocuments:
  - /home/menisy/Desktop/Me/tracking_system_project/_bmad-output/planning-artifacts/prd.md
  - /home/menisy/Desktop/Me/tracking_system_project/_bmad-output/planning-artifacts/product/product-policy-decisions.md
  - /home/menisy/Desktop/Me/tracking_system_project/_bmad-output/planning-artifacts/ux/ux-brand-direction.md
  - /home/menisy/Desktop/Me/tracking_system_project/_bmad-output/planning-artifacts/architecture/architecture-security.md
  - /home/menisy/Desktop/Me/tracking_system_project/specs/permission-matrix.md
  - /home/menisy/Desktop/Me/tracking_system_project/specs/request-state-machine.md
  - /home/menisy/Desktop/Me/tracking_system_project/specs/timesheet-state-machine.md
  - /home/menisy/Desktop/Me/tracking_system_project/specs/acceptance-criteria.md
  - /home/menisy/Desktop/Me/tracking_system_project/.agents/skills/bmad-create-epics-and-stories/templates/epics-template.md
---

# Heya Fawda? - Epic Breakdown

## Overview

Heya Fawda? is an Arabic-first bilingual employee-operations workspace for authenticated employees, managers, and capability-gated HR users. This breakdown converts the approved product, policy, UX, architecture/security, permission, state-machine, and acceptance contracts into implementation-ready user-value epics. Django is the authority for authentication, scope, transitions, audit, and exports; React is a client. Payroll, biometrics, leave balances, external messaging, SSO/MFA, native mobile, multi-tenancy, workflow builders, realtime sockets, advanced analytics, projects/cost codes, and an assistant are outside MVP.

Evidence note: repository-root TEAM_RULES.md was not present; the workflow continued using the available project/profile guidance. Approved policy wording is preserved by reference and reflected without adding alternate business rules.

## Requirements Inventory

### Functional Requirements

FR1. Active users can sign in and sign out; invalid credentials are generic; inactive accounts cannot authenticate or mutate; sessions are protected by Django same-origin cookies and CSRF.
FR2. Users can view and edit only permitted own profile/preferences; HR can manage authoritative employee fields, reporting lines, roles, and active status through separate capabilities.
FR3. Employees can create, edit, view, and cancel their own requests only in permitted states; drafts and returned requests are editable.
FR4. Users can upload, view, replace, and remove request attachments only where policy permits, subject to allowlist, quotas, quarantine, retention, and private authorized delivery.
FR5. Request submission derives RequestType routing and manager snapshot server-side, enforces manager-first/HR routing, handles no-manager and inactive/missing reviewer cases, and prevents self-approval.
FR6. Authorized reviewers can approve, reject, or return requests with required comments where specified; every legal transition is transactional, version-checked, idempotent, audited, and append-only in history.
FR7. Employees can create one Monday-Sunday weekly timesheet in organization timezone, enter daily duration and unpaid breaks, edit permitted entries, and correct returned work.
FR8. Timesheets validate canonical minutes, date/week boundaries, duplicate weeks, negative/invalid/overlap values, and 24-hour daily/168-hour weekly maxima; legal workflow includes terminal rejection, replacement, and HR reopen rules.
FR9. Managers review only active direct reports; HR sees organization data only through explicitly granted capabilities; all lists, details, events, counts, searches, attachments, dashboards, and exports use server-derived scope.
FR10. Users receive scoped in-app notifications and can read/mark them read without notifications becoming authority.
FR11. Authorized managers and HR can filter, sort, paginate, and export scoped request, hours, and audit summaries; exports are bounded, synchronous, safe, and audited.
FR12. The system exposes versioned OpenAPI/health endpoints and a stable localized JSON error envelope.
FR13. Users can use Arabic-first/English-parity RTL/LTR responsive UI with accessible loading, empty, error, validation, disabled, success, conflict, keyboard, mobile, and theme states.
FR14. Signed-in users can persist locale and system/light/dark appearance; effective theme is applied before personalized UI renders.

### NonFunctional Requirements

NFR1. Django remains the authority; domain commands are named transactional services using scoped lookup, row locks, version checks, and post-commit side effects.
NFR2. Histories and audits are append-only; critical audit failure rolls back the business mutation.
NFR3. Authorization is least-privilege, object-scoped, disclosure-safe, and tested negatively for guessed IDs, filters, counts, attachments, events, dashboards, and exports.
NFR4. API errors use stable codes, localized messages, field errors, request IDs, and 401/403/404/409/422/429 semantics without sensitive detail.
NFR5. Idempotency keys are required for submit, decide, cancel, reopen, and upload; approved rate limits apply: auth 10/min/IP, mutations 60/min/user, exports 5/hour/user, uploads 20/hour/user.
NFR6. Private attachments use content/type validation, opaque keys, async malware quarantine, authorized short-lived delivery, and seven-year retention.
NFR7. UI targets WCAG 2.2 AA, 320px reflow/200% zoom, keyboard and screen-reader usability, both locales/directions, and all themes.
NFR8. Deployment separates local/staging/production; production needs approval, health/migration/rollback evidence, encrypted daily backups, 30-day retention, and monthly restore verification.

### Additional Requirements

- Stack: Django 5.2 LTS, DRF, PostgreSQL, React/TypeScript/Vite, modular monolith.
- Same-origin Django session authentication; no JWT/session secrets in browser storage; CSRF on unsafe methods.
- API base /api/v1/; generated OpenAPI, /health/live, and /health/ready.
- UUID/opaque API identifiers, deterministic ordering, bounded pagination, typed filters, shared ScopeContext/query services.
- Domain events and security audit include actor, subject, UTC timestamp, reason/comment, request ID, and before/after state where applicable.
- Notifications occur after commit and cannot change workflow state.
- CSV exports up to 10,000 rows only; larger exports receive a clear limit error; formula injection is prevented.
- No application code, deployment, test-pass, or design-clearance claim is made by this document.

### UX Design Requirements

- Arabic is first-visit default with complete English parity; use Arabic/English labels, not flags; preserve route, filters, focus, record, and unsaved edits when switching locale.
- RTL/LTR uses logical layout and semantic reading/focus order; isolate IDs, emails, filenames, URLs, and mixed scripts; Gregorian calendar and Arabic/Latin numeric input.
- Shared shell has skip link, one H1, capability-scoped navigation, current-page semantics, notifications page, account/preferences menu, and responsive drawer/rail.
- Core screens: sign-in, role-scoped home, my requests/editor/detail/review, my timesheets/editor/detail, manager review, HR employees, request types, reports, notifications/profile/preferences.
- Show status, next actor, and available action together. Never imply final approval before HR review. Never joke about salary, lateness, rejection, performance, or ability.
- Explicit save/submit and server-confirmed success; preserve input on failure; no automatic mutation replay or false success after timeout.
- Confirmation dialogs require explicit action; reject/return/reopen reasons are visible and mandatory; focus is trapped and restored.
- Loading/empty/error/validation/disabled/success/conflict states are localized and truthful; inaccessible controls and counts are not exposed.
- Responsive 320px reflow, mobile cards/drawers, 44px touch targets, visible focus, reduced-motion support, forced-colors consideration, and accessible tables.
- Candidate typography/palette/brand direction remain subject to the approved UX review; no contrast pass is claimed.

### FR Coverage Map

FR1: Epic 1 - Identity, session, and account safety.
FR2: Epic 1 - Profiles, preferences, and HR employee administration.
FR3: Epic 2 - Request creation, editing, history, and cancellation.
FR4: Epic 2 - Secure request attachments.
FR5: Epic 2 - Request routing and submission.
FR6: Epic 2 - Request review decisions and audit.
FR7: Epic 3 - Weekly timesheet entry and correction.
FR8: Epic 3 - Timesheet validation and lifecycle.
FR9: Epic 4 - Scoped review and organization oversight.
FR10: Epic 4 - In-app notifications.
FR11: Epic 4 - Reports and CSV exports.
FR12: Epic 5 - API contract, documentation, and operational health.
FR13: Epic 5 - Bilingual accessible responsive workspace.
FR14: Epic 5 - Locale and appearance persistence/bootstrap.

## Epic List

### Epic 1: Secure Identity and Organization Profiles
Employees can securely access their own workspace and maintain permitted personal preferences; HR can maintain authoritative organization records without becoming a Django superuser.
FRs covered: FR1, FR2, FR14.
Implementation notes: Django sessions/CSRF, inactive-account enforcement, capability-separated HR administration, reporting-line cycle prevention, server-persisted locale/theme, audit of security and organization changes. Natural dependency for all other epics.

### Epic 2: Requests from Draft to Decision
Employees can submit and correct requests with safe attachments and see an auditable, policy-routed outcome; authorized reviewers can decide without bypassing scope or state rules.
FRs covered: FR3, FR4, FR5, FR6.
Implementation notes: RequestType policy, manager snapshot, immutable events, transactional commands, quarantine, private downloads, explicit comments, no request reopen. Depends only on Epic 1 identity/scope.

### Epic 3: Weekly Time Records
Employees can record and correct weekly duration-based work records, while authorized reviewers process them under the approved terminal/reopen lifecycle.
FRs covered: FR7, FR8.
Implementation notes: organization timezone, Monday-Sunday uniqueness, integer minutes/unpaid breaks, immutable submitted/approved records, replacement after rejection, HR reopen with reason/audit. Depends only on Epic 1.

### Epic 4: Scoped Review, Notifications, and Reporting
Managers and capability-gated HR users can find only permitted work, act within scope, receive in-app outcomes, and export bounded authorized summaries.
FRs covered: FR9, FR10, FR11.
Implementation notes: shared scope policy for rows/counts/search/dashboard/export; no bulk approval; export itself audited; notifications after commit. Builds on Epics 2 and 3.

### Epic 5: Bilingual Accessible Delivery and Operability
All users can operate the workspace in Arabic or English across devices and themes, while integrations and operators receive a documented, safe API and health boundary.
FRs covered: FR12, FR13, FR14.
Implementation notes: React presentation only, localized stable errors, OpenAPI/health, WCAG target, RTL/LTR, pre-paint theme bootstrap, release/security evidence. Builds on all domain epics.

## Epic 1: Secure Identity and Organization Profiles

Employees securely enter the system and manage permitted personal settings; HR manages authoritative employee data and reporting lines with explicit capability checks.

### Story 1.1: Sign in, sign out, and inactive-account handling

As an employee,
I want to sign in and sign out securely,
So that only my active account can access the workspace.

Acceptance Criteria:

**Given** valid credentials for an active user
**When** the user signs in
**Then** Django establishes a rotated same-origin Secure, HttpOnly session and the user reaches only authorized workspace data.

**Given** invalid credentials or an inactive account
**When** sign-in is attempted
**Then** the response is safe and non-enumerating, no authenticated session is granted, and the inactive account cannot mutate.

**Given** an authenticated user signs out or the session expires
**When** the user requests a mutation
**Then** the session is invalid, CSRF protections remain enforced, and the UI requires re-authentication without replaying the mutation.

### Story 1.2: View and edit permitted own profile and preferences

As a user,
I want to update my permitted profile and preferences,
So that my workspace reflects my language and appearance choices without changing authoritative organization data.

Acceptance Criteria:

**Given** an authenticated user edits display name, locale, appearance, timezone display preference, or notification-read state where permitted
**When** the save is submitted
**Then** only allowlisted fields persist server-side and the response returns authoritative values.

**Given** a user attempts to edit email, employee number, department, job title, manager, role, or active status
**When** the mutation is submitted
**Then** the server rejects it safely and does not alter the authoritative field.

**Given** locale is Arabic or English and appearance is system, light, or dark
**When** preferences are loaded
**Then** the enum is validated, direction/localized responses are consistent, and no arbitrary CSS value is accepted.

### Story 1.3: HR manages employees and reporting lines

As an HR administrator with the required capability,
I want to manage employee organization fields and active status,
So that routing and scope remain accurate.

Acceptance Criteria:

**Given** HR has the explicit employee-management capability
**When** HR creates or updates an employee
**Then** only approved authoritative fields can change and before/after values are audited.

**Given** a proposed manager is the employee, inactive where disallowed, or creates a reporting cycle
**When** HR saves the relationship
**Then** validation rejects it with a field-level manager error and leaves the prior relationship unchanged.

**Given** a non-HR user or HR without the relevant capability attempts the operation
**When** the endpoint or UI is accessed
**Then** the action is absent or safely denied and no employee data is disclosed.

## Epic 2: Requests from Draft to Decision

Employees create, submit, track, and correct requests; authorized reviewers make policy-compliant decisions with secure files and immutable history.

### Story 2.1: Create and edit a request draft

As an employee,
I want to create and edit a request draft,
So that I can prepare accurate work before submission.

Acceptance Criteria:

**Given** an active user and an active RequestType
**When** the user saves a draft
**Then** permitted fields persist only after server confirmation, the draft is visible to its requester, and an append-only creation/history record is available.

**Given** a returned request with a correction reason
**When** the requester edits it
**Then** the reason is prominent, permitted fields are editable, prior history remains unchanged, and no decision state is silently altered.

**Given** a submitted, approved, rejected, or cancelled request
**When** a generic edit is attempted
**Then** the server rejects it and the UI explains the read-only state.

### Story 2.2: Upload and securely access request attachments

As a requester,
I want to attach permitted files,
So that reviewers can use supporting evidence without public exposure.

Acceptance Criteria:

**Given** an authenticated requester uploads a PDF, PNG, JPG, or DOCX within 10MB/file, 5 files/request, and 25MB/request
**When** content and detected type validation succeeds
**Then** the file is stored privately under an opaque key and remains quarantined until the asynchronous malware scan is clean.

**Given** an unsupported, mismatched, oversized, pending, or failed file
**When** upload or download is attempted
**Then** the server rejects or blocks it with a localized stable error, records the relevant audit event, and exposes no bytes.

**Given** an authorized user downloads a clean attachment
**When** the authorized Django download path is requested
**Then** a fresh parent-scope check occurs and the response uses private short-lived authorization, safe disposition, and no public URL.

**Given** a request is returned
**When** the requester replaces an attachment
**Then** replacement is permitted under the same quotas; submitted or decided attachments remain immutable.

### Story 2.3: Submit a request using server-derived routing

As an employee,
I want to submit a complete request,
So that it reaches the correct reviewer without me choosing authority.

Acceptance Criteria:

**Given** a draft has valid required data and all attachments are clean
**When** the requester submits with an Idempotency-Key
**Then** Django snapshots the manager at submission and reads RequestType routing from the server, entering PENDING_MANAGER, PENDING_HR, or the approved HR-only path.

**Given** no manager exists for a non-HR-only type, or the reviewer is missing/inactive
**When** submission is attempted
**Then** submission is blocked or flagged to HR exactly as policy requires, never silently rerouted.

**Given** the same key and payload is retried
**When** the command is repeated
**Then** the original result is returned without a duplicate transition; a differing payload returns 409.

### Story 2.4: Review and decide a request

As an authorized reviewer,
I want to approve, reject, or return an in-scope request,
So that decisions are accountable and policy-compliant.

Acceptance Criteria:

**Given** the reviewer is authorized for the current state and scope
**When** approve, reject, or return is submitted
**Then** the named transactional service locks and rechecks state, applies exactly one legal transition, increments version, appends event and audit records, and schedules notification after commit.

**Given** reject or return is selected without a non-blank bounded comment
**When** confirmation is attempted
**Then** the action is blocked with a field error and no state/history change occurs.

**Given** the requester is the reviewer, the reviewer is outside scope, or the version/state is stale
**When** a decision is attempted
**Then** it is denied or conflicts safely, no duplicate event is appended, and the latest authoritative state can be reloaded.

### Story 2.5: Cancel a request before decision

As a requester,
I want to cancel an undecided request,
So that I can stop work I no longer need.

Acceptance Criteria:

**Given** the requester owns a draft or submitted request with no decision
**When** cancellation is explicitly confirmed with an Idempotency-Key
**Then** the request becomes CANCELLED, an audit/history event records the action, and the result is server-confirmed.

**Given** a request is approved, rejected, or already cancelled
**When** cancellation is attempted
**Then** the server denies it and preserves all history.

## Epic 3: Weekly Time Records

Employees record duration-based Monday-Sunday work weeks and correct returned records; reviewers process immutable records with approved reopening safeguards.

### Story 3.1: Create a unique weekly timesheet and entries

As an employee,
I want to record daily work duration and unpaid breaks for a week,
So that my time record reflects what I entered without inferred productivity.

Acceptance Criteria:

**Given** a valid Monday-Sunday week in the organization timezone
**When** the employee creates a sheet and adds daily duration entries
**Then** canonical integer minutes and unpaid break minutes are stored, totals display as hours and minutes, and no rounding or automatic deduction occurs.

**Given** a sheet already exists for the employee and week
**When** another container is created
**Then** the request returns a safe duplicate-week conflict and navigates to the existing authorized sheet.

**Given** an entry is negative, invalid, out of week, overlapping where intervals apply, or makes daily work exceed 24 hours
**When** it is saved or submitted
**Then** validation identifies the affected field/entry and persists no invalid mutation.

### Story 3.2: Submit and correct a timesheet

As an employee,
I want to submit a validated weekly timesheet and correct returned work,
So that review receives a complete record.

Acceptance Criteria:

**Given** the sheet passes all validation and weekly work is at most 168 hours
**When** submission is confirmed with an Idempotency-Key
**Then** the state becomes SUBMITTED, history/audit append atomically, and the sheet becomes read-only to the employee.

**Given** the sheet is RETURNED with a reviewer reason
**When** the employee corrects and resubmits
**Then** only permitted entries change, the reason/history remain visible, and the state returns to SUBMITTED after validation.

**Given** the sheet is SUBMITTED or APPROVED
**When** an employee edits or deletes an entry
**Then** the server denies the mutation and explains the read-only policy.

### Story 3.3: Review, reject, replace, and reopen a timesheet

As an authorized reviewer or HR administrator,
I want to process timesheet review outcomes under explicit rules,
So that terminal records remain auditable.

Acceptance Criteria:

**Given** an authorized reviewer acts on SUBMITTED
**When** approve, return, or reject is confirmed with required reason where applicable
**Then** the legal state transition is applied transactionally with version check, immutable event, audit, and post-commit notification.

**Given** a reviewer rejects a timesheet
**When** rejection commits
**Then** the record is terminal/read-only and a new replacement workflow is created for that employee/week; the rejected record is retained.

**Given** HR has reopen capability and an APPROVED or REJECTED sheet is selected
**When** HR supplies a mandatory reason and explicit confirmation with an Idempotency-Key
**Then** the record becomes RETURNED with retained history and an audited reopen event; employees and unauthorized users cannot reopen.

## Epic 4: Scoped Review, Notifications, and Reporting

Reviewers find and act on permitted work, users receive safe outcome notifications, and reports match the same server scope as operational lists.

### Story 4.1: View scoped queues and details

As a manager,
I want a direct-report review queue,
So that I can review only active direct reports.

Acceptance Criteria:

**Given** a manager requests a queue, list, detail, search, filter, count, or dashboard
**When** the server builds the result
**Then** scope derives from the authorized policy and active direct-report rule, with deterministic sort and bounded pagination.

**Given** a user guesses an inaccessible object ID or changes employee/filter parameters
**When** the request is made
**Then** the response discloses no existence and does not leak rows, counts, events, attachment metadata, or actions.

**Given** HR has visibility but not an action capability
**When** HR opens the organization record
**Then** read access and decision/edit controls remain separately gated.

### Story 4.2: Receive and manage in-app notifications

As a user,
I want scoped in-app notifications,
So that I know when work needs attention.

Acceptance Criteria:

**Given** a committed request/timesheet outcome or relevant authorized event
**When** post-commit notification work runs
**Then** an in-app notification is created for the permitted recipient without changing source state.

**Given** a notification is unread
**When** the user views or marks it read
**Then** read state is server-confirmed, localized, keyboard-accessible, and failure leaves/reverts unread state with retry.

**Given** the related object is no longer available to the recipient
**When** its notification link is opened
**Then** the UI gives safe unavailable messaging without leaking hidden details.

### Story 4.3: Generate scoped request, hours, and audit CSV reports

As an authorized manager or HR user,
I want bounded CSV reports,
So that I can analyze permitted operational records.

Acceptance Criteria:

**Given** authorized filters are applied to a report
**When** rows, totals, dashboard values, and CSV are requested
**Then** all use the same server-derived scope and filters, display timezone/date interval and scope, and return deterministic results.

**Given** a report contains up to 10,000 rows
**When** CSV export is requested within the rate limit
**Then** the server generates UTF-8-safe output with explicit units, prevents formula injection, audits the export, and does not claim disk save beyond download initiation.

**Given** the result exceeds 10,000 rows, scope is revoked, or rate limit is exceeded
**When** export is requested
**Then** it is rejected with a clear localized error and no unauthorized or partial export is delivered.

## Epic 5: Bilingual Accessible Delivery and Operability

The complete product is usable in Arabic and English, on mobile and desktop, with truthful interaction states and a documented secure API boundary.

### Story 5.1: Provide versioned API errors, schema, and health endpoints

As an integrator or operator,
I want a stable documented API and health boundary,
So that clients can handle failures and operators can verify service readiness.

Acceptance Criteria:

**Given** an API request succeeds or fails
**When** the response is returned
**Then** success uses the versioned contract and errors contain stable code, localized message, field errors, request ID, and no sensitive detail.

**Given** authentication, authorization, not-found, state conflict, validation, or throttling occurs
**When** the endpoint responds
**Then** it uses the approved 401/403/404/409/422/429 semantics consistently.

**Given** an operator calls liveness or readiness
**When** /health/live or /health/ready is requested
**Then** the checks distinguish process from bounded dependency readiness and reveal no secrets; OpenAPI reflects actual serializers/views.

### Story 5.2: Deliver bilingual RTL/LTR responsive accessible screens

As an employee,
I want to complete core journeys in Arabic or English on keyboard and mobile,
So that language, direction, device, or assistive technology does not block my work.

Acceptance Criteria:

**Given** Arabic is selected on first visit or English is selected explicitly
**When** any S01-S10 screen renders
**Then** all navigation, statuses, validation, notifications, errors, dates, controls, and assistive names have parity; direction and mixed-script isolation are correct.

**Given** a user operates at 320px width, 200% zoom, keyboard-only, or reduced-motion preference
**When** forms, lists, drawers, tables, and dialogs are used
**Then** content reflows without critical horizontal scrolling/clipping, focus is visible and logical, dialogs trap/restore focus, touch targets are usable, and no essential behavior depends on hover/color/motion.

**Given** loading, empty, failure, validation, disabled, success, conflict, or timeout occurs
**When** the state is presented
**Then** it is localized, truthful, preserves safe input, provides recovery, and never asserts an unconfirmed mutation.

### Story 5.3: Bootstrap and persist appearance and locale safely

As a signed-in user,
I want my locale and appearance preference to persist without visual flash,
So that the workspace opens consistently across visits.

Acceptance Criteria:

**Given** the preference is system, light, or dark
**When** the app bootstraps
**Then** the saved enum is resolved before personalized UI renders; system follows OS changes, explicit choices ignore them, and all themes preserve contrast/status semantics.

**Given** a preference save succeeds or fails
**When** the user changes it
**Then** only server acknowledgement marks it saved; failure preserves a retryable preview and does not overwrite a newer selection.

**Given** sign-out, account switch, storage-disabled behavior, or preference-fetch failure
**When** the shell is initialized
**Then** account-scoped hints and personalized state are cleared or isolated, server preference remains authoritative, and the user receives recoverable bootstrap behavior without leaking prior-account data.

### Story 5.4: Meet release verification and operational gates

As a release operator,
I want evidence-based verification gates,
So that MVP release does not bypass security, accessibility, or recovery controls.

Acceptance Criteria:

**Given** a candidate release is proposed
**When** verification is performed
**Then** backend/frontend focused tests, negative authorization tests, real-browser journeys in both locales/directions, accessibility checks, migration-from-empty, OpenAPI review, dependency/secret scans, and health smoke tests produce recorded real results.

**Given** production deployment is requested
**When** the release gate is evaluated
**Then** explicit approval, migration review, backup/rollback plan, health checks, and deployment evidence are present; staging uses non-production data and demo accounts are never seeded in production.

**Given** a critical scope, state, audit, attachment, CSRF, or backup/restore check fails
**When** release is evaluated
**Then** release is blocked and no test-pass or deployment approval is implied.

## Handoff and Open Questions

Approved policy decisions are treated as exact authority. No unresolved business rule was invented. Implementation handoff: architect_security and ux_brand_designer receive this product contract; backend_engineer/frontend_engineer implement only after their contract reviews; qa_reviewer verifies read-only gates; release_operator owns staging/release evidence.

Open implementation clarifications that do not change approved business policy: concrete malware scanner/provider, storage provider and encryption/key ownership; exact preference endpoint placement; final CSV header/encoding convention within the approved UTF-8-safe boundary; final UX palette/font/brand clearance and measured contrast report; deployment target, queue choice, residency, and RPO/RTO. Any change to approved routing, scope, state, time, attachment, HR, cancellation, reopen, audit, or retention policy requires explicit user approval before updating this artifact.

Select an Option: [A] Advanced Elicitation [P] Party Mode [C] Continue
