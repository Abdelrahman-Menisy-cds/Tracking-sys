---
title: "هي فوضى؟ / Heya Fawda? — Product Requirements Document"
status: approved
user_approval_date: 2026-09-11
owner: product_lead
traceability: [PROJECT_CONTEXT.md, specs/constitution.md, .hermes/plans/2026-09-10_021026-employee-operations-blueprint.md, _bmad-output/planning-artifacts/product/product-policy-decisions.md, briefs/brief-tracking_system_project-2026-09-11/brief.md, ux/ux-brand-direction.md, architecture/architecture-security.md]
---

# Product contract

Heya Fawda? is an Arabic-first bilingual employee-operations web application for requests, weekly timesheets, approvals, notifications, scoped reporting, and auditable histories. It is not payroll, ERP, biometrics, leave accrual, or a generic workflow builder.

## Users and value
Employee: manage own profile fields, requests, attachments, history, and timesheets. Manager: employee capabilities plus active direct-report review only. HR: organization-wide visibility and explicitly gated administration/configuration/decisions; HR is not Django superuser.

## MVP boundary
In: session authentication, inactive-account handling, profiles, server-enforced RBAC and scope, request CRUD/attachments/workflows, weekly duration-based timesheets, manager/conditional HR review, dashboards, search/filter/sort/pagination, in-app notifications, scoped CSV reports, OpenAPI/health endpoints, responsive accessible Arabic/English RTL/LTR UI, system/light/dark themes.
Out: payroll, biometrics, leave balances, email/SMS/push, SSO/MFA, native mobile, multi-tenancy, workflow builder, realtime sockets, advanced analytics, projects/cost codes, broad document management, assistant.

## Journeys
1. Employee signs in, creates a request, uploads permitted files, submits, tracks reviewer/status, and corrects/resubmits returned work.
2. Manager reviews only active direct reports and approves, rejects, or returns with a comment.
3. HR administers organization data and request types, handles explicitly authorized review/substitution, and exports scoped summaries.
4. Employee creates a Monday–Sunday weekly timesheet using daily duration and unpaid break minutes, submits, then corrects returned work.

## Business rules
Requests snapshot the manager at submission. RequestType controls manager/HR approval; manager precedes HR. No-manager submission is blocked except approved HR-only types; inactive/missing reviewer is flagged to HR, not silently rerouted. HR substitution requires explicit reason/audit. No self-approval. Employees cancel draft/submitted requests only before decision; requests have no MVP reopen. Timesheets have Draft, Submitted, Returned, Approved, Rejected; rejection is terminal and creates a replacement workflow. HR may reopen Approved/Rejected to Returned with reason, confirmation, and audit. Week is Monday–Sunday in organization timezone; duration-only entries, unpaid breaks excluded, no rounding, 24h/day and 168h/week maximums, invalid/negative/overlap/out-of-week/duplicate-week rejected. Attachments: PDF/PNG/JPG/DOCX; 10MB/file, 5/request, 25MB/request; async malware scan/quarantine; 7-year retention; immutable after submit/decision, replaceable when Returned; private authorized downloads.

## Non-functional contract
Django is authority for auth, scope, transitions, audit, and exports. Histories/audits append-only. Use transactional locked services, version checks, stable localized JSON errors, 401/403/404/409/422/429 semantics, required Idempotency-Key for submit/decide/cancel/reopen/upload, and stated rate limits. Arabic defaults first visit; English parity; Gregorian calendar; server-persisted locale/theme; theme bootstraps before main UI. WCAG 2.2 AA target and explicit loading/empty/error/validation/disabled/success/keyboard/mobile states.

## Success measures and assumptions
Assumption: one organization with established reporting lines. Measure completion, submission-to-decision time, and correction/resubmission rate; targets require sponsor agreement. No deployment or test-pass claim is made by this document.

## Handoff
Approved product contracts go to architect_security and ux_brand_designer; implementation remains governed by these contracts and QA read-only gates.

OBSERVATION: Requested repository-root TEAM_RULES.md was absent; profile Team Rules and binding session rules were used, without modifying shared guidance.
