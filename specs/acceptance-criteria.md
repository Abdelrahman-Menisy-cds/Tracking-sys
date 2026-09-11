---
title: "Heya Fawda? — Acceptance Criteria"
status: approved
user_approval_date: 2026-09-11
traceability: [prd.md, specs/permission-matrix.md, specs/request-state-machine.md, specs/timesheet-state-machine.md, _bmad-output/planning-artifacts/product/product-policy-decisions.md, specs/constitution.md, _bmad-output/planning-artifacts/ux/ux-brand-direction.md, _bmad-output/planning-artifacts/architecture/architecture-security.md]
---

AC-01 Authentication: valid active users sign in/out; invalid credentials are generic; inactive users cannot authenticate or mutate; session cookies are Secure/HttpOnly/CSRF-protected.

AC-02 Authorization: for every endpoint and UI surface, Employee sees only own records, Manager only active direct reports for review, and HR only explicitly granted organization capabilities. Cross-user URL, filter, count, dashboard, event, attachment, and export access returns safe denial with no leakage.

AC-03 Requests: authorized users can create/edit drafts, attach only PDF/PNG/JPG/DOCX within 10MB/file, 5 files/request, 25MB/request, and submit only after clean scans. Pending/quarantined files cannot download or support approval; submitted/decided attachments are immutable; returned attachments may be replaced.

AC-04 Request workflow: all legal transitions match request-state-machine.md; illegal/stale/concurrent transitions fail safely; reject/return requires non-blank comment; manager snapshot and HR routing are server-derived; no self-approval; every transition has append-only event and audit.

AC-05 Requests: requester may cancel only before a decision, with confirmation and audit; no request reopen; no-manager and inactive/missing-reviewer behavior matches the approved policy.

AC-06 Timesheets: one weekly container per employee/week; Monday–Sunday organization timezone; daily duration minutes and unpaid breaks; no rounding; max 24h/day and 168h/week; invalid/negative/overlap/out-of-week values rejected; submitted/approved read-only.

AC-07 Timesheet workflow: all legal transitions match timesheet-state-machine.md; rejection is terminal and creates a replacement workflow; Returned can be corrected/resubmitted; HR-only reopen becomes Returned with reason, confirmation, and audit; histories remain append-only.

AC-08 Scope-consistent reporting: identical authorized filters produce identical list, totals, dashboard, and CSV scope; exports are synchronous only through 10,000 rows, rate-limited, audited, and protected from formula injection; larger exports receive a clear limit error.

AC-09 API contract: localized versioned JSON errors contain stable code, message, field errors, and request ID; use 401/403/404/409/422/429 as specified; Idempotency-Key is required for submit, decide, cancel, reopen, and upload, with differing payload reuse returning 409.

AC-10 Localization and UX: Arabic is first-visit default with complete English parity; RTL/LTR, Gregorian dates, Arabic/Latin numeric input, keyboard, mobile, loading, empty, error, validation, disabled, success, and conflict states work without disclosure or false success. System/light/dark preference persists server-side and applies before main UI render; target WCAG 2.2 AA.

AC-11 Audit and retention: authentication failures, authorization failures, role/reporting changes, attachment access, exports, and every workflow transition record actor, subject, UTC timestamp, reason/comment, request ID, and before/after state; records are append-only and retained seven years; scoped audit export is HR-only.

AC-12 Delivery gates: backend/frontend focused tests, negative authorization tests, real-browser critical journeys in both locales/directions, accessibility checks, migration-from-empty, and deployment smoke tests are required before implementation release. This artifact records requirements, not executed test results or deployment approval.
