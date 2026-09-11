# هي فوضى؟ / Heya Fawda? — Architecture and Security Solutioning

Status: Solutioning draft; pending approval of the constitution, product brief, UX direction, and unresolved business policies.
Owner: architect_security
Scope: Tracking-sys only
Stack: Django 5.2 LTS + Django REST Framework, PostgreSQL, React + TypeScript + Vite

## 1. Evidence, authority, and limitations

This artifact was prepared from:

- `docs/PROJECT_CONTEXT.md`
- `specs/constitution.md`
- `.hermes/plans/2026-09-10_021026-employee-operations-blueprint.md`
- `_bmad-output/planning-artifacts/briefs/brief-tracking_system_project-2026-09-11/brief.md`
- `/home/menisy/.hermes/profiles/product_lead/TEAM_RULES.md`

The brief currently declares `status: draft-pending-user-approval`; the constitution is also Draft. No application code is written or authorized by this artifact.

No approved UX artifact was present in the requested project artifact directory when this document was produced. Therefore visual details, exact component contracts, copy, and some interaction behavior remain [ASSUMPTION] and must be reconciled with `ux_brand_designer` before implementation. This document treats the available product brief and constitution as the current requirements inputs without representing them as approved.

Django is the authority for authentication, authorization, ownership and reporting-line scope, workflow transitions, transaction boundaries, notifications triggered by domain events, and audit history. React is a presentation client. The future assistant is an additional client of Django services, never a database client or authorization bypass.

## 2. Architectural goals and non-goals

Goals:

1. Keep the first release a modular monolith with explicit domain boundaries and low operational complexity.
2. Make every security decision server-side and reusable by HTTP APIs, dashboards, exports, and a later assistant.
3. Preserve append-only business histories and an auditable actor/time/from/to record for each transition.
4. Make list, detail, attachment, dashboard, search, count, and export scope consistent.
5. Support Arabic-first bilingual RTL/LTR use and system/light/dark appearance without making the browser an authority.
6. Use PostgreSQL constraints and row locking to defend invariants under concurrency.

Non-goals for MVP:

- ERP, payroll, biometric attendance, leave accrual, generic workflow builder, native mobile, multi-tenancy, real-time sockets, SSO/MFA, external email/SMS/push, advanced scheduled analytics, projects/cost codes, and broad employee document management.
- A separate microservice or FastAPI gateway. A gateway may be reconsidered only for a demonstrated realtime scaling need and must delegate business actions to Django.

Residual risk: a modular monolith reduces distributed-system risk but creates a shared deployment and failure boundary. Strong module ownership, import rules, service interfaces, and architecture tests are required to prevent a distributed monolith inside one process.

## 3. Modular-monolith shape

Deployment units:

- `web`: one Django ASGI/WSGI application serving DRF and, in production, either the built SPA or a same-origin reverse-proxy route to static frontend assets.
- `worker` [ASSUMPTION]: optional separate process for non-critical notification/report jobs. It may enqueue work but cannot decide authorization or perform un-audited state changes.
- `postgres`: PostgreSQL, private network only.
- `object storage` [ASSUMPTION]: private attachment storage, accessed through Django-controlled upload/download paths.
- `reverse proxy`: TLS termination, request size limits, security headers, static asset delivery, and routing. It is not an authorization layer.

The Django project should have a thin configuration layer and domain-oriented apps. Views, serializers, and tasks call application services; they do not implement transitions or assemble ad hoc permission predicates.

Proposed apps and ownership:

- `accounts`: custom User, authentication endpoints, current-user representation, account activation state, session lifecycle, profile self-service boundary. It owns identity, not employee hierarchy.
- `organization`: EmployeeProfile, department/job metadata, manager relationship, role assignment, reporting-line validation, HR employee administration. It exposes scoped employee selectors to other modules.
- `requests`: RequestType, EmployeeRequest, RequestAttachment metadata, request commands, request query services, request workflow. It owns request business state.
- `timesheets`: Timesheet, TimeEntry, timesheet commands, duration/date validation, timesheet workflow, scoped queries.
- `notifications`: Notification records and delivery/read-state behavior. It consumes committed domain outcomes and never changes source workflow state.
- `reporting`: read-only report query services, dashboard projections/aggregates, CSV serialization. It must consume the same scope policy objects as list/detail APIs.
- `audit`: append-only security/business audit records and audit-write interface. Domain event tables remain owned by their domain app; the centralized audit stream records security-relevant actions and can reference them.
- `api`: URL versioning, shared exception envelope, pagination/filter validation, schema/docs, authentication wiring, health checks. It contains no domain policy.
- `assistant` (later): conversations/messages/tool calls and tool adapters. Tools invoke approved services using the authenticated principal and record authorization and confirmation outcomes. It is excluded from MVP implementation.

Dependency direction:

- `api` may depend on all exposed application services.
- `reporting` may depend on organization scope policies and read models/query interfaces; it must not mutate requests or timesheets.
- `notifications` consumes domain outcomes through an explicit interface/outbox [ASSUMPTION]; it must not import view code.
- `requests` and `timesheets` depend on identity and organization contracts, not each other's private models.
- `audit` provides append-only recording interfaces; it must not grant access.
- No app may read another app's private tables through undocumented ORM coupling.

## 4. Domain model and invariants

Identifiers should be opaque UUIDs at API boundaries [ASSUMPTION], while PostgreSQL foreign keys preserve relational integrity. All timestamps are timezone-aware UTC instants. Local display uses the employee/account timezone policy after A5 is approved.

### 4.1 Identity and organization

`User`

- id, email/identifier, password hash managed by Django, role, is_active, last_login, created_at, updated_at.
- Role is an application role (`EMPLOYEE`, `MANAGER`, `HR`), not Django superuser status. Django superuser is an operational break-glass capability and must not be the normal HR path.

`EmployeeProfile`

- user one-to-one, employee_number, display_name, department, job_title, manager FK to EmployeeProfile nullable only under an approved no-manager policy, timezone [ASSUMPTION], created_at, updated_at.
- Constraints/services reject self-management, inactive manager assignment [ASSUMPTION], and reporting-line cycles. Role/account changes are audited.

`RequestType`

- name, description, requires_hr_approval, is_active, created/updated metadata, policy version [ASSUMPTION].
- Only HR may configure it. The server reads the active policy at command time; client-supplied routing flags are ignored.

### 4.2 Requests

`EmployeeRequest`

- id, requester, request_type, title, details, status, submitted_at, manager_at_submission, current_assignee, version, created_at, updated_at.
- `manager_at_submission` is a snapshot of the responsible reviewer, not a live query. Reassignment semantics are unresolved [ASSUMPTION].
- Version increments on every mutable command. Submitted/terminal records are not edited through generic PATCH.

`RequestAttachment`

- id, request, uploaded_by, private object key, original name, detected media type, byte size, checksum, upload status, created_at, deleted_at [ASSUMPTION].
- The database stores metadata only; attachment bytes are private and are never exposed by a public media URL.

`RequestEvent`

- id, request, actor, action, from_status, to_status, comment, created_at, correlation_id, metadata snapshot.
- Insert-only. No update/delete API. Database permissions and application code should prevent ordinary users from modifying history.

Request state baseline:

```text
DRAFT -> PENDING_MANAGER -> PENDING_HR -> APPROVED
                              |             |
                              +-> RETURNED  +-> REJECTED
RETURNED -> PENDING_MANAGER
DRAFT/RETURNED -> CANCELLED (policy-controlled)
PENDING_MANAGER -> REJECTED or RETURNED
PENDING_HR -> REJECTED or RETURNED or APPROVED
```

`PENDING_HR` is entered only when the stored request-type policy requires it. The final graph, manager/HR substitution, no-manager behavior, and cancellation policy remain [ASSUMPTION].

### 4.3 Timesheets

`Timesheet`

- id, employee, week_start, status, submitted_at, reviewer, reviewed_at, version, created_at, updated_at.
- Unique `(employee, week_start)`. A database constraint plus service validation prevents duplicate weekly containers.

`TimeEntry`

- id, timesheet, work_date, started_at, ended_at, duration_minutes, description, created_at, updated_at.
- Canonical duration is integer minutes. Reject negative/zero duration [ASSUMPTION], out-of-week dates, invalid start/end combinations, overlapping intervals, and policy violations.

`TimesheetEvent`

- Same append-only shape and correlation fields as RequestEvent.

Timesheet state baseline:

```text
DRAFT -> SUBMITTED -> APPROVED
                    \-> RETURNED -> SUBMITTED
```

A separate terminal `REJECTED`, cancellation after submission, and approved-record reopen are unresolved [ASSUMPTION]. Submitted and approved records are immutable unless a specifically approved, authorized, reason-required, audited reopen service exists.

### 4.4 Cross-cutting records

`Notification`: recipient, kind, related object reference, payload/translation key, read_at, created_at. It contains no authority; unread state does not affect workflow.

`UserPreference` or a preference field on User [ASSUMPTION]: locale and appearance preference. See §9.

`AuditRecord`: id, occurred_at, actor/user or anonymous marker, action, object type/id, outcome, authorization decision, request/correlation id, source (`web`, `job`, `assistant`), IP/user-agent handling policy [ASSUMPTION], and structured non-secret metadata. Do not record passwords, session secrets, CSRF tokens, raw attachment bytes, or sensitive free text unless explicitly required and protected.

## 5. State transition services

Each command is a named synchronous application service in its owning app, for example:

- `create_request`, `update_request_draft`, `submit_request`, `approve_request`, `reject_request`, `return_request`, `cancel_request`.
- `create_timesheet`, `upsert_time_entry`, `delete_time_entry`, `submit_timesheet`, `approve_timesheet`, `return_timesheet`, and a future `reopen_timesheet` only if approved.

Service contract:

1. Accept an authenticated principal, target identifier, validated command data, expected version, and correlation id.
2. Resolve the target through an explicit scoped queryset before mutation. Never fetch by unscoped primary key and authorize later.
3. Enter `transaction.atomic()` and lock the target with `select_for_update()`.
4. Re-check authorization, current state, ownership/reporting-line scope, version, active reviewer, and command invariants while holding the lock.
5. Require a non-blank, bounded comment for reject/return and any future reopen/override.
6. Apply one legal transition, increment version, append the immutable event, append the security audit record, and arrange notification work after commit.
7. Use `transaction.on_commit()` for external/asynchronous effects. Do not send a notification or call a provider before the transaction commits.
8. Return a typed result or a stable domain error. Concurrent stale commands produce a safe conflict response and never silently overwrite another decision.

Approval commands must be idempotency-safe [ASSUMPTION]: repeating the same command against an already-completed transition returns a conflict or an explicitly documented idempotent representation; it must not append duplicate approvals.

The UI and assistant call these same services. DRF serializers validate shape; services validate authority, workflow, and cross-record invariants.

## 6. API conventions

Base path: `/api/v1/`. Same-origin JSON API with a consistent envelope:

- Success: resource or `{ "data": ..., "meta": ... }` [ASSUMPTION].
- Error: `{ "error": { "code": "...", "message": "...", "fields": {...}, "request_id": "..." } }`.
- Never include stack traces, SQL, secrets, or unauthorized-object existence details.

Conventions:

- Resource identifiers are opaque; use deterministic ordering and bounded page size. Reject malformed filters and unsupported sort fields rather than ignoring them.
- `GET` is read-only. `POST` creates or invokes a named command. Generic `PATCH` is limited to fields permitted in the current state; transitions use explicit action endpoints.
- Use `201` for creation, `200` for successful reads/commands, `204` for successful deletion where deletion is permitted, `400` for invalid command data, `401` for unauthenticated access, `403` for authenticated but forbidden actions, `404` for an object outside the caller's chosen disclosure policy, `409` for stale version/illegal concurrent state, and `413` for rejected upload size.
- Use an `Idempotency-Key` for retryable create/command requests [ASSUMPTION]; scope keys to authenticated user and endpoint and retain only the minimum safe result metadata.
- All list, detail, event, attachment, dashboard, and export endpoints call a shared scope service. DRF object permissions do not automatically scope querysets.
- OpenAPI is generated from actual serializers/views and reviewed for authorization-sensitive operations. Schema examples must not use production data.

Initial resource surface:

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
GET    /api/v1/employees/me
PATCH  /api/v1/employees/me
GET    /api/v1/employees                 (HR)
POST   /api/v1/employees                 (HR)
PATCH  /api/v1/employees/{id}             (HR, scoped policy)
GET    /api/v1/request-types
POST   /api/v1/request-types              (HR)
PATCH  /api/v1/request-types/{id}         (HR)
GET    /api/v1/requests
POST   /api/v1/requests
GET    /api/v1/requests/{id}
PATCH  /api/v1/requests/{id}              (permitted draft fields)
POST   /api/v1/requests/{id}/submit|approve|reject|return|cancel
POST   /api/v1/requests/{id}/attachments
DELETE /api/v1/requests/{id}/attachments/{attachment_id}
GET    /api/v1/requests/{id}/events
GET    /api/v1/timesheets
POST   /api/v1/timesheets
GET    /api/v1/timesheets/{id}
POST   /api/v1/timesheets/{id}/entries
PATCH  /api/v1/timesheets/{id}/entries/{entry_id}
DELETE /api/v1/timesheets/{id}/entries/{entry_id}
POST   /api/v1/timesheets/{id}/submit|approve|return
GET    /api/v1/timesheets/{id}/events
GET    /api/v1/notifications
PATCH  /api/v1/notifications/{id}
GET    /api/v1/dashboard
GET    /api/v1/reports/requests.csv
GET    /api/v1/reports/hours.csv
GET    /api/schema
GET    /api/docs
GET    /health/live
GET    /health/ready
```

Export endpoints must use the same filters and scope object as their corresponding lists, stream bounded output safely, and audit who exported what and when. Large exports need an approved asynchronous design [ASSUMPTION].

## 7. Authentication, session, and CSRF

Use Django same-origin session authentication. Do not place JWTs or session tokens in browser storage.

- Password handling is delegated to Django's password hashers and authentication framework. Login failure responses must not reveal whether an email exists. Apply rate limiting/lockout controls [ASSUMPTION].
- Session cookie: `Secure`, `HttpOnly`, `SameSite=Lax` [ASSUMPTION], narrow production domain/path, rotated on login, invalidated on logout and inactive-account detection. Configure idle/absolute expiry [ASSUMPTION].
- CSRF: Django CSRF middleware and token cookie/header flow for unsafe methods. React obtains the CSRF token from the same-origin mechanism and sends `X-CSRFToken`; do not exempt API mutation endpoints. Validate trusted origins explicitly.
- CORS is unnecessary for same-origin deployment. If a separate frontend origin is later approved, use an explicit allowlist and preserve credential/CSRF protections; never use wildcard origins with credentials.
- `is_active` is checked at authentication and every request. Deactivation revokes active sessions [ASSUMPTION] and prevents new commands.
- Set HSTS in TLS production, clickjacking protection, `Content-Type-Options: nosniff`, a restrictive Content Security Policy compatible with the SPA, Referrer-Policy, and safe cache headers for personalized responses.
- Authentication and security events are audit records: login success/failure outcome, logout, deactivation, password change/reset if added, authorization denials at an appropriate rate, and suspicious upload/download activity.

## 8. RBAC, ownership, and queryset scoping

Roles are coarse capabilities; object scope is a separate mandatory check. Every operation must pass all applicable checks:

1. authenticated principal;
2. active account;
3. role capability;
4. ownership or approved reporting-line scope;
5. object state and action legality;
6. reviewer/assignee and submission snapshot rules;
7. export-specific permission and filter scope;
8. assistant-tool permission and confirmation, when applicable.

Baseline capability matrix:

| Capability | Employee | Manager | HR |
|---|---:|---:|---:|
| Read/edit permitted own profile | Yes | Yes | Yes |
| Create/edit own draft/returned request | Yes | Yes | Yes |
| Read own request/timesheet history | Yes | Yes | Yes |
| Review direct-report requests/timesheets | No | Yes | Yes |
| Review organization requests/timesheets | No | No | Yes |
| Manage employees/reporting lines | No | No | Yes |
| Configure request types | No | No | Yes |
| Organization reports/exports | No | No | Yes |

The matrix is a baseline, not a grant to edit another person's records. HR visibility and HR decision authority are distinct. HR is not synonymous with Django superuser. Self-approval is denied for every workflow path.

Scope policy design:

- Employee querysets: `requester=user` and `timesheet.employee=user`.
- Manager querysets: employee is a direct report using the current organization relationship or the approved submission snapshot for an in-flight request [ASSUMPTION: direct reports only]. Managers cannot supply an arbitrary employee id to widen scope.
- HR querysets: organization-wide only for capabilities explicitly granted by the HR policy; sensitive employee edits and approval substitution require separate checks.
- Requests: review scope is based on the responsible manager snapshot and current approved HR routing policy, not client-provided role flags.
- Attachments/events: scope through the parent object queryset, then check action-specific rights.
- Reports/dashboard/counts/search: build from one `ScopeContext`/query policy and reuse it for rows and aggregates. Do not compute an unscoped count and filter only the displayed page.
- Exports: run the same authorization and filters again at export execution time; never trust a frontend-generated object list.

Use dedicated query services such as `visible_requests_for(principal)`, `visible_timesheets_for(principal)`, and `visible_employees_for(principal)`. DRF `get_queryset()` must call them. Object permission classes remain a defense-in-depth check for retrieved objects, not the list authorization mechanism.

Negative tests are mandatory for cross-employee URLs, guessed identifiers, altered filters, counts, attachments, events, dashboard cards, and CSV exports.

## 9. Audit and history design

Two layers are intentional:

1. Domain histories (`RequestEvent`, `TimesheetEvent`) are user-visible, append-only workflow histories with from/to states and comments.
2. `AuditRecord` is a security/compliance stream for authentication, authorization outcomes, configuration changes, employee/reporting-line changes, reads/exports/downloads where policy requires, attachment actions, assistant tools, and workflow commands.

Audit rules:

- Record actor, effective principal, timestamp, action, target type/id, outcome, from/to where applicable, reason/comment presence (not necessarily full sensitive text), correlation/request id, source channel, and safe structured metadata.
- Write audit records in the same database transaction as a successful state change. For denied actions, record the denial without leaking target existence to the caller.
- Never update or delete audit/history rows through application APIs. Retention, archival, legal hold, and administrator access are [ASSUMPTION] and must be approved.
- Treat audit logging as fail-closed for critical workflow/configuration changes: if the required audit insert cannot commit, the business mutation must roll back. Availability impact is accepted for accountability.
- Avoid logging credentials, CSRF/session values, authorization headers, attachment content, or unbounded request bodies. Redact personal data according to the approved retention policy.
- Use database permissions, migration review, and append-only application interfaces to reduce tampering. A separate immutable/WORM sink is deferred [ASSUMPTION]; therefore the MVP audit stream is not independently tamper-proof against a fully privileged database operator.

## 10. Attachment security

Attachment upload is not launch-ready until A6 is approved. The implementation boundary is:

- Enforce authenticated, parent-object-scoped upload permission before accepting bytes.
- Allowlist extensions and detected MIME/content signatures; do not trust the filename or browser `Content-Type`. Reject ambiguous/mismatched types.
- Enforce request-body and per-file/per-request quotas at reverse proxy, Django, and storage layers. Reject before expensive processing where possible.
- Generate an opaque storage key; retain the original filename only as escaped display metadata. Never use user input as a filesystem path.
- Store privately outside the executable/static tree. Serve through an authorized Django download endpoint or short-lived, server-issued signed URL after a fresh parent scope check. Do not expose permanent public URLs.
- Scan with an approved malware scanner before marking an upload available [ASSUMPTION]. Quarantine failures and audit verdicts. Do not parse office/PDF content in the web process unless required.
- Prevent SVG/scriptable content or sanitize it before any approved inline use; default to download with `Content-Disposition: attachment`, safe content type, and `X-Content-Type-Options: nosniff`.
- Use checksum and size metadata for integrity/deduplication [ASSUMPTION]. Consider encryption at rest and key-management ownership [ASSUMPTION].
- Define whether returned/submitted attachments can be added, replaced, or deleted; retention/deletion, legal hold, expected types, maximum sizes, and download rights are unresolved [ASSUMPTION].
- Rate-limit upload/download endpoints and audit upload, rejection, deletion, and download events without logging file contents.

## 11. Theme and locale preference persistence

The application supports `system`, `light`, and `dark`; `system` is the default and follows `prefers-color-scheme`. Arabic and English are first-class, with RTL/LTR tested as separate modes.

- Persist a validated enum on the signed-in user's preference record (or User field) through `GET/PATCH /api/v1/auth/me` or a dedicated preferences endpoint [ASSUMPTION]. Reject arbitrary CSS/theme values.
- Anonymous users may use a local pre-login hint [ASSUMPTION], but the server-side signed-in preference is authoritative and must be reconciled after login.
- Bootstrap preference before the main React tree renders. The client may read a small same-origin bootstrap response or server-rendered data; it must not wait for a late dashboard request and visibly flash the wrong theme.
- For `system`, resolve with `prefers-color-scheme`; for explicit values, apply the saved value. Store the enum, not the resolved OS result.
- Locale and direction are presentation choices, but the server must validate locale inputs and response language behavior [ASSUMPTION]. Never infer authorization, workflow, or scope from locale/theme fields.
- UX must define accessible color tokens and focus/error/disabled states in all three appearance modes. This cannot be fully signed off until the missing UX artifact is available.

## 12. Testing and security verification strategy

Backend unit/service tests:

- Every legal and illegal request/timesheet transition, required comment, version conflict, duplicate/retry behavior, self-approval denial, inactive actor, and transaction rollback.
- Reporting-line self-link/cycle prevention, request-type routing read from server policy, weekly uniqueness, date/week boundaries, duration/minute validation, overlaps, timezone/overnight/DST cases after A5 is approved.
- Attachment allowlist, sniffed MIME mismatch, quota, quarantine, private download, parent-scope denial, and safe filename handling.

API authorization matrix:

- Role × endpoint × action × object scope, with positive and negative tests for employee, manager, HR, inactive, anonymous, cross-employee, non-direct-report, stale-assignee, and self-approval cases.
- Verify lists, details, events, attachments, search, filters, counts, dashboard, and CSV outputs independently; object URLs must not bypass list scope.
- Verify CSRF rejection, session cookie flags, login/logout/inactive behavior, rate limits [ASSUMPTION], error non-disclosure, idempotency, pagination limits, and deterministic ordering.

Database/integration tests:

- Migration from empty database, PostgreSQL constraints, concurrent transition tests with row locks, query-count assertions for manager/HR pages, and audit/history atomicity.
- Test notification publication only after commit and safe retry of worker jobs [ASSUMPTION].

Frontend and browser tests:

- React component/form/query tests for loading, empty, error, validation, disabled, success, keyboard, mobile, Arabic RTL, English LTR, and all appearance modes.
- Real-browser journeys: login, employee request submit/return/resubmit, manager decision, HR-scoped oversight/export, timesheet correction, unauthorized URL/filter/attachment attempts, and theme application before main UI render.
- Accessibility automation plus keyboard-only verification; do not treat automated checks as a substitute for manual keyboard and screen-reader review.

Security/release gates:

- Dependency and secret scanning, static analysis, OpenAPI review, migration review, CSP/header verification, backup/restore rehearsal [ASSUMPTION], and deployment smoke tests.
- QA is read-only and a merge gate. A security-sensitive change is blocked when scope, state, audit, attachment, or CSRF tests are absent or failing.
- Record exact commands and real results in the delivery artifact; no test pass is implied by this design document.

## 13. Deployment boundary and operations

MVP production boundary [ASSUMPTION pending target approval]:

```text
Browser
  -> HTTPS reverse proxy / static assets
  -> Django application (ASGI/WSGI)
  -> private PostgreSQL
  -> private object storage for attachments
  -> optional worker/queue for post-commit notifications and reports
```

Rules:

- Only the reverse proxy is public. PostgreSQL, worker, queue, and object storage are private-network services.
- Django owns migrations and application release compatibility. Run migrations as an explicit release step with backup/rollback planning; do not let every web replica race to migrate.
- Keep secrets in the approved environment/secret store, never Git, schema examples, logs, browser bundles, or assistant prompts.
- Separate local, CI, staging, and production credentials/data. No coding agent or test environment may use production data or production database credentials.
- Health endpoints distinguish process liveness from dependency readiness and reveal no secrets. Readiness checks use bounded timeouts.
- Centralize structured logs with request/correlation ids, redact sensitive fields, and monitor auth failures, permission denials, upload rejects, transition conflicts, queue failures, and unusual exports/downloads.
- Backups must be encrypted and restoration tested [ASSUMPTION]. Define RPO/RTO, retention, incident response, and data deletion policy before production approval.
- Deployment target, TLS/certificate ownership, object storage provider, queue choice, scaling target, demo seed accounts, and production data residency are open [ASSUMPTION].

## 14. Threat model

| Threat / abuse case | Impact | Primary controls | Residual risk / follow-up |
|---|---|---|---|
| IDOR through guessed request/timesheet/attachment/event id | Employee data disclosure or unauthorized decision | Scoped query services before lookup, object checks, opaque ids, negative tests on all surfaces | A missed endpoint or export path remains a high-severity risk; security review blocks release |
| Manager accesses non-direct report by filter or changed reporting line | Confidentiality and improper approval | Server-derived scope, submission reviewer snapshot, no client role/scope input, reporting-line constraints | Hierarchy and reassignment policy unresolved [ASSUMPTION] |
| HR visibility becomes unrestricted mutation or self-approval | Unauthorized personnel action | Separate view/edit/approve capabilities, explicit substitution policy, self-approval denial, audit | HR authority limits require approval |
| Client forges state, HR-routing flag, reviewer, or version | Workflow bypass/data corruption | Named service commands, server policy lookup, locked rows, version checks, immutable fields | Future integrations must use same service boundary |
| CSRF/session theft or login abuse | Account takeover | Same-origin Secure/HttpOnly/SameSite sessions, CSRF middleware, TLS, rotation, expiry, rate controls | MFA/SSO deferred; residual credential-phishing risk |
| XSS via request details, filenames, or translations | Session/data theft | Output encoding, CSP, safe filename display, no unsafe HTML, dependency review | Rich text is not approved; if added, sanitize and review |
| Malicious attachment / polyglot / decompression bomb | Malware or service compromise | Allowlist plus content sniffing, size/quota limits, quarantine/scanning, private storage, download disposition | Scanner/provider and retention policy unresolved |
| SQL/filter abuse or expensive exports | Data leakage/DoS | Typed filter allowlist, bounded pagination, indexes/query budgets, scoped exports, rate limits | Capacity thresholds need measurement |
| Concurrent approvals or edits | Double decision/history inconsistency | `atomic`, `select_for_update`, version checks, legal transition re-check, idempotency | Load/concurrency tests required |
| Audit tampering or incomplete history | Loss of accountability | Same-transaction append-only events, fail-closed critical audit, DB privilege separation | No independent WORM sink in MVP [ASSUMPTION] |
| Sensitive data in logs/backups/analytics | Privacy breach | Redaction, data minimization, private backups, no production data in test/agents | Retention/residency policy open |
| Assistant prompt/tool abuse (later) | Unauthorized read/write or data exfiltration | Django service tools, per-call authz/scope, confirmation for risky writes, tool-call audit, no direct DB | Assistant excluded from MVP; tool catalog and provider controls open |
| Theme/locale endpoint used to mutate arbitrary fields | Account/profile tampering | Strict serializer allowlist and dedicated preference permission | Preference placement is an implementation choice [ASSUMPTION] |
| Deployment misconfiguration/public database or storage | Broad compromise | Private network, security headers, secret hygiene, readiness checks, release review | Target and infrastructure controls pending |

Severity convention: any cross-user read/write, unauthorized workflow transition, public attachment exposure, or audit bypass is release-blocking until fixed and retested.

## 15. ADRs / explicit decisions

### ADR-001: Use a Django modular monolith

Decision: one Django project with domain apps, DRF APIs, PostgreSQL, and React as the client.

Rationale: Django provides the required authentication, ORM, migrations, admin/configuration foundation, transactions, and server authority without premature service boundaries.

Trade-off: modules share a process and database; strict dependency conventions and architecture tests are needed. Revisit only when a measured scaling or isolation requirement exists.

### ADR-002: Django services are the workflow authority

Decision: all state transitions are named transactional services using scoped lookup, row locks, version checks, event append, audit, and post-commit side effects.

Rationale: prevents UI, serializer, job, and future assistant paths from implementing divergent rules.

Trade-off: more explicit code and service tests than model-admin shortcuts; this is accepted for integrity and reviewability.

### ADR-003: Same-origin Django sessions, not browser JWT storage

Decision: use Django session cookies with CSRF protection.

Rationale: first-party web app and Django authority; reduces token exposure in JavaScript storage.

Trade-off: deployment must preserve same-origin/CSRF configuration and session infrastructure. SSO/MFA are deferred and are residual account-takeover risks.

### ADR-004: Scope querysets explicitly; object permissions are defense in depth

Decision: each list/detail/export/dashboard/attachment/event path uses an explicit principal-derived queryset/scope service.

Rationale: DRF object permissions do not automatically filter list querysets, counts, or exports.

Trade-off: repeated policy wiring requires shared helpers and negative tests; it avoids silent data leakage.

### ADR-005: Append-only domain history plus security audit stream

Decision: retain user-visible RequestEvent/TimesheetEvent and a cross-cutting AuditRecord stream.

Rationale: workflow explanation and security/compliance evidence have different audiences and retention concerns.

Trade-off: duplicate metadata and storage; atomic writes and separate redaction/retention policy are required.

### ADR-006: Private, Django-authorized attachment delivery

Decision: attachments are private objects with generated keys, validation/quarantine, and fresh parent-scope checks on download.

Rationale: employee requests can contain sensitive documents; public media URLs and filename-based paths are unacceptable.

Trade-off: download handling and scanning add operational cost. Launch is blocked until A6 is approved.

### ADR-007: Persist appearance enum server-side

Decision: persist only `system`, `light`, or `dark` for signed-in users and bootstrap it before the main UI renders.

Rationale: meets the product/constitution requirement and avoids wrong-theme flash while keeping OS resolution a client presentation concern.

Trade-off: unauthenticated preference reconciliation and first-paint plumbing add complexity; no arbitrary theme customization is supported.

### ADR-008: Keep assistant out of MVP and behind Django tools later

Decision: no assistant implementation in this phase. When added, it calls existing Django services, with per-tool authorization, confirmation for risky writes, and complete tool-call audit.

Rationale: assistant is late scope and must not create a second business authority.

Trade-off: voice/realtime scaling is deferred; an optional gateway cannot own business decisions.

## 16. Open questions and approval gates

The following are intentionally unresolved and marked [ASSUMPTION]; they require product/user approval before the affected implementation contract is finalized:

1. [ASSUMPTION] Confirm that manager scope is direct reports only, or approve descendant hierarchy and its cycle/query semantics.
2. [ASSUMPTION] For each launch RequestType, confirm whether manager-first review and HR review are required; define no-manager, inactive-reviewer, manager-change, manager/HR requester, HR-substitution, and self-approval behavior.
3. [ASSUMPTION] Confirm cancellation after submission, terminal timesheet rejection, and who may reopen approved records, from which states, with what reason and audit controls.
4. [ASSUMPTION] Approve week start, authoritative timezone, overnight/DST behavior, breaks, daily maximum, rounding, overlap rules, and whether zero-minute entries are allowed.
5. [ASSUMPTION] Approve attachment types, maximum sizes/counts, malware scanning provider, private download rights, mutation after submit/return, retention/deletion/legal hold, and encryption/key ownership.
6. [ASSUMPTION] Define HR authority limits: organization visibility versus edit, reviewer substitution, approval on behalf of a manager, and employee-record correction.
7. [ASSUMPTION] Confirm profile fields, employee-data retention, locale endpoint shape, and whether preferences belong on User or a separate UserPreference model.
8. [ASSUMPTION] Approve API envelope/idempotency conventions, disclosure choice for out-of-scope object ids (`404` versus `403`), rate-limit thresholds, and asynchronous export behavior.
9. [ASSUMPTION] Provide the missing approved UX direction: tokens, component behavior, copy, RTL/LTR details, first-paint theme bootstrap, and accessibility acceptance criteria.
10. [ASSUMPTION] Confirm deployment target, TLS/secret/attachment storage providers, queue/worker need, backup/RPO/RTO, residency, demo accounts, and staging boundaries.
11. [ASSUMPTION] Confirm whether independent immutable audit export/WORM storage is required for the pilot or can remain deferred.
12. [ASSUMPTION] Confirm the constitution and product brief approval status. No implementation work should begin while the stated approval gate remains open.

## 17. Handoff

Objective: obtain approval of this architecture/security artifact together with the constitution, product brief, UX direction, permission matrix, state machines, and the open policies above before implementation.

Files/artifacts: `_bmad-output/planning-artifacts/architecture/architecture-security.md`.

Evidence: source files were read from the project workspace and Team Rules were read from the project profile; no application code, deployment, or test-pass claim is made.

Risks/open questions: authorization scope, workflow routing, time policy, attachments, HR authority, missing UX approval, and deployment controls remain the primary release risks.

Next owner: product_lead/user for policy approvals; ux_brand_designer for the missing UX artifact; backend_engineer and frontend_engineer only after the contracts are approved; qa_reviewer for read-only security and journey gates; release_operator for deployment boundary and rollback evidence.

OBSERVATION: The requested source set contains no approved UX artifact and the available brief/constitution remain draft → keep this solutioning artifact explicitly provisional and require UX plus policy approval before implementation or security sign-off.
