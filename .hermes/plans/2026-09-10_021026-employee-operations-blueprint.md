# هي فوضى؟ — Employee Operations System: Master Plan & Decision Log

> **Purpose:** single source of truth for the project. Every major decision, the full
> product spec, the agent team, environment state, and next steps live here so any
> future session can return to this file and continue without re-deriving context.
> **Last updated:** 2026-09-10. Update after every major decision.
> **Active chat model:** glm-5.3-flash via opencode-go.

---

## 1. Locked decisions

| Decision | Value | Why / Source |
|---|---|---|
| Product name | **هي فوضى؟** — Franco / English-facing: **Heya Fawda?**; descriptor: **Employee Operations** | User-locked. Use «هي فوضى؟» in Arabic UI/brand; use `Heya Fawda?` where Latin characters are needed (English UI, domains, docs, deploy labels). Never translate the phrase literally. |
| UI language | Arabic-first bilingual UI, complete English switch, RTL + LTR from day one | User-locked |
| Appearance | System, Light, and Dark; **System is default** | System follows `prefers-color-scheme`; a signed-in user override persists server-side and must apply before UI render. |
| Tagline | من الفوضى إلى النظام — *From chaos to clarity* (recommended, user may still change) | Alternatives: «طلباتك وساعاتك… في مكان واحد»، «كل طلب له صاحب، وكل ساعة لها حساب» |
| Primary workflow | **BMAD Method (BMM module track)** | User decision: product-team fit outweighs the PDF's SpecKit requirement |
| Spec artifacts | Keep a SpecKit-compatible `specs/` layout alongside BMAD as the traceability deliverable | BMAD drives the process; `specs/` stays the single requirements authority |
| GSD | Not used | Original repo archived; overlaps with BMAD orchestration |
| Backend | **Django 5.2 LTS + Django REST Framework** (not FastAPI) | Best fit for internal business product: admin, auth/RBAC, ORM + migrations, transactions. FastAPI only as optional assistant gateway later. |
| Frontend | React + TypeScript + Vite (+ React Router, TanStack Query, React Hook Form, Zod) | Modern responsive SPA per brief |
| Database | PostgreSQL — host instance for local dev | Local server verified accepting connections on :5432 |
| Authentication | Django same-origin session cookies (Secure, HttpOnly, CSRF); no JWT in browser storage | First-party web app |
| Python environment | Project-local `.venv` via uv (Python 3.11.15) | User-locked; created |
| Docker | Not required initially (not installed); host PostgreSQL instead. Revisit for CI/deployment. | User-locked |
| Repository | `git@github.com:Abdelrahman-Menisy-cds/Tracking-sys.git` | User-provided |
| Git strategy | `main` + feature branches; agents editing code use separate git worktrees; qa_reviewer is a merge gate | Multi-agent safety |
| AI assistant | Planned as a **late feature**; Django-integrated (see §8) | User-locked |

## 2. Agent team and model assignments (user-locked)

| Profile | Model | Provider | Responsibility |
|---|---|---|---|
| `product_lead` | gpt-6-astra | derouter | Product brief, PRD, MVP, user stories, acceptance criteria, clarification questions |
| `ux_brand_designer` | gpt-6-astra | derouter | Bilingual UX, RTL/LTR, design system, logo/brand package, responsive + a11y requirements |
| `architect_security` | gpt-5.6-sol | derouter | Architecture, data model, API contracts, RBAC rules, threat model; read-only code review |
| `backend_engineer` | glm-5.3-flash | opencode-go | Django/DRF models, services, permissions, APIs, migrations, backend tests |
| `frontend_engineer` | glm-5.3-flash | opencode-go | React UI, forms, dashboards, API integration from approved specs/tokens |
| `qa_reviewer` | gpt-6-astra | derouter | **READ-ONLY** gate: authorization tests, Playwright flows, accessibility, regression review; reports, never fixes |
| `release_operator` | glm-5.3-flash | opencode-go | CI, environments, migrations in deployment, secrets hygiene, README, demo credentials |

Operational notes:

- derouter models ride the existing `derouter-provider` plugin (OpenAI-compatible,
  `https://api-direct.derouter.ai/openai/v1`, key `DEROUTER_API_KEY`). Verify each
  profile with `hermes doctor` **and** a real `hermes -p <profile> chat -q` round-trip —
  derouter has a history of fingerprint-gating clients; a catalog listing is not proof.
- One combined `fullstack` profile may absorb backend+frontend only if kanban load is light.
- Runtime caps (Team Rule 22): leader/triage 5m, scout/business/teacher 10m, dev 20m, reviewer 15m; over-cap lanes decompose into fresh follow-ups.
- Sequence: `product_lead → ux_brand_designer + architect_security → backend_engineer + frontend_engineer → qa_reviewer → release_operator`. Parallel work only after shared contracts are approved.

## 3. Environment inventory (verified 2026-09-10)

- Workspace: `/home/menisy/Desktop/Me/tracking_system_project`
- Present: `Employee_Requests_and_Time_Tracking_System.pdf` (13 pages, PDF 1.7, text layer verified), `.venv` (Python 3.11.15, `specify-cli 1.0.5`), `.gitignore`, `.env.example`, this plan
- Missing: local git repo (now initialized — see §10), BMAD install, application code
- Runtimes: uv 0.9.18, Node v26.7.0, npm 11.19.0, git 2.43.0, psql/pg_isready 16
- PostgreSQL: accepting connections on `:5432`
- Docker: **not installed**
- The `.venv` `specify` CLI can still generate a SpecKit-compatible skeleton even under BMAD-primary.

## 4. Product spec (PDF facts + agreed recommendations)

### 4.1 Actors

- **Employee:** own profile, own requests (+ attachments), own timesheets, status/history.
- **Manager:** direct reports only — team requests, decisions, timesheet review, team dashboard.
- **HR:** organization-wide employees, reporting lines, roles/account status, all requests/timesheets, request-type config, reports. HR ≠ Django superuser.

### 4.2 Permission matrix

| Capability | Employee | Manager | HR |
|---|---:|---:|---:|
| View/edit own profile | Yes | Yes | Yes |
| Create/edit own draft request | Yes | Yes | Yes |
| View own request history | Yes | Yes | Yes |
| Review direct-report requests | No | Yes | Yes |
| Review organization requests | No | No | Yes |
| Create/edit own draft timesheet | Yes | Yes | Yes |
| Review direct-report timesheets | No | Yes | Yes |
| Manage employees/reporting lines | No | No | Yes |
| Configure request types/settings | No | No | Yes |
| View organization reports | No | No | Yes |

### 4.3 Request state machine

```text
DRAFT → PENDING_MANAGER → PENDING_HR (conditional) → APPROVED | REJECTED | RETURNED
RETURNED → (employee edits) → PENDING_MANAGER (resubmit)
CANCELLED: from DRAFT/RETURNED while policy permits
```

Rules: every transition records actor, timestamp, from→to, optional comment into an
append-only `RequestEvent`; comments **required** for reject/return; responsible manager
snapshotted at submission (`manager_at_submission`); whether HR review is required is a
server-side rule per request type; employees see only permitted requests.

### 4.4 Timesheet state machine

```text
DRAFT → SUBMITTED → APPROVED
                  ↘ RETURNED → (edit) → SUBMITTED
```

Rules: weekly container + daily entries; unique `(employee, week_start)`; duration stored
canonically in **minutes** (accept start/end or explicit duration input, never inconsistent
combos); reject overlaps, negative durations, out-of-week entries; submitted/approved are
read-only; returned is editable; reopen of approved is explicit, authorized, audited;
append-only `TimesheetEvent`.

### 4.5 MVP scope (in)

1. Auth + profiles (sign in/out, current user, inactive-account handling)
2. Server-enforced RBAC + ownership/reporting-line scoping
3. Requests CRUD, attachments, submit, status/history
4. Approvals (manager decision, conditional HR decision) with immutable history
5. Timesheets (weekly container, daily entries, draft/submit)
6. Timesheet review (approve / reject / return)
7. Role-scoped dashboards (employee / manager / HR)
8. Search, filters, sorting, pagination, empty states
9. In-app notifications for submission and decisions
10. Reports (hours + request summaries; CSV for manager/HR)
11. OpenAPI schema + docs, health endpoints
12. Responsive, accessible UI with loading/empty/error/validation/disabled/success states

### 4.6 Explicitly deferred

Payroll, biometrics/kiosk clock-in, leave balances/accrual, email/SMS/push, SSO/MFA,
mobile apps, multi-tenancy, generic workflow builder, real-time sockets (assistant
excepted), advanced analytics, projects/cost codes, employee document management beyond
request attachments, scheduled reports.

### 4.7 Domain model (initial ERD direction)

- `User` (custom, created before first migration): email, password hash, role, is_active
- `EmployeeProfile`: user, employee_number, display_name, department, job_title, **manager FK**, timezone (one direct manager; prevent self-management and cycles)
- `RequestType`: name, description, requires_hr_approval, is_active (HR-configurable)
- `EmployeeRequest`: requester, request_type, title, details, status, submitted_at, manager_at_submission, current_assignee, version
- `RequestAttachment`: request, uploaded_by, object_key, original_name, content_type, size (type/size allowlist before upload is built)
- `RequestEvent` (append-only): request, actor, action, from_status, to_status, comment, created_at
- `Timesheet`: employee, week_start, status, submitted_at, reviewer, reviewed_at, version — unique(employee, week_start)
- `TimeEntry`: timesheet, work_date, started_at, ended_at, duration_minutes, description — positive duration, within timesheet week
- `TimesheetEvent` (append-only): same shape as RequestEvent
- `Notification`: recipient, kind, related_object, read_at, created_at

Architecture rules: modular monolith (apps: `accounts`, `organization`, `requests`,
`timesheets`, `notifications`, `reporting`, `audit`, `api`, plus `assistant` later);
workflow transitions live in `services.py` inside `transaction.atomic` with
`select_for_update` row locks and version checks; dashboards/exports derive from the same
role-scoped services as list endpoints; DRF object permissions are NOT auto-applied to
list querysets → explicit queryset scoping everywhere; `select_related`/`prefetch_related`
plus query-count tests on manager/HR lists.

### 4.8 API outline (v1)

```text
POST /api/v1/auth/login | /auth/logout    GET /auth/me
GET/PATCH /api/v1/employees/me            GET/POST/PATCH /api/v1/employees (HR)
GET/POST /api/v1/request-types            PATCH /request-types/{id} (HR)
GET/POST /api/v1/requests                 GET/PATCH /requests/{id}
POST /api/v1/requests/{id}/submit|approve|reject|return|cancel
POST/DELETE /api/v1/requests/{id}/attachments
GET /api/v1/requests/{id}/events
GET/POST /api/v1/timesheets               GET /timesheets/{id}
POST/PATCH/DELETE /api/v1/timesheets/{id}/entries
POST /api/v1/timesheets/{id}/submit|approve|return
GET /api/v1/timesheets/{id}/events
GET/PATCH /api/v1/notifications
GET /api/v1/dashboard
GET /api/v1/reports/requests.csv | /reports/hours.csv
GET /api/schema | /api/docs               GET /health/live | /health/ready
```

### 4.9 Minimum test pack

Login success/failure, logout, inactive user, protected routes, CSRF rejection, session-cookie settings; full role×endpoint permission matrix; cross-employee access blocked; manager restricted to direct reports; list endpoints leak nothing (search, filters, counts, dashboards, exports); direct object-URL guessing returns the chosen safe response; invalid/concurrent transitions rejected, duplicate approval idempotent or safe conflict; submitted/approved timesheets immutable until returned; date/duration/week-boundary/timezone/overnight/overlap cases; attachment type/MIME/size/authorization/safe download; pagination bounds, deterministic ordering, malformed filters, query counts; responsive keyboard flows via Playwright; migration-from-empty test + deployment smoke test.

### 4.10 Branding direction

Original Egyptian-comedy-inspired identity (stressed HR/clipboard mascot asking
«هي فوضى؟» while the system organizes the mess into requests and time cards) —
**not** a copy of any specific film, actor, character, or poster. Humor lives in the
mascot, microcopy, empty states, onboarding; approvals/permissions/reports stay
professional. Deliverables: Arabic wordmark («هي فوضى؟»), Franco/English-facing
wordmark (`Heya Fawda?`), icon, accessible palette
(primary/secondary/success/warning/error/neutral), Arabic+Latin font pairing,
spacing/usage rules, and color tokens validated in System, Light, and Dark modes.
System is the default and follows `prefers-color-scheme`; Light/Dark are explicit
user overrides persisted server-side and applied before UI render.

## 5. Workflow: BMAD primary

- Install (project-local): `npx bmad-method install --directory . --modules bmm --tools hermes --yes`
- Later add **TEA** (Test Architect) once architecture stabilizes. Do **not** install: BMGD, CIS, Enterprise track, GSD.
- Phases: Analysis → Planning (PRD/architecture/UX) → Solutioning → Implementation (`sprint-planning → build → code-review`, QA per story) → Retrospective.
- Division of labor: **BMAD defines what each role does and when; Hermes profiles are the persistent execution containers (model, tools, memory); Git is the code source of truth; Hermes kanban coordinates tasks; separate worktrees for parallel code edits.**
- Traceability deliverable kept SpecKit-compatible:

```text
specs/constitution.md
specs/001-brand-product-foundation/{spec.md,plan.md,tasks.md}
specs/002-authentication-rbac/{spec.md,plan.md,tasks.md}
specs/003-employee-requests/{spec.md,plan.md,tasks.md}
specs/004-timesheets/{spec.md,plan.md,tasks.md}
specs/005-dashboard-reporting/{spec.md,plan.md,tasks.md}
```

BMAD's own artifacts live under `_bmad/`/`_bmad-output/`; accepted decisions are copied
into `specs/` so there is exactly **one** requirements authority.

## 6. Skills plan

Built-in (use as-is): `pdf`, `hermes-agent`, `bot-fleet-setup`, `native-mcp`, `plan`,
`writing-plans`, `clean-code-guard`, `test-guard`, `docs-guard`.

External shortlist (install project-local / into profiles only after inspecting source,
license, install counts; never global by default):

- `mattpocock/skills@to-prd`, `mattpocock/skills@domain-modeling`
- `nextlevelbuilder/ui-ux-pro-max-skill@ui-ux-pro-max`
- `mindrally/skills@django-rest-api-development`
- `microsoft/playwright-cli@playwright-cli`
- `anthropics/skills@webapp-testing`, `anthropics/skills@doc-coauthoring`
- `addyosmani/web-quality-skills@accessibility`
- `addyosmani/agent-skills@ci-cd-and-automation`, `@code-review-and-quality`, `@security-and-hardening`

## 7. MCP plan

**Phase 1 (only these three):**

| MCP | Package/Repo | Notes |
|---|---|---|
| GitHub | `github/github-mcp-server` | Repos/issues/PRs/Actions; **read-only PAT scope first** |
| Playwright | `@playwright/mcp` (microsoft/playwright-mcp) | Real browser flows via accessibility tree; responsive + a11y checks |
| Context7 | `@upstash/context7-mcp` (upstash/context7) | Current Django/DRF/React/Playwright docs |

**Phase 2 (only when justified):** `crystaldba/postgres-mcp` — disposable dev DB only,
`--access-mode=restricted`; tracker/observability MCPs after deployment exists.

Security rules: tokens only via `.env` (never in config.yaml, skills, git); filesystem
allow-list; no production DB for coding agents; keep active servers minimal — every
registered tool costs context.

## 8. AI voice/text assistant (planned late feature)

- New Django app `assistant/`: models (Conversation, Message, ToolCall), services, tools, permissions, providers, api.
- Tools wrap **existing Django services** with the authenticated user; the model never bypasses permissions and never touches the DB directly. Separate read tools (`get_my_requests`, `get_team_pending_approvals`, …) from write tools (`create_request`, `submit_request`, `approve_request`, …). Risky writes require explicit user confirmation in-chat before execution. Audit every tool call (user, conversation, tool, args, authz result, result, confirmation state).
- Text: `POST /api/v1/assistant/messages` (+ SSE streaming). Voice: Django issues a **short-lived ephemeral credential** → browser connects to the realtime provider over WebRTC → tool calls route through the authenticated backend. Provider API keys never reach the browser.
- Django async caveat: transactions don't work directly in async mode → keep workflow transitions in sync functions called via `sync_to_async`; ASGI/Channels available for long-lived connections.
- Optional **FastAPI assistant gateway** only if realtime voice scaling demands it — and it must delegate every business action to Django (Django remains the authorization/workflow authority).

## 9. Open decisions (resolve during BMAD planning, before coding)

1. Which request types require HR approval; is manager review always first?
2. Manager scope: direct reports only vs full descendant hierarchy.
3. Cancel-after-submit policy; can approved records ever be reopened (who)?
4. Time-entry details: breaks, overnight, daily maximum, rounding, timezone, workweek definition.
5. Attachment policy: allowed types, size caps, retention, download rights.
6. HR authority limits (approve on behalf of managers? edit employee-owned records?).
7. i18n library for React (react-i18next is the working default).
8. Deployment target (platform TBD) + demo seed data plan (3 demo accounts required).

## 10. Setup progress

- [x] PDF analyzed (13 pages; actors, modules, rules, gaps extracted)
- [x] Workflow comparison researched; BMAD chosen (user decision)
- [x] Stack chosen: Django + DRF, React + TS + Vite, PostgreSQL
- [x] `.venv` created (uv, Python 3.11.15; `specify-cli 1.0.5` inside)
- [x] `.gitignore`, `.env.example` written
- [x] Repo + model assignments provided by user; consolidated into this file
- [x] Local git repo initialized; remote `origin` added; initial commit pushed
- [x] Install BMAD project-local — BMM v6.12.0 stable + BMad Core v6.12.0, configured for Hermes; 29 project-local skills installed under `.agents/skills`; output root `_bmad-output/` created (2026-09-10)
- [x] Commit the BMAD installation (`_bmad/` + `.agents/`; generated `_bmad-output/` excluded) and push it to `main` — `f683cc2` (2026-09-10)
- [x] Create dedicated Tracking-sys project context and draft constitution (`docs/PROJECT_CONTEXT.md`, `specs/constitution.md`) and push — `32145f1` (2026-09-11)
- [x] Create 7 isolated Tracking-sys Hermes profiles, project-only rules/personas/memories, model assignments, and live smoke-test them (`OK` verified in each profile `state.db`) (2026-09-11)
- [x] Record completed work by delivery level in `docs/WORK_LOG.md`; lock the Franco name `Heya Fawda?` and System/Light/Dark appearance policy (System default) (2026-09-11)
- [x] Approve constitution and baseline product/UX/architecture direction (user approval recorded 2026-09-11); policy-specific specs remain blocked pending §9 decisions
- [ ] Configure Phase-1 MCPs + project-local skills
- [x] Produce provisional UX/brand and architecture/security solutioning artifacts; UX `bfd565e`, architecture `e36a1cd` (2026-09-11)
- [x] Approve constitution, product brief, UX direction, and architecture/security baseline (user approval recorded 2026-09-11); §9 policy decisions remain open
- [ ] BMAD planning phase → resolve §9 decisions, then produce approved PRD/specs, epics/stories, and implementation backlog
- [x] Begin implementation after approval gates — Story 1.1 accepted after spec, test, Django-check, migration, compilation, whitespace, and code-quality verification (commits `10e77ab`, `5840e54`, `bbce908`, `d9cffd9`; 2026-09-12)
- [x] Continue implementation — Story 1.2 accepted after spec, 31-test suite, Django checks, migration drift check, and code-quality review (commits `ae97038`, `fbe4e7b`, `89337b8`, `626dea1`, `48994d9`, `7cc7d3e`, `337f88a`, `bdaeba5`; 2026-09-12)
- [x] Continue implementation — Story 1.3 accepted after spec + code-quality gate (commits `84e4341`, `25e6f53`; 53 tests, checks clean; 2026-09-12)
- [x] Continue implementation — Story 2.1 accepted after spec + code-quality gate (commit `12a4a2f`; 70 tests, checks clean; 2026-09-12)
- [x] Continue implementation — Story 2.2 accepted after spec/security review + fix merge (commits `839d8b8`, `f1de7c9`, merge `a696f28`; 100 tests, checks clean; 2026-09-12)
- [x] Continue implementation — Story 2.3 accepted after security review (commit `af744c3`; 128 tests, checks clean; 2026-09-12)
- [x] Continue implementation — Story 2.4 accepted after QA/security review and notification-isolation hardening (merge `f482601`; 168 tests, checks clean; 2026-09-12)
- [ ] Continue implementation with Story 2.5 (cancel) after contract review

## 11. Sources

- Brief: `Employee_Requests_and_Time_Tracking_System.pdf` (local, verified)
- Spec Kit: https://github.com/github/spec-kit · quickstart/workflows docs
- BMAD: https://github.com/bmad-code-org/BMAD-METHOD · https://docs.bmad-method.org/tutorials/getting-started · /reference/agents · /reference/testing
- GSD (rejected): original repo archived → open-gsd/gsd-core only if ever revisited
- Django: https://docs.djangoproject.com/en/5.2/ (auth, security, async caveats) · https://www.djangoproject.com/download/
- DRF: https://www.django-rest-framework.org/api-guide/permissions/ (list-queryset caveat), /pagination/
- FastAPI (comparison only): https://fastapi.tiangolo.com/features/
- PostgreSQL: https://www.postgresql.org/docs/current/ddl-constraints.html · /rangetypes.html
- Voice agents: https://platform.openai.com/docs/guides/voice-agents · /guides/realtime
- Channels: https://channels.readthedocs.io · Celery: https://docs.celeryq.dev/en/latest/django/first-steps-with-django.html
