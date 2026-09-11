---
title: "Heya Fawda? — Timesheet State Machine"
status: approved
user_approval_date: 2026-09-11
traceability: [prd.md, _bmad-output/planning-artifacts/product/product-policy-decisions.md, specs/constitution.md]
---

States: DRAFT, SUBMITTED, RETURNED, APPROVED, REJECTED.

Transitions:
- DRAFT -> SUBMITTED by employee after server validation.
- SUBMITTED -> APPROVED by authorized manager/HR reviewer.
- SUBMITTED -> RETURNED by authorized reviewer with mandatory reason.
- SUBMITTED -> REJECTED by authorized manager/HR reviewer with mandatory reason; terminal and read-only.
- RETURNED -> SUBMITTED by employee after correction and validation.
- APPROVED -> RETURNED only through HR reopen with explicit confirmation, mandatory reason, and audit; terminal history is retained.

No employee cancellation. No employee reopen. Submitted and approved records are read-only except the authorized HR reopen. Weekly container is unique per employee/week; week is Monday–Sunday in organization timezone. Entries use daily duration minutes plus unpaid break minutes, no rounding, max 24 worked hours/day and 168/week; reject invalid, negative, overlapping, or out-of-week data. All transitions append immutable TimesheetEvent and audit records transactionally with locking, version checks, and idempotency.
