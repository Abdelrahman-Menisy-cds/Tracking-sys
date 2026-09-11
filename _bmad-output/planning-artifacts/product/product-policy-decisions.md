---
title: "هي فوضى؟ / Heya Fawda? — Product Policy Decisions"
status: approved
owner: product_lead
scope: Tracking-sys only
---

Purpose
This artifact resolves the open business-policy questions identified in the product brief, UX direction, architecture-security artifact, and constitution. Every item was a proposal until the user explicitly approved all proposed policies on 2026-09-11. The decisions below are now the implementation policy baseline for Tracking-sys.

Evidence and constraints
The product is an Arabic-first bilingual employee-operations application, not payroll, ERP, biometric attendance, or a generic workflow builder. Django is the server authority; manager scope, object access, exports, transitions, and audit are server-enforced. Histories are append-only, time is stored as canonical minutes, and submitted/approved timesheets are immutable except for an explicit audited reopen. The PDF is input, not unquestionable policy. The authoritative master plan is available at `.hermes/plans/2026-09-10_021026-employee-operations-blueprint.md` in this workspace. The policies below supersede its previously open business-policy questions.

1. Request approval routing and manager/HR edge cases
[APPROVED — USER ACCEPTED 2026-09-11] Route employee requests to the manager captured at submission; each RequestType declares whether manager approval, HR approval, or both are required. Manager approval precedes HR when both are required; HR approval is final only when configured.
[APPROVED — USER ACCEPTED 2026-09-11] No manager: submission is blocked with an actionable HR-admin queue, except HR may configure an approved HR-only type. Inactive/missing reviewer: preserve the snapshot, flag the item to HR, and do not silently reroute.
[APPROVED — USER ACCEPTED 2026-09-11] A manager cannot self-approve; a requester's own request is excluded from their review queue. HR may substitute for a manager only through an explicit HR action, with reason and audit event. Changing a manager affects future submissions, not existing snapshots.
Trade-off: snapshots preserve accountability and prevent moving-target approvals; escalation increases HR operational responsibility.

2. Direct-report scope
[APPROVED — USER ACCEPTED 2026-09-11] Managers may review only active direct reports, not the whole hierarchy. HR visibility is organization-wide but action permissions remain separately gated. No role-switcher or inherited hierarchy scope in MVP.
Trade-off: least privilege and simpler tests versus less convenience for senior managers.

3. Cancellation, terminal timesheet rejection, reopen
[APPROVED — USER ACCEPTED 2026-09-11] Employees may cancel request drafts and submitted requests only before a decision; cancellation is unavailable after approval/rejection and requires confirmation plus audit history. Reviewers cannot erase history.
[APPROVED — USER ACCEPTED 2026-09-11] Timesheets support Draft, Submitted, Returned, Approved, and Rejected. Manager rejection is terminal, requires a reason, and creates a new replacement timesheet workflow for that employee/week; the rejected record remains read-only.
[APPROVED — USER ACCEPTED 2026-09-11] Reopen is unavailable to employees. HR may reopen an Approved or Rejected timesheet only with a mandatory reason, explicit confirmation, and append-only audit event; reopened records become Returned and retain all prior history. No reopen for requests in MVP.
Trade-off: terminal records protect payroll-adjacent auditability; replacement/reopen add operational steps but avoid destructive edits.

4. Week, timezone, overnight, breaks, rounding, limits, overlap
[APPROVED — USER ACCEPTED 2026-09-11] Week runs Monday 00:00 through Sunday 23:59:59 in the organization timezone; organization timezone is authoritative and shown in UI/reports. Store UTC instants plus canonical integer minutes.
[APPROVED — USER ACCEPTED 2026-09-11] MVP accepts duration-per-day entries only; overnight shifts are not supported. Breaks are entered as unpaid break minutes and excluded from worked minutes; no automatic deduction.
[APPROVED — USER ACCEPTED 2026-09-11] No rounding: preserve entered minutes. Daily worked limit is 24 hours, weekly limit is 168 hours, with configurable tighter organizational limits deferred. Negative values, invalid dates, duplicate weeks, and overlapping interval entries are rejected; duration-only entries cannot overlap, so overlap validation applies if interval mode is later enabled.
Trade-off: duration-only/no-rounding is predictable and DST-safe, but cannot model cross-midnight attendance precisely.

5. Attachments
[APPROVED — USER ACCEPTED 2026-09-11] Allow PDF, PNG, JPG, and DOCX only; reject executables, archives, scripts, and unknown MIME types. Maximum 10 MB per file, 5 files per request, 25 MB total per request.
[APPROVED — USER ACCEPTED 2026-09-11] Scan every upload asynchronously for malware; quarantine until clean. Failed or pending files cannot be downloaded or used for approval. Retain attachments with the request for 7 years, then purge subject to legal-hold capability; no legal hold UI in MVP.
[APPROVED — USER ACCEPTED 2026-09-11] Employee, authorized reviewers in the request scope, and HR with attachment-view capability may download through short-lived Django-authorized URLs. No public URLs; returned requests may replace attachments, while submitted/decided attachments are immutable.
Trade-off: conservative types and private downloads reduce risk but limit convenience and impose storage/scanning cost.

6. HR authority
[APPROVED — USER ACCEPTED 2026-09-11] HR is an application role, not superuser. HR administers employees, active accounts, reporting lines, request types, and organization-scoped read access. HR decisions exist only where the request type grants them; HR cannot self-approve, bypass required comments, or edit histories.
Trade-off: separates business authority from technical break-glass access, but requires explicit capability checks.

7. Profile fields, locales, preferences
[APPROVED — USER ACCEPTED 2026-09-11] Employee self-edit: display name, preferred locale, appearance, timezone display preference, and notification-read state. HR-only: employee number, department, job title, manager, role, active status. Email/identifier is immutable in MVP except through an HR-admin process.
[APPROVED — USER ACCEPTED 2026-09-11] Arabic is first-visit default; English is complete parity. Persist locale and theme server-side for signed-in users; anonymous preference may be local. Support RTL/LTR, Gregorian calendar, Arabic/Latin numeric input, and system/light/dark themes.
Trade-off: limited self-service protects authoritative organization data; bilingual parity increases content and QA workload.

8. API errors, idempotency, rate limits, exports
[APPROVED — USER ACCEPTED 2026-09-11] Use one versioned JSON error envelope with stable code, localized message, field errors, request ID, and no sensitive detail. Use 401 for unauthenticated, 403 for unauthorized, 404 for inaccessible objects, 409 for state/conflict/duplicate-week, 422 for validation, and 429 for throttling.
[APPROVED — USER ACCEPTED 2026-09-11] Require an Idempotency-Key for POST commands that submit, decide, cancel, reopen, or upload; same key and payload returns the original result, differing payload returns 409. Rate-limit authentication, uploads, exports, and mutating commands; initial defaults: auth 10/min/IP, mutations 60/min/user, exports 5/hour/user, uploads 20/hour/user.
[APPROVED — USER ACCEPTED 2026-09-11] CSV exports are synchronous up to 10,000 rows, scoped by the same authorization query; larger exports are rejected in MVP with a clear limit message. Export actions are audited.
Trade-off: deterministic retries and limits improve safety, while synchronous export keeps MVP simple but caps scale.

9. Theme policy
[APPROVED — USER ACCEPTED 2026-09-11] Keep constitution policy: system default follows prefers-color-scheme; signed-in users may select light or dark; system/light/dark persists server-side and bootstraps before main UI to avoid flash. All modes meet accessibility contrast and RTL/LTR parity.
Trade-off: system default respects user environment; explicit persistence requires authenticated bootstrap handling.

10. Deployment, staging, demo, backup
[APPROVED — USER ACCEPTED 2026-09-11] Provide separate local, staging, and production environments; staging uses non-production data and is the only pre-release integration target. Production deployment requires explicit approval, health checks, migration review, rollback plan, and release evidence.
[APPROVED — USER ACCEPTED 2026-09-11] Provide seeded demo data only in local/staging, clearly synthetic, with Employee/Manager/HR demo accounts managed as secrets; never seed demo accounts in production.
[APPROVED — USER ACCEPTED 2026-09-11] PostgreSQL daily encrypted backups, 30-day retention, restore verification monthly; private attachment storage versioning and daily backup, with documented recovery targets deferred until sponsor approval.
Trade-off: isolation and backups reduce release/data risk but add operational cost and secrets management.

11. Audit retention/export
[APPROVED — USER ACCEPTED 2026-09-11] Audit authentication, authorization failures, role/reporting-line changes, attachment access, exports, and every workflow transition with actor, subject, timestamp UTC, reason/comment, request ID, and before/after state. Audit records are append-only and cannot be edited through the app.
[APPROVED — USER ACCEPTED 2026-09-11] Retain audit records 7 years. HR may export organization-scoped audit CSV; employees may not export audit logs; managers may export only records within their permitted scope. Export itself is audited.
Trade-off: seven years supports accountability and investigations but increases privacy/storage obligations.

12. Final constitution/product brief status
[APPROVED — USER ACCEPTED 2026-09-11] Upon explicit acceptance of this artifact and any amendments, mark constitution and product brief Approved, update their status/decision references without changing their substantive approved baseline, and create the PRD/state machines/permission matrix as the next product contract. Until then, implementation remains blocked and existing artifacts remain unchanged.
Trade-off: a single explicit gate prevents accidental implementation from provisional assumptions, at the cost of one approval cycle.

Approval checklist
[x] 1 Routing and edge cases
[x] 2 Direct-report scope
[x] 3 Cancellation/rejection/reopen
[x] 4 Time policy
[x] 5 Attachments
[x] 6 HR authority
[x] 7 Profile/locales/preferences
[x] 8 API/idempotency/limits/exports
[x] 9 Theme
[x] 10 Environments/demo/backups
[x] 11 Audit retention/export
[x] 12 Constitution and brief status

Next handoff
Objective: obtain explicit user decisions, then reconcile the approved policy into the PRD, permission matrix, state machines, and testable acceptance criteria. Files/artifacts: this policy artifact plus existing brief, UX, architecture-security, and constitution. Risks: unresolved master-plan path and all proposals above. Next owner: user for approval; then product_lead for contract reconciliation, architect_security for authority/security review, ux_brand_designer for bilingual behavior, and qa_reviewer for read-only verification planning.

Decision record: the authoritative master plan was confirmed at `.hermes/plans/2026-09-10_021026-employee-operations-blueprint.md`; no path discrepancy remains.
