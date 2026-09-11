---
title: "Heya Fawda? — Request State Machine"
status: approved
user_approval_date: 2026-09-11
traceability: [prd.md, _bmad-output/planning-artifacts/product/product-policy-decisions.md, specs/constitution.md]
---

States: DRAFT, PENDING_MANAGER, PENDING_HR, APPROVED, REJECTED, RETURNED, CANCELLED.

Transitions:
- DRAFT -> PENDING_MANAGER when submission has a manager snapshot and type requires manager review.
- DRAFT -> PENDING_HR for approved HR-only types.
- DRAFT -> CANCELLED by requester before decision, with confirmation and audit.
- PENDING_MANAGER -> PENDING_HR when manager approves and type requires HR.
- PENDING_MANAGER -> APPROVED when manager approves and HR is not required.
- PENDING_MANAGER -> REJECTED or RETURNED by authorized manager; comment required.
- PENDING_HR -> APPROVED, REJECTED, or RETURNED by authorized HR; comment required for reject/return.
- RETURNED -> PENDING_MANAGER or PENDING_HR after requester edits and resubmits according to the stored routing policy.
- RETURNED -> CANCELLED by requester while policy permits.
- PENDING_MANAGER/PENDING_HR -> CANCELLED by requester before decision, with confirmation and audit.

No transitions from APPROVED, REJECTED, or CANCELLED. No request reopen in MVP. Manager is snapshotted at submission; changed managers affect future submissions only. Missing/inactive reviewer is flagged to HR and not silently rerouted. HR substitution is explicit, reasoned, audited. Every transition is append-only, transactional, actor/timestamp/from/to recorded, and protected by authorization, version, and idempotency checks.
