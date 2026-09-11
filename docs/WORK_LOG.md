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

**Status:** Provisional artifacts complete; approval pending

Created:

- UX and brand direction: `_bmad-output/planning-artifacts/ux/ux-brand-direction.md` (332 lines; committed as `bfd565e`).
- Architecture and security design: `_bmad-output/planning-artifacts/architecture/architecture-security.md` (510 lines; committed as `e36a1cd`).

The artifacts define provisional UX flows, brand directions, theme behavior, Django boundaries, data/API/security design, threat controls, and verification scenarios. They remain provisional until the product brief, constitution, and unresolved business rules are approved.

Planned next: consolidate approved decisions into the PRD/spec artifacts and implementation backlog.

## Level 5 — Build and verification

**Status:** Not started

Planned outputs: Django/DRF backend, React frontend, PostgreSQL schema, unit/integration/browser tests, QA approval, CI, deployment readiness, and release evidence.

## Scope boundary

This log documents Tracking-sys only. It does not describe or govern any Odoo project.
