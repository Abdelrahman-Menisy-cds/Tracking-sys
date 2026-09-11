# Heya Fawda? — Work Log

> Chronological, evidence-backed log for the Tracking-sys project only.
> Times use EEST (UTC+03:00). “Level” indicates delivery maturity, not effort.

## Level 0 — Project foundation

**Status:** Complete  
**Period:** 2026-09-10 02:27–02:58

- Existing GitHub repository integrated with the local workspace.
- Repository remote configured as `git@github.com:Abdelrahman-Menisy-cds/Tracking-sys.git`.
- Master project plan and decision log created.
- Project-local Python environment created with uv and Python 3.11.15.
- `.gitignore` and `.env.example` created.
- Host PostgreSQL availability verified.

**Evidence:** Git commits `8350158`, `0bf3008`, `660cfee`.

## Level 1 — Workflow and documentation baseline

**Status:** Complete  
**Period:** 2026-09-11 20:05–20:20

- BMAD BMM v6.12.0 installed project-locally and configured for Hermes.
- BMAD Core/BMM runtime committed under `_bmad/`; generated `_bmad-output/` ignored.
- 29 project-local BMAD skills installed under `.agents/skills`.
- Project context written.
- Draft constitution written with architecture, security, testing, accessibility, delivery, and Odoo-separation principles.

**Evidence:** Git commits `f683cc2`, `6db85f6`, `32145f1`.

## Level 2 — Dedicated agent team

**Status:** Complete  
**Period:** 2026-09-11 20:10–20:18

- Seven project-only Hermes profiles provisioned: Product Lead, UX and Brand Designer, Architect and Security Lead, Backend Engineer, Frontend Engineer, QA Reviewer, and Release Operator.
- Project-specific personas and `TEAM_RULES.md` created.
- Odoo-specific rules, memories, and skills removed from all project profiles.
- Project profiles configured with the assigned derouter or opencode-go model routes.
- Each profile returned `OK` in a live smoke test; replies were verified in the profile `state.db`.

**Evidence:** profile smoke-test sessions and profile `state.db` records on 2026-09-11.

## Level 3 — Product definition (current)

**Status:** In progress

Completed:

- Product identity fixed to **Heya Fawda?** (Franco rendering of «هي فوضى؟»).
- Arabic-first bilingual direction and original Egyptian-comedy-inspired brand direction established.
- Theme policy defined: System is the default; Light and Dark are user-selectable overrides.
- Initial actors, permission matrix, request/timesheet state-machine direction, MVP boundary, API outline, and test baseline captured in the master plan.

Remaining:

- Approve the constitution.
- Produce the BMAD product brief.
- Resolve open business rules: approvals, management scope, cancellation/reopen policy, timesheet policy, attachments, HR authority, localization library, deployment, and demo data.

## Level 4 — Solution design

**Status:** Approved baseline; open policy decisions remain before implementation authorization

Approval recorded from the user on 2026-09-11. The approval accepts the baseline direction, not unresolved business-policy assumptions.

Created:

- UX and brand direction: `_bmad-output/planning-artifacts/ux/ux-brand-direction.md` (332 lines; committed as `bfd565e`).
- Architecture and security design: `_bmad-output/planning-artifacts/architecture/architecture-security.md` (510 lines; committed as `e36a1cd`).

The artifacts define provisional UX flows, brand directions, theme behavior, Django boundaries, data/API/security design, threat controls, and verification scenarios. They remain provisional until the product brief, constitution, and unresolved business rules are approved.

Planned next: consolidate approved decisions into the PRD/spec artifacts and implementation backlog.

## Level 5 — Build and verification

**Status:** In progress — Stories 1.1–1.3 accepted; implementation continues

Level 5 readiness was validated on 2026-09-11: requirements are covered by five epics and implementation-ready stories.

Story 1.1 evidence:

- Secure Django session authentication with sign-in, sign-out, inactive-account handling, CSRF enforcement, Secure/HttpOnly cookies, login throttling, and active-session revocation on deactivation.
- Verification: targeted tests, Django checks, migration-drift check, compilation and whitespace checks passed; QA/code-quality verdict APPROVED.
- Commits: `10e77ab`, `5840e54`, `bbce908`, `d9cffd9`.

Story 1.2 evidence (accepted 2026-09-12):

- Profile/preferences (`GET/PATCH /api/v1/auth/me`) with allowlisted `full_name`, `preferred_locale` (`ar`/`en`), `appearance` (`system`/`light`/`dark`), and `timezone_display`; protected-field tampering rejected without mutation.
- Minimal scoped notifications app: recipient-only `GET /api/v1/notifications` (bounded pagination, max page size 20), `PATCH /api/v1/notifications/{id}` restricted to `is_read` with idempotent `read_at` timestamps.
- Shared API hardening: stable JSON error envelope with validated request IDs, API-scoped 404 envelope, `422` for serializer validation, mutation throttles at 60/min/user, login throttle 10/min/IP, middleware ordered before security redirects.
- Verification on acceptance: 31 tests passed; Django system checks passed; migration-drift check clean; `git diff --check` clean; reviews APPROVED.
- Commits: `ae97038`, `fbe4e7b`, `89337b8`, `626dea1`, `48994d9`, `7cc7d3e`, `337f88a`, `bdaeba5`.

Story 1.3 evidence (accepted 2026-09-12):

- HR-only employee administration under `/api/v1/employees`: bounded list (page size 20, max 50), retrieve, create, update; authoritative allowlist (`full_name`, `email`, `employee_number`, `job_title`, `role`, `manager`, `is_active`).
- Manager validation rejects self-management, missing/inactive managers, and reporting cycles with field-level errors and no partial save.
- Deactivation reuses `deactivate_user()` so active sessions are revoked; every create/update writes an append-only `AuditEvent` with actor, subject, UTC timestamp, request ID, and before/after values.
- App-layer duplicate validation: duplicate normalized email or `employee_number` returns field-level `422` instead of DB `IntegrityError` 500; DB unique indexes remain the backstop.
- Non-HR users receive the same 404-safe envelope as unknown IDs; no employee data disclosure; GET unthrottled, mutations at 60/min/user.
- Verification on acceptance: 53 tests passed (all suites; no regressions), 22 employee-admin tests; Django system check clean; migration-drift check clean; spec + code-quality gate APPROVED.
- Commits: `84e4341`, `25e6f53`.
- Known minor: a concurrent-create race can still surface an unhandled `IntegrityError` 500; deferred to a later hardening pass. HR-created accounts receive no usable password yet (issuance/reset is a separate story).

Story 2.1 evidence (accepted 2026-09-12):

- New `backend/reqs` app: `RequestType` (name/description/requires_hr_approval/is_active), `EmployeeRequest` (UUID pk, requester, request_type, title/details, 7-state status matching the approved machine, manager/assignee snapshot fields pre-laid, version), append-only `RequestEvent` (actor, action CREATED/EDITED, from/to status, comment, timestamp).
- Requester-only `/api/v1/requests`: create draft, bounded paginated list (max 50), detail, PATCH — edits allowed only in `DRAFT`/`RETURNED`; other states return `409 state_conflict` with no mutation and no event.
- Security/contract: protected server-managed fields → `422` per-field; inactive request type → `422`; cross-user access → `404`-safe envelope identical to missing; unauthenticated → `401`; mutations throttled 60/min/user, GET unthrottled; version bump on edit.
- Verification on acceptance: 70 tests passed (53 Story 1.x + 17 reqs, no regressions); Django system check clean; migration-drift check clean; `git diff --check` clean; spec + code-quality gate APPROVED.
- Commits: `12a4a2f`.
- Scope note: submission/attachments/decisions/cancel belong to Stories 2.2–2.5. Request-event history endpoint intentionally deferred. Minor cleanup candidates (dead ValueError catch, triplicated pagination classes) deferred.

Planned outputs: remaining Epic 2 stories (2.2 attachments, 2.3 submit, 2.4 decisions, 2.5 cancel), Epic 3 timesheets, React frontend, PostgreSQL schema on provisioned DB, unit/integration/browser tests, QA approval, CI, deployment readiness, and release evidence.

## Scope boundary

This log documents Tracking-sys only. It does not describe or govern any Odoo project.
