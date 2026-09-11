---
title: "هي فوضى؟ / Heya Fawda? — Product Policy Decisions"
status: proposed-pending-user-approval
owner: product_lead
scope: Tracking-sys only
---

Purpose
This artifact resolves the open business-policy questions identified in the product brief, UX direction, architecture-security artifact, and constitution. Every item is a proposal, not an approval, and must be explicitly accepted or amended by the user before becoming an implementation contract.

Evidence and constraints
The product is an Arabic-first bilingual employee-operations application, not payroll, ERP, biometric attendance, or a generic workflow builder. Django is the server authority; manager scope, object access, exports, transitions, and audit are server-enforced. Histories are append-only, time is stored as canonical minutes, and submitted/approved timesheets are immutable except for an explicit audited reopen. The PDF is input, not unquestionable policy. The referenced master-plan path in PROJECT_CONTEXT could not be read at /home/menisy/.hermes/plans/2026-09-10_021026-employee-operations-blueprint.md; proposals below therefore rely on the available artifacts and are explicitly provisional.

1. Request approval routing and manager/HR edge cases
[PROPOSED — USER APPROVAL REQUIRED] Route employee requests to the manager captured at submission; each RequestType declares whether manager approval, HR approval, or both are required. Manager approval precedes HR when both are required; HR approval is final only when configured.
[PROPOSED — USER APPROVAL REQUIRED] No manager: submission is blocked with an actionable HR-admin queue, except HR may configure an approved HR-only type. Inactive/missing reviewer: preserve the snapshot, flag the item to HR, and do not silently reroute.
[PROPOSED — USER APPROVAL REQUIRED] A manager cannot self-approve; a requester's own request is excluded from their review queue. HR may substitute for a manager only through an explicit HR action, with reason and audit event. Changing a manager affects future submissions, not existing snapshots.
Trade-off: snapshots preserve accountability and prevent moving-target approvals; escalation increases HR operational responsibility.

2. Direct-report scope
[PROPOSED — USER APPROVAL REQUIRED] Managers may review only active direct reports, not the whole hierarchy. HR visibility is organization-wide but action permissions remain separately gated. No role-switcher or inherited hierarchy scope in MVP.
Trade-off: least privilege and simpler tests versus less convenience for senior managers.

3. Cancellation, terminal timesheet rejection, reopen
[PROPOSED — USER APPROVAL REQUIRED] Employees may cancel request drafts and submitted requests only before a decision; cancellation is unavailable after approval/rejection and requires confirmation plus audit history. Reviewers cannot erase history.
[PROPOSED — USER APPROVAL REQUIRED] Timesheets support Draft, Submitted, Returned, Approved, and Rejected. Manager rejection is terminal, requires a reason, and creates a new replacement timesheet workflow for that employee/week; the rejected record remains read-only.
[PROPOSED — USER APPROVAL REQUIRED] Reopen is unavailable to employees. HR may reopen an Approved or Rejected timesheet only with a mandatory reason, explicit confirmation, and append-only audit event; reopened records become Returned and retain all prior history. No reopen for requests in MVP.
Trade-off: terminal records protect payroll-adjacent auditability; replacement/reopen add operational steps but avoid destructive edits.

4. Week, timezone, overnight, breaks, rounding, limits, overlap
[PROPOSED — USER APPROVAL REQUIRED] Week runs Monday 00:00 through Sunday 23:59:59 in the organization timezone; organization timezone is authoritative and shown in UI/reports. Store UTC instants plus canonical integer minutes.
[PROPOSED — USER APPROVAL REQUIRED] MVP accepts duration-per-day entries only; overnight shifts are not supported. Breaks are entered as unpaid break minutes and excluded from worked minutes; no automatic deduction.
[PROPOSED — USER APPROVAL REQUIRED] No rounding: preserve entered minutes. Daily worked limit is 24 hours, weekly limit is 168 hours, with configurable tighter organizational limits deferred. Negative values, invalid dates, duplicate weeks, and overlapping interval entries are rejected; duration-only entries cannot overlap, so overlap validation applies if interval mode is later enabled.
Trade-off: duration-only/no-rounding is predictable and DST-safe, but cannot model cross-midnight attendance precisely.

5. Attachments
[PROPOSED — USER APPROVAL REQUIRED] Allow PDF, PNG, JPG, and DOCX only; reject executables, archives, scripts, and unknown MIME types. Maximum 10 MB per file, 5 files per request, 25 MB total per request.
[PROPOSED — USER APPROVAL REQUIRED] Scan every upload asynchronously for malware; quarantine until clean. Failed or pending files cannot be downloaded or used for approval. Retain attachments with the request for 7 years, then purge subject to legal-hold capability; no legal hold UI in MVP.
[PROPOSED — USER APPROVAL REQUIRED] Employee, authorized reviewers in the request scope, and HR with attachment-view capability may download through short-lived Django-authorized URLs. No public URLs; returned requests may replace attachments, while submitted/decided attachments are immutable.
Trade-off: conservative types and private downloads reduce risk but limit convenience and impose storage/scanning cost.

6. HR authority
[PROPOSED — USER APPROVAL REQUIRED] HR is an application role, not superuser. HR administers employees, active accounts, reporting lines, request types, and organization-scoped read access. HR decisions exist only where the request type grants them; HR cannot self-approve, bypass required comments, or edit histories.
Trade-off: separates business authority from technical break-glass access, but requires explicit capability checks.

7. Profile fields, locales, preferences
[PROPOSED — USER APPROVAL REQUIRED] Employee self-edit: display name, preferred locale, appearance, timezone display preference, and notification-read state. HR-only: employee number, department, job title, manager, role, active status. Email/identifier is immutable in MVP except through an HR-admin process.
[PROPOSED — USER APPROVAL REQUIRED] Arabic is first-visit default; English is complete parity. Persist locale and theme server-side for signed-in users; anonymous preference may be local. Support RTL/LTR, Gregorian calendar, Arabic/Latin numeric input, and system/light/dark themes.
Trade-off: limited self-service protects authoritative organization data; bilingual parity increases content and QA workload.

8. API errors, idempotency, rate limits, exports
[PROPOSED — USER APPROVAL REQUIRED] Use one versioned JSON error envelope with stable code, localized message, field errors, request ID, and no sensitive detail. Use 401 for unauthenticated, 403 for unauthorized, 404 for inaccessible objects, 409 for state/conflict/duplicate-week, 422 for validation, and 429 for throttling.
[PROPOSED — USER APPROVAL REQUIRED] Require an Idempotency-Key for POST commands that submit, decide, cancel, reopen, or upload; same key and payload returns the original result, differing payload returns 409. Rate-limit authentication, uploads, exports, and mutating commands; initial defaults: auth 10/min/IP, mutations 60/min/user, exports 5/hour/user, uploads 20/hour/user.
[PROPOSED — USER APPROVAL REQUIRED] CSV exports are synchronous up to 10,000 rows, scoped by the same authorization query; larger exports are rejected in MVP with a clear limit message. Export actions are audited.
Trade-off: deterministic retries and limits improve safety, while synchronous export keeps MVP simple but caps scale.

9. Theme policy
[PROPOSED — USER APPROVAL REQUIRED] Keep constitution policy: system default follows prefers-color-scheme; signed-in users may select light or dark; system/light/dark persists server-side and bootstraps before main UI to avoid flash. All modes meet accessibility contrast and RTL/LTR parity.
Trade-off: system default respects user environment; explicit persistence requires authenticated bootstrap handling.

10. Deployment, staging, demo, backup
[PROPOSED — USER APPROVAL REQUIRED] Provide separate local, staging, and production environments; staging uses non-production data and is the only pre-release integration target. Production deployment requires explicit approval, health checks, migration review, rollback plan, and release evidence.
[PROPOSED — USER APPROVAL REQUIRED] Provide seeded demo data only in local/staging, clearly synthetic, with Employee/Manager/HR demo accounts managed as secrets; never seed demo accounts in production.
[PROPOSED — USER APPROVAL REQUIRED] PostgreSQL daily encrypted backups, 30-day retention, restore verification monthly; private attachment storage versioning and daily backup, with documented recovery targets deferred until sponsor approval.
Trade-off: isolation and backups reduce release/data risk but add operational cost and secrets management.

11. Audit retention/export
[PROPOSED — USER APPROVAL REQUIRED] Audit authentication, authorization failures, role/reporting-line changes, attachment access, exports, and every workflow transition with actor, subject, timestamp UTC, reason/comment, request ID, and before/after state. Audit records are append-only and cannot be edited through the app.
[PROPOSED — USER APPROVAL REQUIRED] Retain audit records 7 years. HR may export organization-scoped audit CSV; employees may not export audit logs; managers may export only records within their permitted scope. Export itself is audited.
Trade-off: seven years supports accountability and investigations but increases privacy/storage obligations.

12. Final constitution/product brief status
[PROPOSED — USER APPROVAL REQUIRED] Upon explicit acceptance of this artifact and any amendments, mark constitution and product brief Approved, update their status/decision references without changing their substantive approved baseline, and create the PRD/state machines/permission matrix as the next product contract. Until then, implementation remains blocked and existing artifacts remain unchanged.
Trade-off: a single explicit gate prevents accidental implementation from provisional assumptions, at the cost of one approval cycle.

Approval checklist
[ ] 1 Routing and edge cases
[ ] 2 Direct-report scope
[ ] 3 Cancellation/rejection/reopen
[ ] 4 Time policy
[ ] 5 Attachments
[ ] 6 HR authority
[ ] 7 Profile/locales/preferences
[ ] 8 API/idempotency/limits/exports
[ ] 9 Theme
[ ] 10 Environments/demo/backups
[ ] 11 Audit retention/export
[ ] 12 Constitution and brief status

Next handoff
Objective: obtain explicit user decisions, then reconcile the approved policy into the PRD, permission matrix, state machines, and testable acceptance criteria. Files/artifacts: this policy artifact plus existing brief, UX, architecture-security, and constitution. Risks: unresolved master-plan path and all proposals above. Next owner: user for approval; then product_lead for contract reconciliation, architect_security for authority/security review, ux_brand_designer for bilingual behavior, and qa_reviewer for read-only verification planning.

OBSERVATION: The master-plan path referenced by PROJECT_CONTEXT is absent from the current filesystem location → restore or point to the authoritative plan before final contract reconciliation; no existing approved artifact was silently edited.
