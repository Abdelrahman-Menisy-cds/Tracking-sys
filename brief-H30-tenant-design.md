# H30 — multi-tenant isolation: design (Company model + FK everywhere + scoping)

## The owner's decision (verbatim, non-negotiable)

> «اي شركه تسجل جديد متقدرش تشوف اي داتا ليها علاقه بالشركه التانيه لازم تفصل
> الداتا بتاعه كل شركه وطبعا الموظفين داخل كل شركه لازم تفصل الداتا دي بردو حسب
> الصلاحيات (حتى في جزء الشات بوت لازم تراعي حته الصلاحيات) ( لازم نهتم
> بالسيكيورتي شوف اي كمان ناقص )»

Chosen options: **full isolation from the roots** — a `Company` model, a company
FK on **every** table, scoping on **every** query; **existing data migrates into
ONE default company (no data loss)**; and **role/department separation inside a
company must keep working** (that part exists — see ManagerGrant).

## The app today (verified — do not re-derive)

Repo: `/home/menisy/Desktop/Me/tracking_system_project` (Django 5.2 + DRF in
`backend/`, Vite SPA in `frontend/`). Deployed on Railway (one service, SQLite on
a volume). Read `DEPLOY_RAILWAY.md` before proposing anything operational.

Models (`backend/*/models.py`):
- `accounts`: `Department`, `EmployeeProfile`, `ManagerGrant`, `CompanyProfile`,
  `SubscriptionCode`, `PendingDeviceFlow`, `AuditEvent`, `AssistantConfig`
- `holidays`: `PublicHoliday`
- `notifications`: `Notification`
- `reqs`: `RequestType`, `EmployeeRequest`, `RequestEvent`, `RequestAttachment`,
  plus Submission/Decision/Cancel/Attachment idempotency records
- `timesheets`: `TimezoneConfig`, `Timesheet`, `TimeEntry`, `TimesheetEvent`,
  plus Submit/Create/Decision idempotency records

Key facts:
- **`CompanyProfile` is a deliberate singleton** ("ONE row for the whole org",
  `CheckConstraint(condition=Q(id=1))`). It is the org's identity, **not** a
  tenant — do not bend it into one.
- **No model has a company/tenant FK.** Every table is global today, which is
  exactly why any new signup can see everyone's data.
- Roles: `HR` / `MANAGER` / `EMPLOYEE` on the user, plus `ManagerGrant` which
  scopes a manager to a **department**. That intra-company separation already
  exists and must keep working, now nested inside the company.
- The assistant «مدام عفاف» executes tools over this same data
  (`backend/accounts/assistant_*.py`, `assistant_subscriptions.py`). Its tool
  layer is the **highest-risk** surface: every tool must be company- and
  role-scoped, and no tool may accept an id that is not proven to belong to the
  caller's company.

## Deliverable: a WRITTEN PLAN — no implementation in this task

Write the plan to `.hermes/plans/h30-multi-tenant-isolation.md` (create the dir).
It must cover, concretely and with file paths:

1. **The `Company` model** (fields, how a signup creates/joins one, how a user
   binds to exactly one company, what `CompanyProfile` becomes — one per company,
   not a singleton) and the **data migration**: every existing row moves into a
   single default company, with the exact migration order and the rollback story.
2. **The FK inventory**: every model that gains `company`, with nullability
   during the migration, indexes, and `on_delete` semantics.
3. **One enforcement point for scoping.** Scattered `filter(company=...)` in
   every view WILL leak eventually — propose a single mechanism (a manager/
   queryset layer, a middleware-bound tenant, or DRF-scoped viewsets) and say why
   it is the least leak-prone option for this codebase. Name the files it touches.
4. **The permission matrix**: company × role × department, in a table, including
   who may see which employee, request, timesheet, holiday, notification, and
   attachment — and how the existing `ManagerGrant` semantics fit inside it.
5. **The assistant's scoping**: exactly how every tool gets the caller's company
   and role, what a tool must never accept from the model (raw ids), and the
   refusal behaviour when a tool is asked for another company's data.
6. **Attachment/file isolation** (`RequestAttachment`, MEDIA_ROOT): a request for
   another company's file must 404/403, including via direct URL guessing.
7. **The security gaps list** (from the owner's "شوف اي كمان ناقص"), each with a
   concrete fix and severity: IDOR beyond tenancy, login/signup rate limiting,
   password policy, session/cookie flags on the live HTTPS deploy, CSRF
   (already enforced — confirm), audit coverage (`AuditEvent` exists — say what
   it must log and what it currently misses), secrets handling, and the
   `SIGNUP_CODE` flow.
8. **The test strategy**: a cross-company leak suite (company A's user must never
   read/write company B's anything, through **every** endpoint **and** through
   the assistant), plus the intra-company role tests. Name the test files.
9. **Rollout order** (smallest safe increments, each independently testable) and
   **risks** with mitigations.

## Rules

- **Do not implement.** This task delivers the plan document only. Do not edit
  models, views, settings, or migrations.
- **Do not commit, stage, or stash.**
- **Do not touch the running dev server on port 8080** (the owner is using it).
- Base every claim on the actual code — read it. If you find something that
  contradicts this brief, say so in the plan.
- Keep the plan concrete: file paths, model names, migration names, test names.
  A plan nobody can execute line by line is not a plan.
