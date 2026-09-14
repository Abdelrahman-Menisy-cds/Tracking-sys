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

**Status:** In progress — Stories 1.1–5.1 accepted; implementation continues

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

Story 2.2 evidence (accepted 2026-09-12):

- Secure request attachments on `backend/reqs`: `RequestAttachment` (opaque UUID storage key, sanitized display filename, declared+detected content types, `scan_status`), plus upload idempotency records.
- Upload path (attach + replace): magic-number content sniffing (PDF/PNG/JPEG/DOCX) must agree with declared type and extension; quotas enforced (10 MB/file with pinned `DATA_UPLOAD`/`FILE_UPLOAD` caps, 5 files/request, 25 MB/request); `Idempotency-Key` required — same key+payload replays the original response, differing → `409`; separate `20/hour/user` upload throttle (mutations 60/min/user, GET unthrottled).
- Private storage: explicit `MEDIA_ROOT = BASE_DIR / "attachments"` (no `MEDIA_URL`, no public media route); opaque uuid paths read/written via `safe_join`; no public URLs ever — bytes only served by `AttachmentDownloadView`.
- Scan pipeline: pluggable scanner, deterministic dev stub (real AV integration deferred by plan-level agreement, separate story); quarantine until `CLEAN`; `PENDING`/`FAILED`/`REJECTED` downloads blocked with localized stable errors and audited blocked-download event, zero bytes exposed.
- State gating: attach/replace/delete only in `DRAFT`/`RETURNED`; submitted/decided attachments immutable (`409 state_conflict`, no file or event mutation); replacement swaps file within quotas.
- Every meaningful action (upload/replace/delete/download/blocked) writes the existing append-only `AuditEvent` with actor, subject, UTC timestamp, request ID, before/after.
- Verification on acceptance: 100 tests passed (70 prior + 30 attachments, no regressions); Django system check clean; migration-drift check clean; `git diff --check` clean; spec/security review findings (localized errors F1, pinned storage root F2, imports M1, safe_join M2) fixed and final gate APPROVED.
- Commits: `839d8b8`, `f1de7c9`, merge `a696f28`.
- Deferred: real AV vendor integration; view-layer English strings beyond service messages flagged for a future i18n pass.

Story 2.3 evidence (accepted 2026-09-12):

- `POST /api/v1/requests/{id}/submit` with required `Idempotency-Key`: same key+payload replays the stored response without duplicate transitions; differing payload → `409 idempotency_conflict`; stale version/conflicting state → `409`.
- Server-derived routing: manager snapshot read from `EmployeeProfile.manager` at submission (`manager_at_submission`), `current_assignee` set by routing, `RequestType.requires_manager_approval` drives `PENDING_MANAGER` vs `PENDING_HR` (HR-only types skip the manager requirement).
- Blocked paths audited (`request_submit_blocked`) with `422` field errors and zero mutation: no manager, inactive manager, non-`CLEAN` attachments, inactive request type. No silent rerouting. HR-queue visibility for blocked submissions deferred to Epic 4.
- Transactional 3-phase transition: resolution outside transactions so blocked-path audits persist; phase-3 `select_for_update` re-lock with status+version recheck; version bump; `SUBMITTED` RequestEvent + AuditEvent with actor/subject/UTC/request-id/before-after.
- Security review: no manager-identity disclosure to the requester; cross-user URL → uniform `404`; serializer rejects all non-version fields as protected; `get_throttles` correct; idempotency uniquely scoped, cannot replay across users/requests.
- Verification on acceptance: 128 tests passed (28 new submission tests; no regressions); Django checks clean; migration drift none; `git diff --check` clean; security review APPROVED.
- Commits: `af744c3`.
- Noted for later: resubmit routing re-derives from current RequestType config (mid-flight type reconfig edge case) — belongs to the Epic 4 story owning HR type config; Story 2.4 decide/cancel idempotency may scope lookups by user FK.

Story 2.4 evidence (accepted 2026-09-12):

- `POST /api/v1/requests/{id}/decision` supports `approve`, `reject`, and `return` with required `Idempotency-Key`; same-key/same-payload replay returns the stored response without duplicate transitions/events; differing payload conflicts safely.
- Authorization is checked under row lock: requester/self-decision is denied; only the active snapshot manager may decide `PENDING_MANAGER`; only active HR may decide `PENDING_HR`; unauthorized scope is 404-safe.
- Legal state-machine transitions are transactional, version-checked, row-locked, append-only (`APPROVED`/`REJECTED`/`RETURNED` events), audited, and terminal states reject further decisions with `409`.
- Reject/return require a bounded non-blank comment (`422` with no mutation). Notifications are scheduled after commit and scheduling failures are isolated/logged; later returned-and-resubmitted decisions can notify again.
- Verification on acceptance: 168 tests passed (40 decision-focused); Django check clean; migration drift none; diff check clean; final QA/security review APPROVED.
- Commits: `27ce924`, `fece9b0`, `1d3fd61`, `ac7c234`, merge `f482601`.

Story 2.5 evidence (accepted 2026-09-13):

- `POST /api/v1/requests/{id}/cancel` with required `Idempotency-Key`: same key+payload replays the stored response; differing payload → `409 idempotency_conflict`.
- Cancel allowed only for the requester from `DRAFT`/`RETURNED` while policy permits; terminal/decided states reject with `409 state_conflict`; cross-user access is 404-safe; transitions transactional, version-checked, append-only (`CANCELLED` RequestEvent + AuditEvent).

Planned outputs: Epic 3 timesheets, React frontend, PostgreSQL on provisioned DB, unit/integration/browser tests, QA approval, CI, deployment readiness, and release evidence.

- Verification on acceptance: final QA verdict APPROVED; 26 focused cancel tests; full suite previously at 194 passed; Django system check clean; migration-drift check had only the known local PostgreSQL authentication warning with no drift; `git diff --check` clean.
- Commits: implementation `d2aec09`, merge `2d6e9eb`.
- Next step: Story 3.1 — unique weekly timesheet and entries.

Story 3.1 evidence (accepted 2026-09-13):

- Unique weekly timesheets and entries: `Timesheet` container with unique `(employee, week_start)` singleton enforcement plus `TimeEntry` rows (work date, duration in minutes, description), created/list/detail APIs under `backend/timesheets`.
- Hardening pass: singleton-create and config races fixed under row locks (`a9f14b1`), merged via `f31a02f`.
- Verification on acceptance (final, in the project-local `.venv` on `main` at merge `f31a02f`): final QA verdict APPROVED; focused timesheet suite 30/30 passed; full suite 224 passed with no regressions (baseline 194 + 30 new); Django system check clean (`0 silenced`); migration-drift check `No changes detected` — SQLite clean, with only the known local PostgreSQL authentication warning (`fe_sendauth: no password supplied`) due to the missing local DB password, no drift; `git diff --check` clean.
- Commits: `0203ce6`, `e3c9cf4`, hardening `a9f14b1`, merge `f31a02f`.
- Next step: Story 3.2 — submit and correct a timesheet.

Story 3.2 evidence (accepted 2026-09-13):

- Submit and correct a weekly timesheet: status-locked submission of the `Timesheet` from `DRAFT`/`RETURNED` plus correction of a returned sheet by submitting a prospective corrected entry set; `TimeEntry` DB-level constraints (row locks) restored and API-level contract tests kept with separate ORM constraint tests in the hardening pass.
- Hardening pass: prospective corrected entry set validated before mutation; additional validation and re-added `TimeEntry` database constraints (`2f7c3bf`, `c525d5f`), merged via `9c24acf` as `main` HEAD.
- Verification on acceptance (final, in the project-local `.venv` on `main` at HEAD `9c24acf`): final QA verdict APPROVED; Story 3.2 focused suite 59/59 passed; Story 3.1 focused suite 30/30 passed; combined 89/89; full SQLite suite 287 passed with no regressions; Django system check clean with `config.test_settings`; migration 0006 applied and migration check clean; `git diff --check` clean.
- Commits: implementation `aa1169b`, merge `1ebe6fd`.
- Next step: Story 4.1 — scoped queues / details.

Story 3.3 evidence (accepted 2026-09-13):

- Timesheet review decisions: approve / reject / replace / reopen from the review side, with replacement entries after reject and HR reopen of an approved/returned sheet, under `backend/timesheets`.
- Authorization on decisions; legal state-machine transitions with locking, version checks, and idempotency keys; reject/return reasons, confirmation, and idempotency-key enforcement; replacement entry sets accepted only in the permitted states; HR reopen restores the returned/draft flow.
- Events and audit trail appended for every decision; read-only surfaces for decided sheets; notifications scheduled post-commit with failures isolated; auth/CSRF/throttle per platform baseline.
- Verification on acceptance (final, in the project-local `.venv` on `main` at HEAD `8b15913`): final QA verdict APPROVED; review tests 42 passed; Django system check clean with `config.test_settings`; `git diff --check` clean.
- Capability surface verified: manager review queues limited to current active direct reports; HR timesheet reads are read-only (`can_decide=false`); cross-user object URLs return the safe 404 envelope with no data leak; queue filtering, bounded pagination, and deterministic sorting verified.
- QA hardening pass: `permissions.can_decide` mirrors the current direct-report read scope (HR reads always `can_decide=false`; manager follows AC 4.1 current scope, not snapshot).
- Commits: implementation `a13a299`, merge `5ced7de`; QA fix `3c70842`, merge `8b15913` = main HEAD.
- Next step: Story 4.2 — in-app notifications.

Story 4.2 evidence (accepted 2026-09-13):

- In-app notifications under `backend/notifications`: notification creation triggered post-commit on request and timesheet decisions, delivered to scoped recipients per the Epic 4.1 permission surface.
- Lock retry and dedupe verified: concurrent decision paths cannot double-create a notification for the same event; retry under contention is safe and bounded.
- Post-commit creation verified: notification writes occur after the decision transaction commits; scheduling/creation failures are isolated and logged with zero impact on the deciding transaction (unread failure isolation verified).
- Scoped surfaces verified: recipient-scoped list, detail, and read endpoints; cross-user object URLs return the safe 404 envelope with no data leak; unread counts and read-state updates remain per-recipient.
- Safe links verified: notification targets resolve only to objects the recipient is authorized to see; no manager-identity or cross-scope disclosure via links or payloads.
- Verification on acceptance (final, in the project-local `.venv` on `main` at HEAD `a4ff7b9`): final QA verdict APPROVED; notification tests 31 passed with `-W error` and no thread warnings; Django system check clean with `config.test_settings`; `git diff --check` clean.
- Next step: Story 4.3 — scoped CSV reports.

Story 4.3 evidence (accepted 2026-09-14; acceptance recorded 2026-09-14):

- Scoped CSV reports under `backend/review`: role-scoped report rows/totals/dashboard plus `reports/requests.csv` and `reports/hours.csv` exports (`f71b234`).
- QA fix: timezone-correct report window handling (`afa8cb6`).
- Verification: report tests added with the story and timezone-window fix; commits verified in git history.
- Commits: `f71b234`, merge `ab7cfae`, QA fix `afa8cb6`, merge `8c6d5e1`.
- Record-keeping note: this entry was reconstructed from git history on 2026-09-14 during the Story 5.1 acceptance recording; its QA evidence was not captured in this log at the time of acceptance.

Story 5.1 evidence (accepted 2026-09-14):

- Health probes and versioned API helpers: `/health/live` (process liveness, no dependency contact) and `/health/ready` (DB readiness check hard-bounded by a worker-thread join with `READINESS_DEPENDENCY_TIMEOUT_S`; a hanging or slow DB cannot block the endpoint); both wired outside the authenticated `/api/v1/` tree (`ef4524e`).
- Bounded readiness degrades to `503` naming only the failed dependency kind — no secrets and no exception detail in any live/ready payload, verified by dedicated no-leak assertions.
- Uniform `X-API-Version` header stamped on every `/api/` and `/health/` response (success, error, and unmatched-route 404) via `APIVersionMiddleware`, with request-ID correlation preserved (`ec394d3`).
- Error-matrix QA coverage on real endpoints: 401/403/404/409/422/429 responses verified for status, stable code/message/field errors, `error.request_id == X-Request-ID` body/header correlation, and `X-API-Version` presence (`2fd2362`).
- Truthful OpenAPI endpoint `GET /api/v1/schema` generated from the actual URLconf via `DRF SchemaGenerator` with per-view `AutoSchema`: component schemas derived from the real serializer classes, documented status codes taken from real handler response paths (including the 401/403/404/409/422/429 envelopes), health probes documented verbatim, read-only `require_GET`, unauthenticated like the health probes, with 12 focused tests asserting the documented surface equals the enumerated URLconf and no secret leakage (`dd74aac`).
- Verification on acceptance: final QA verdict APPROVED; combined health/schema suites 40 passed; Django system check clean with `config.test_settings`; `git diff --check` clean.
- Commits: `ef4524e`, merge `0c761c1`, QA fix `ec394d3`, merge `4befcb2`, tests `2fd2362`, schema `dd74aac`, merge `c4acf01` = main HEAD.
- Next step: Story 5.2 — bilingual RTL/LTR responsive accessible screens.

## Scope boundary

This log documents Tracking-sys only. It does not describe or govern any Odoo project.
