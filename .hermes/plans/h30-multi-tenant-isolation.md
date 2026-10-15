# H30 — Multi-tenant isolation: design plan (Company model + FK everywhere + scoping)

Status: PLAN ONLY — no code in this task. Author: Architect/Security Lead.
Date: 2026-10-15 (session date).

## 0. The owner's decision (verbatim, non-negotiable)

> «اي شركه تسجل جديد متقدرش تشوف اي داتا ليها علاقه بالشركه التانيه لازم تفصل
> الداتا بتاعه كل شركه وطبعا الموظفين داخل كل شركه لازم تفصل الداتا دي بردو حسب
> الصلاحيات (حتى في جزء الشات بوت لازم تراعي حته الصلاحيات) ( لازم نهتم
> بالسيكيورتي شوف اي كمان ناقص )»

Decisions carried into this plan:

1. Full isolation from the roots: an `accounts.Company` model, a company FK on
   every tenant table, scoping on every query.
2. Existing data migrates into ONE default company — no data loss.
3. Role/department separation INSIDE a company keeps working (that exists
   already; see §4 for exactly where and for two real inconsistencies found).

## 1. Verified current state (evidence, not memory)

Single deployed service: Django 5.2 + DRF in `backend/`, Vite SPA in
`frontend/`, same origin, Django sessions (`config/settings.py`). Per
`DEPLOY_RAILWAY.md`: one Railway container, SQLite on a `/data` volume
(`DJANGO_SQLITE_PATH=/data/db.sqlite3`), `MEDIA_ROOT=/data/attachments`,
`migrate` forward on every boot, gunicorn 2 workers, migrations are
forward-only in practice (a destructive step cannot be undone by rolling back
the image). No Postgres — the Free-plan budget rejected it (H29).

Roles are `HR`/`MANAGER`/`EMPLOYEE` on `accounts.User`
(`backend/accounts/models.py:42`). There is no company FK on any model; every
table is global today. That is the entire vulnerability.

### 1.1 Where the queries are (all `Model.objects.*` call sites found by scan)

- `backend/accounts/views.py` — login/signup/me (auth only)
- `backend/accounts/employee_views.py:41` `_visible_users()` — HR sees ALL
  users in the world (the leak the owner described, verbatim)
- `backend/accounts/employee_service.py:45,67,84,97,168,192` — create/update
  employee; email uniqueness is GLOBAL (`User.email unique=True`)
- `backend/accounts/department_views.py:118,132,138,172,188` — departments
  global
- `backend/accounts/grant_views.py:45,54,89` — manager grants global
- `backend/accounts/assistant_tools.py:52,77,101,133,136,195,239,266,298,316,373,426,452,476,492`
  — the assistant's tool surface; builders `write_create_request` /
  `_execute_*` fetch unscoped by caller/model-supplied ids
- `backend/accounts/assistant_views.py:109,117,319` — assistant config,
  HR-facing assistant config for a target employee
- `backend/accounts/company_views.py:50` — `CompanyProfile.objects.get(pk=1)`
- `backend/accounts/serializers.py:61` — same singleton read for /auth/me
- `backend/review/scope.py:45..120` — THE read-scope layer for requests and
  timesheets (manager: department ∪ direct reports ∪ active ManagerGrants; HR:
  the whole organization — worldwide today)
- `backend/review/reports.py:89-93` + `backend/review/csv_export.py` — every
  report/CSV resolves rows only through `review.scope`
- `backend/review/views.py` — scoped queues/details (no direct manager calls)
- `backend/reqs/views.py:46,62,222` — owner-scope for the requester; the
  decision view's fetch is UNscoped (`_get_request_for_review`,
  `views.py:222`) by design: scope is re-checked inside the locked service
- `backend/reqs/attachment_views.py:26,33,75` — attachments are REQUESTER-ONLY
  today (`requester=user`); download re-checks ownership + scan status
- `backend/reqs/decision_services.py:52,155` — decision authorization uses the
  `manager_at_submission` SNAPSHOT, not H16's department/grant scope
- `backend/timesheets/views.py:51,59,134,394` — owner-scope; the decision
  fetch is unscoped (`views.py:394`), re-checked in the service
- `backend/timesheets/review_services.py:69-103,147` — decision authorization
  checks CURRENT DIRECT REPORTS ONLY (line 88), NOT the department and NOT
  ManagerGrants — contradicts `review/scope.py` (see §4.3)
- `backend/holidays/views.py:71` + `backend/holidays/services.py` — holidays
  keyed by (country, year) only: global table
- `backend/notifications/views.py:19,34,52,74,107` — recipient-scope (fine);
  `backend/notifications/services.py:129,141` resolves related objects
  owner-or-scope-checked (goes through `review.scope`, inherits company once
  scope is tenant-aware)
- `backend/accounts/services.py` — `sign_up`/`sign_in`/`deactivate_user`

### 1.2 Contradictions found in the brief / code (must be stated, per the task rules)

1. Brief says «ManagerGrant which scopes a manager to a department». That is
   not what ManagerGrant is. The department rule lives in
   `review/scope.py::_scoped_employee_ids` (manager = their department ∪
   direct reports). `ManagerGrant` is per (manager, employee, scope) — it
   ADDS one named employee to a manager's scope. Plan treats H16 semantics as
   in the CODE, as instructed by the story docs.
2. Real intra-company inconsistency (today, pre-tenancy): REQUEST decisions
   authorize via `manager_at_submission` snapshot
   (`reqs/decision_services.py:52`), but TIMESHEET decisions authorize via
   current direct report only (`timesheets/review_services.py:88`) — a
   department member's sheet can appear in the manager's queue
   (`can_decide=true` from `review/scope.py`) yet the decision endpoint
   answers 404. H30 must unify all four paths (queue read, read detail,
   decision, reopen) on ONE scope function per domain. See §4.3.
3. The brief's "one default company" plus "FK everywhere" necessarily
   converts `TimezoneConfig` (organization timezone singleton,
   `timesheets/models.py:28`) and `CompanyProfile` (`id=1` singleton) into
   per-company rows. The brief itself asks for this for CompanyProfile;
   TimezoneConfig is implied (each company needs its own week boundary for
   timesheets/reports). Called out here because the brief did not mention it.
4. `django.contrib.sessions` (the `django_session` table) physically cannot
   carry a company FK — it is session-keyed and already user-scoped by
   `_auth_user_id`. Documented exception to "FK everywhere"; sessions die
   with their user and are irrelevant to tenant reads.

---

## 2. The `Company` model, signup/binding, CompanyProfile, and the data migration

### 2.1 New model — `backend/accounts/models.py`

```python
class Company(models.Model):
    slug = models.SlugField(max_length=64, unique=True)          # generated, stable
    name = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
```

- Migrations: `accounts/migrations/00XX_company.py` (new app-local, name it
  explicitly, e.g. `0010_company` under accounts' numbering — check the
  current head first at execution time).
- The FIRST user of a company is its HR (today's `sign_up` already grants
  `role=HR`; that stays the company-founder shape).

### 2.2 User binds to exactly one company

- `User.company = FK(Company, PROTECT, null=True, index=True)` becomes NOT
  NULL after the backfill (§2.4). One user, one company — enforced by the FK
  itself and by every creation path (signup / `employee_service.create_employee`
  copies `actor.company`). Cross-company creation is not a feature; nobody
  creates a user in a company they are not in.
- `AUTH_USER_MODEL` unchanged. `create_superuser` (break-glass) also takes a
  company argument or binds to the default company; superuser status is
  documented break-glass only (constitution §3) and the application endpoints
  already exclude `is_staff/is_superuser` from workforce reads.
  Residual risk: a superuser with role HR would see ALL companies; mitigation
  is the existing exclusion plus the leak suite (§8) asserting superusers get
  empty workforces exactly as today.

### 2.3 Signup: two branches, both inside one transaction

Today: any valid `SubscriptionCode` → `role=HR`, one global account
(`accounts/services.py::sign_up`, `SignupSerializer` in
`accounts/serializers.py`).

New in `POST /api/v1/auth/signup` (`accounts/serializers.py::SignupSerializer`,
`accounts/services.py::sign_up`, `accounts/views.py::SignupView`):

- `mode = "create_company"`: requires `company_name` (+ optional
  company_* fields). Creates `Company`, the founding `User(role=HR,
  company=that company)`, a seed `CompanyProfile(company=that company)` and a
  seed `TimezoneConfig(company=that company)` (default UTC, matching today's
  value), then signs in. The creating code's `company` column stays NULL
  (operator-issued bootstrap codes are tenantless) or may bind a company for
  additional founders.
- `mode = "join"`: the used `SubscriptionCode` MUST have `company`
  set (§2.5); the new user binds to that company. Founder role on join is
  still HR or EMPLOYEE depending on the code's new `grants_role` field
  (default HR today; field added in the same migration so no behavior change
  for the existing operator flow).
- Existing-email behavior (`email_in_use`, non-enumerating) unchanged.
- `EmployeeProfile.company` and — via the same transaction — `User.company`
  must agree; `employee_service.create_employee` sets both from the actor.

Endpoint change: none in URL shape; one extra body field. Frontend change is
out of scope for this document but `frontend/src/screens/OnboardingCompanyPage.tsx`
and `LoginPage.tsx` are the touched screens (flag to product/UX).

### 2.4 CompanyProfile becomes one-per-company + TimezoneConfig

- `CompanyProfile` (`accounts/models.py:231`): remove
  `CheckConstraint(id=1)`; add `company = OneToOneField(Company,
  PROTECT, related_name="profile")`; keep every field. Add
  `UniqueConstraint(company)` (implied by OneToOne) and drop the id=1 check.
  All readers change from `get(pk=1)` (`company_views.py:50`,
  `serializers.py:61`) to `CompanyProfile.objects.get(company=user.company)`
  — through the scoping layer (§3).
- `TimezoneConfig` (`timesheets/models.py:28`): same treatment —
  `company = OneToOneField(Company, PROTECT, related_name="timezone_config")`;
  drop the `id=1` check. `review/reports.py::organization_timezone()` resolves
  via the caller's company. Existing row migrates into the default company.

### 2.5 SubscriptionCode is the company door

`SubscriptionCode` (`accounts/models.py:285`) gains:

- `company = FK(Company, PROTECT, null=..., related_name="signup_codes")` —
  NULL only for bootstrap "create company" codes.
- `grants_role = CharField(choices=Role.choices, default=Role.HR)` (preserves
  today's behavior for the live operator code).
- New hardening (owner's «شوف اي كمان ناقص»): `max_uses`
  (PositiveIntegerField, null = unlimited, preserved default),
  `expires_at` (nullable), and `created_by` (PROTECT, nullable for
  seed rows) — see §7.9.
- Existing flow: the operator's current code becomes the default company's
  join code with `grants_role=HR` — behavior unchanged.

### 2.6 The data migration (exact order, old-data-in-one-company)

All migrations forward-only in spirit; schema migrations are kept
reversible, the data migration is idempotent.

Order (two-step per app so SQLite's table-rebuild ALTERs are minimized):

1. `accounts.0010_company.py` — create `Company` (no FKs yet).
2. `accounts.0011_tenant_fk_nullable.py` — add nullable `company` FKs:
   `User`, `Department`, `EmployeeProfile`, `ManagerGrant`,
   `SubscriptionCode`, `AuditEvent`, `AssistantConfig`, `PendingDeviceFlow`;
   convert `CompanyProfile` (add nullable `company` OneToOne) and keep the old
   `id=1` check disabled in the same migration (RemoveConstraint first).
3. `accounts.0012_default_company.py` — data migration:
   - `company, _ = Company.objects.get_or_create(slug="__default__")`,
     name from the existing `CompanyProfile` row (fall back "__default__").
   - Attach `CompanyProfile` to it (get/create), copy fields; move
     `TimezoneConfig` the same way (steps 2/3 for timesheets land linearly
     deliberately alongside the accounts data migration (FK targets exist)).
   - Backfill every nullable `company` from `__default__`.
4. `accounts.0013_tenant_fk_hard.py` — `AlterField` every
   `company` to `null=False`; drop nothing else.
5. `reqs.0006_company_nullable` / `0010_company_hard`(+ data backfill
   inside) — same shape for `RequestType`, `EmployeeRequest`, `RequestEvent`,
   `RequestAttachment`, and the four idempotency records. In the same
   bytecode: `RequestType` loses global `unique=True` on `name`; gains
   `UniqueConstraint(company, name)`, and the
   seed migration `reqs/0008_seed_request_types` rows stay (they backfill
   into the default company's RequestTypes). `EmployeeProfile`'s
   `employee_number unique=True` becomes `(company, employee_number)`
   (nullable columns need UniqueConstraint with condition
   `employee_number__isnull=False` — verify against the current DB values).
   `Department.code unique=True` becomes `(company, code)`.
6. `timesheets.000X_company_*` — same shape for `Timesheet`, `TimeEntry`,
   `TimesheetEvent`, three idempotency records, `TimezoneConfig` (singleton
   moved per §2.4). `uniq_timesheet_employee_week_start` becomes
   `(employee, week_start)` — no change needed (employee belongs to one
   company).
7. `holidays.000X_company_*` — `PublicHoliday` gets `company`;
   `uniq_holiday_country_date_name` becomes `(company, country_code, date,
   name)`.
8. `notifications.000X_company_*` — `Notification` gains `company`
   (denormalized from `recipient`; every creator path is
   `notifications/services.py::create_notification` — set it there once).
9. `accounts.0014_signup_code_hardening.py` — SubscriptionCode fields §2.5.

Migration numbering above is indicative — the implementer reads each app's
current head (`git log --stat backend/*/migrations/`) and picks sequential
names; the ORDER and contents are the contract, not the digits.

### 2.7 Rollback story (honest)

Per `DEPLOY_RAILWAY.md:86-95` the volume (DB + attachments) persists and
`migrate` runs forward on every boot; destructive steps cannot be undone by
reverting the deploy. Therefore:

- MANDATORY pre-step before R3 (§9): download/snapshot the volume --
  `railway ssh` + `sqlite3 /data/db.sqlite3 ".backup '/data/db.sqlite3.pre-h30'"`,
  or a Railway volume snapshot if available. Attachments under
  `/data/attachments` are untouched by all migrations and need no snapshot.
- Account schema migrations (AddField/RemoveConstraint/AlterField on
  SQLite = table rebuilds) are `migrate --fake`-able in emergencies but plan
  assumes forward-only: if R3 is bad, restore from the pre-H30 snapshot —
  never `migrate` backwards on the production file.
- The data migration is idempotent (get_or_create `__default__`); re-running
  it after a partial restart heals the backfill instead of duplicating.

---

## 3. ONE enforcement point for scoping

### 3.1 Why the obvious options lose here

- Scattered `filter(company=...)` in every view — rejected outright; it is
  the bug factory the brief warns about (15+ files touch model managers).
- DRF viewset/queryset filtering — this codebase has NO generic viewsets;
  every endpoint is a hand-rolled `APIView` with `_get_*` helpers and locked
  service functions. There is no `get_queryset()` to hook; retrofitting
  viewsets would rewrite every endpoint for less isolation than the
  service-layer design already gives.
- Middleware-bound `request.company` alone — solves read scoping only where
  views consult request; the assistant tools, services under locks
  (`decision_services`, `review_services`, `correction_services`), audit
  writers, and the report CSV layer all reach models without a request
  object. Middleware is kept, but as a secondary check, not the enforcement.

### 3.2 The chosen mechanism: company-scoped managers + one scope module + a static leak guard

New app `backend/tenants/` (INSTALLED_APPS addition; app is empty of models
by design):

1. `tenants/context.py`:
   ```python
   def current_company(user):           # single tenant anchor
       return user.company if user.is_authenticated else None
   ```
   plus `TenantMiddleware` (in `config/settings.py::MIDDLEWARE` after
   AuthenticationMiddleware) that (a) resolves `request.company =
   current_company(user)`, and (b) denies with the standard 404 envelope any
   API request from an authenticated user whose `company` is NULL (a row that
   predates a failed backfill must never browse globally).
2. `tenants/managers.py`:
   ```python
   class TenantManager(models.Manager):
       def of(self, user_or_company):
           c = user_or_company if hasattr(user_or_company, "pk") else current_company(user_or_company)
           return self.get_queryset().filter(company=c)
   ```
   Every tenant model changes to `objects = TenantManager()` in ONE place per
   model (§6 inventory). This makes `Model.objects.of(user)` the ONLY
   authorized read/write entry for the codebase; `.objects.filter(pk=...)`
   without `.of(user)` becomes the mark of a leak.
   Company-anchored models that take company from a PARENT (RequestEvent
   from its request, TimeEntry from its sheet) keep normal managers where
   parent-scope is already guaranteed — inventory in §6 marks them.
3. `tenants/scoping.py`: the company-agnostic composition of `TenantManager.of(user)`
   and the existing intra-company rules — thin wrappers that REUSE
   `review.scope` as-is (once `_scoped_employee_ids` filters
   `EmployeeProfile.objects.of(user)`), plus
   `notifications_for(user)`, `holidays_for(user)`, `employees_for(user)`,
   `assistant_configs_for(user)`, `company_profile_for(user)`.
4. The static leak guard — `backend/tenants/test_scoping_static.py`: a pytest
   that AST-scans `backend/**/*.py` (tests excluded) for
   `(User|EmployeeRequest|| Timesheet|...)`-pattern bare `.objects.` usages
   outside an explicitly allow-listed file set (`tenants/*`, migration files,
   admin). A new unscoped call fails CI with a line number. This is the
   enforcement that scales past the initial refactor — cheap, dumb, effective
   here.

### 3.3 Files the enforcement point touches (complete list)

Writers of scoped reads change together:
`accounts/employee_views.py`, `employee_service.py`, `serializers.py`,
`company_views.py`, `department_views.py`, `department_serializers.py`,
`grant_views.py`, `grant_serializers.py`, `assistant_views.py`,
`assistant_tools.py`, `assistant_serializers.py`, `assistant_subscriptions.py`,
`review/scope.py`, `review/reports.py`, `reqs/views.py`,
`reqs/submission_services.py` (resolves requester's profile line 168),
`reqs/attachment_views.py`, `reqs/services.py`, `timesheets/views.py`,
`timesheets/services.py`, `timesheets/review_services.py`,
`timesheets/correction_services.py`, `notifications/services.py`,
`notifications/views.py`, `holidays/views.py`, `holidays/services.py`,
`config/api.py` (error envelope unchanged). Services under locks keep their
re-authorization — now both intra-company scope AND `company=` match
(`request.company == caller.company`), since the locked fetch inside the
transaction must also be `TenantManager.of(reviewer)`.

---

## 4. Permission matrix (company × role × department)

Legend: ✔=full, ✱=scoped subset, ✖=none (404 envelope as today). Every cell
below is INSIDE the caller's company; the company itself is the row
filter applied by §3 before any role logic.

| Subject | EMPLOYEE (self) | MANAGER (dept ∪ direct reports ∪ active grants) | HR (whole company) | Out of company (any role) |
|---|---|---|---|---|
| Employee (own file) | self read; profile prefs writable | read dept members; write only via HR | read all; write via employee_service | ✖ |
| EmployeeRequest (read) | own, incl. DRAFT | dept ∪ reports ∪ grants, non-DRAFT states per `MANAGER_REQUEST_HISTORY_STATES` | all company, non-DRAFT | ✖ (same 404 as nonexistent) |
| EmployeeRequest (decide) | ✖ (self forbidden) | snapshot manager (`manager_at_submission`) OR department/grant member, PENDING_MANAGER only; self forbidden | PENDING_HR only; self forbidden | ✖ |
| Request cancel/return path | own, DRAFT/RETURNED per state machine | ✖ | ✖ (today) | ✖ |
| Attachment read | own only | ✖ (proposal §7.1) | ✖ today, evaluate §4.2 | ✖ |
| Attachment write/delete | own only (DRAFT/RETURNED) | ✖ | ✖ | ✖ |
| Timesheet (read) | own | dept ∪ reports ∪ grants per `MANAGER_TIMESHEET_HISTORY_STATES` | all company | ✖ |
| Timesheet decide / reopen | own submit (DRAFT/RETURNED) | decide: direct report or granted employee, SUBMITTED; reopen HR only | decide + reopen | ✖ |
| Holiday register | READ all company | READ all company | READ + refresh + (future) edit | ✖ |
| Notification | own only | own only | own only | ✖ |
| Company profile | read own company's | read | read + write (self-serve today via company_views) | ✖ |
| Departments / manager grants | read own department | read own | full CRUD | ✖ |
| Employees admin | ✖ | ✖ | full (company-scoped `_visible_users`) | ✖ (literal cross-company 404 like today) |
| Assistant config | own row only | ✖ | target employee in company only | ✖ |
| Assistant chat | over own data | over queue scope | over directory scope | tool refuses (§5) |
| Audit trail (AuditEvent) | ✖ today; read path = none | ✖ | read all company (future H31 surface) | ✖ |
| Report / CSV export | ✖ | own scope subset (`review/reports.py` authorizes MANAGER/HR only, `scope_label` honest) | company | ✖ |

### 4.1 Where ManagerGrant fits

ManagerGrant (per (manager, employee, scope), `is_active`, PROTECT
`granted_by`) sits INSIDE one company: it files both users into the same
company creationally (the endpoint validates it — see §4.2), and in tables 4
it widens the manager's read+decide for that one employee per the stored
scope value. Nothing changes in its shape; it inherits company filtering via
`ManagerGrant.objects.of(user)` in `_scoped_employee_ids`.

### 4.2 Two scope decisions H30 must make explicit (proposed resolutions)

1. Attachments today are requester-only, but the review read scopes do not
   exclude the manager from seeing them in a request detail — check
   `review/serializers.py` at execution time. Proposal: keep
   requester-only-WRITE; extend read to exactly the roles that may read the
   parent request per the matrix (a manager can read the attachment of a
   PENDING_MANAGER request in their scope; HR can read any company
   attachment). This is a product call — record as an OBSERVATION, not a
   silent change.
2. Employee creation: `employee_service.create_employee` must NOT mkdir a
   `Department` for a different company when handed a dept id — after
   `Department.code` becomes per-company, an integer id from another company
   resolves to nothing (the employee-create path validates dept membership
   in `employee_service.py:97` already via `Department.objects.get`).
   Concretely: every foreign-key validation in `employee_service.py` and
   `grant_serializers.py`/`department_serializers.py` must change from
   `Model.objects.get(pk=...)` to `Model.objects.of(user).get(pk=...)`.

### 4.3 Fixing the read-vs-decide split (the §1.2 contradiction)

Unify decision authorization on the H16 scope (`_scoped_employee_ids`),
keeping `manager_at_submission` as documented fallback EXACTLY where story
docs demanded snapshot semantics (requests). Concretely:

- `timesheets/review_services.py::_authorize_reviewer`: replace the
  direct-report-only check (line 88) with
  `locked.employee_id in review_scope._scoped_employee_ids(reviewer)` —
  department members and granted employees become decidable, and the queue's
  `can_decide=true` finally matches the command endpoint.
- Cross-company: `_scoped_employee_ids` itself gains
  `EmployeeProfile.objects.of(user.get_company())` (tenant-filtered), so
  decidable ids never cross companies by construction.

---

## 5. Assistant «مدام عفاف» scoping (the highest-risk surface)

### 5.1 How every tool gets company and role

- New `ToolContext` dataclass in `accounts/assistant_tools.py`:
  `(user, company, role, is_active, request_id)` — built ONCE per chat turn
  in `assistant_chat.py` from the authenticated user; no tool may read a
  company from `args`, from the provider payload, from a prior turn's data,
  or from the conversation history. Model-controlled text is NEVER a
  credential: tools receive only what the server proved (`request.user`), the
  company is server-derived (`current_company(user)`).
- Confirm path (`assistant_actions.py::sign_action`,
  `accounts/assistant_views.py::AssistantActionConfirmView`): the signed
  token already binds (user_pk, tool, arguments). ADD a `company_pk` field
  into the signed payload, and at confirm time re-check
  `user.company.pk == company_pk` and re-resolve the target INSIDE
  `TenantManager.of(user)` — a user who migrated companies cannot confirm a
  token signed against the old tenant.

### 5.2 What a tool must never accept from the model

- Raw database ids that resolve anywhere: today's
  `assistant_tools.py:373` (`EmployeeRequest.objects.filter(pk=...)`) and
  `:426` (`Timesheet.objects.filter(pk=...)`) become
  `.of(user).filter(pk=...)` — the uuid the model supplies resolves ONLY in
  the caller's company; anything else reads as "not found".
- `request_type_id` (`:287,298,316`): validate via
  `RequestType.objects.of(user).filter(pk=..., is_active=True)`; the ids the
  model supplies must come from `read_request_types` (same company).
- NO numeric `employee_id`/`target_id` argument gets added to any assistant
  tool; directory tools remain read-only demarcations of role. Cross-company
  refusal behavior, concretely:
  - read tools asked for another company's data: return the SAME empty
    404-shaped blob a nonexistent id yields (`{"ok": False, "error":
    "not_found_in_your_workplace"}`), never an existence hint; never say
    «another company».
  - write tools: same refusal + deny EARLY (this is one branch on the
    orphan-fetch inside `_execute_*`, after which the existing
    PermissionError/Http404 machinery answers).
  - every cross-company tool denial writes `AuditEvent(actor=user,
    action="assistant.cross_company_denied", after={"tool": name})"
    so the owner sees probing in the audit trail.
- `read_employee_directory` (`:232`), `read_departments` (`:260`),
  `read_review_queue` (`:210`): route through `tenants/scoping.py` and
  inherit the company filter in `_scoped_employee_ids`; a manager's queue
  never shows another company's rows because the queue queryset is
  `review_scope.scope_requests(user)` (which filters on the tenant-filtered
  `_scoped_employee_ids`).
- `cache` used by `assistant_actions.py` (locmem/`PendingDeviceFlow`) —
  single-use tokens stay per-user (user_pk signed inside): unchanged under
  tenancy.

### 5.3 Files

`accounts/assistant_tools.py` (all 15 tool/execute functions), `assistant_chat.py`,
`assistant_actions.py` (+1 signed field), `assistant_views.py`
(`AssistantActionConfirmView`, `AssistantHRConfigView` via
`_get_employee` line 117 → `.of(user)`), `assistant_subscriptions.py`
(credential rows are OneToOne per user = per company by construction; add
`.of(user)` at the `AssistantConfig.objects.get_or_create(user=user)`
call sites `:808` and `:109` for the write path).

---

## 6. Attachment/file isolation (RequestAttachment, MEDIA_ROOT)

Evidence first: `config/settings.py:150` sets
`MEDIA_ROOT = DJANGO_MEDIA_ROOT` and deliberately configures NO MEDIA_URL —
there is no public media route anywhere in `config/urls.py`; the SPA patterns
(§`spa.py`) serve only `assets/`, `brand/`, and a fixed extension list, and
an unknown path returns `api_not_found`/the shell. Byte delivery happens only
through `reqs/AttachmentDownloadView` via `safe_join` after a
requester-ownership check + scan-status gate + audit. Storage keys are
uuid-based and never filename-derived (`reqs/models.py:162`).

Analysis: the tenancy gap here is NOT file storage (storage keys cannot be
guessed across companies, they're random uuids, and no public route exists) —
it is WHO may serve bytes. Plan:

1. `RequestAttachment` gains `company` (§2.6 inventory) so a corrupted
   or future bulk query can never join across companies.
2. Keep THE download path as the only byte-delivery route — it stays the
   single chokepoint — and change its scope check from
   `_get_own_attachment(user, pk)` (requester-only today) to the matrix
   (§4): `.of(user).get(pk=...)` + `RequestAttachment.request.requester` for
   self OR parent readable via matrix §4.2.1. Consequence: a company-A
   manager/HR who cannot read the parent request still gets the same
   `attachment_download_blocked` audit event and safe 404/422 for a company-B
   attachment — including URL guessing (guessed uuid → not found).
3. The audit trail stays (`attachment_downloaded`,
   `attachment_download_blocked` with reasons) — already
   `reqs/attachment_views.py:223-287`; add the acting user's company into
   `after` for the blocked case (forensic value, no secret).
4. Files are NOT reorganized into per-company directories: that is a data
   migration with zero security value (keys are opaque) and real blast
   radius. Documented residual risk: directory structure stays flat, isolation
   is enforced at the ONE route, and the matrix role of a nonexistent storage
   key is a 404 — same behavior already proven by
   `reqs/test_attachments.py` (extend it, §8).

---

## 7. Security gaps (owner's «شوف اي كمان ناقص») — findings with fixes and severity

Every item below is verified in the code named. Severity: High = exploit
reachable without auth or 1 request; Medium = needs an account or persistence;
Low = hardening.

1. HIGH — Cross-tenant IDOR (the brief's premise): every table global,
   `employee_views._visible_users()` returns every user in the world; signup
  as a signup code opens a global HR. Fix = this entire plan. Residual after H30:
   `reports/categories` known-by-design restricted to scoped caller (already
   `review/reports.py::_authorize`).
2. HIGH — Assistant tools fetch unscoped by model-supplied uuids
   (`assistant_tools.py:373`, `:426` before the service re-check). Fix = §5.
3. MEDIUM — Login/signup throttling is IP-keyed anonymous 10/min
   (`accounts/views.py:21-31`, `settings.py:177-184`) — no per-account
   counter or lockout; a distributed attacker rotates IPs freely, and all
   Railway traffic may share an upstream proxy IP (throttles off in the
   worst case if the header is spoofed). Fix: (a) add
   `accounts/throttles.py::UserAccountThrottle` keyed on (IP, email) with a
   cache-based `django.core.cache` counter of failed sign_in attempts and a
   temporary 15-minute per-account lock after 10 failures; (b) sufficient
   logging of failures into AuditEvent (currently NO audit on failed login —
   see item 7). Do NOT rate-raise by account email globally (offline
   enumeration lever).
4. MEDIUM — Password policy: validators exist (`settings.py:117-122`) with
   `MinimumLengthValidator` default 8. Fix: explicit
   `OPTIONS={"min_length": 12}` for all users OR 8 now + 12 for new HR
   sign-ups (product call — note it); add `django.contrib.auth.password_validation.NumericPasswordValidator`  keeping and
   `UserAttributeSimilarityValidator`; document that a breached-password
   check (HaveIBeenPwned k-anonymity) is the right future layer (needs
   outbound network on Railway — allowed).
5. MEDIUM — Session/cookie flags: `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE`
   default TRUE in non-DEBUG (`settings.py:203-207`), `HttpOnly`, `SameSite=Lax`,
   HSTS 30d (`settings.py:216-218`). Gaps: `SECURE_SSL_REDIRECT` env-gated to 0
   (`settings.py:215`); Railway terminates TLS so a plain-HTTP upstream hit
   is handled by `SECURE_PROXY_SSL_HEADER` — set
   `DJANGO_SECURE_SSL_REDIRECT=1` on the service variables (one-line
   deploy-doc change in `DEPLOY_RAILWAY.md`); add a Content-Security-Policy
   header at the SPA shell (`config/spa.py` — one response header, no
   middleware dependency) — today CSP is missing, which is MEDIUM because
   the SPA renders markdown from the assistant
   (`accounts/assistant_provider.py` output into the chat UI).
6. ⚙ CONFIRMED-FINE — CSRF: `CsrfViewMiddleware` in `MIDDLEWARE`
   (`settings.py:57`), `CsrfEnforcedSessionAuthentication` is
   `DEFAULT_AUTHENTICATION_CLASSES` (`settings.py:170`), anonymous login and
   signup explicitly `enforce_csrf()` (`accounts/views.py:63,121`), and the
   cookie is deliberately readable (`HTTPONLY=False`,
   `settings.py:198`) for the SPA's X-CSRFToken. No csrf_exempt anywhere
   (verified by grep for csrf_exempt — none). Nothing to change; keep
   `CSRF_TRUSTED_ORIGINS` synced with the Railway domain — already in
   `DEPLOY_RAILWAY.md` variables.
7. MEDIUM — Audit coverage. `AuditEvent` exists
   (`accounts/models.py:375`, PROTECT actor/subject, before/after) and is
   written for employee admin (`employee_service.py:141`), department/grant
   changes, decisions (`reqs/decision_services.py:229`,
   `timesheets/review_services.py:198`), submit/cancel, attachments,
   company profile (`company_serializers.py:154`), assistant
   (`assistant_chat.py:312`, `assistant_subscriptions.py:418`,
   `assistant_views.py:344`). Misses, concretely:
   - FAILED and SUCCESSFUL logins (`accounts/services.py::sign_in` error
     path returns without writing) — brute force is invisible today.
   - `deactivate_user` (`accounts/services.py:110-122`) — no audit event
     when an account is turned off (this is the single most sensitive write
     in the app).
   - CSV exports (`review/report_views.py:145` writes one audit but ONLY for
     the transaction; add `report_exported` per download with
     `row_count`).
   - Subscription-code creation/disable (operator-side admin.events).
   - Cross-company denial (new action from §5.2).
   - Signup success: documented deliberate decision
     (`accounts/views.py:106-113` docstring) — KEEP, the code counter is the
     record; but the failed-signup-by-invalid-code probe at high rate should
     land in audit (pair with item 3).
   Fix: add an `accounts/audit.py::record(actor, action, subject, request,
   before, after)` one-liner helper so writers keep a single shape, and
   add a `company` column to `AuditEvent` (§2.6) so the trail itself is
   tenant-scoped (HR of company A must never read company B's audit rows).
8. MEDIUM — Secrets: `SECRET_KEY` fallback `"dev-only-insecure-key-change-me"`
   (`settings.py:17`) fails-fast-on-deploy thanks to the entrypoint's
   refusal without `DJANGO_SECRET_KEY` (per `DEPLOY_RAILWAY.md`); the
   Fernet fallback derives from SECRET_KEY (`accounts/assistant_crypto.py`)
   — acceptable, but rotation of ASSISTANT_SECRET_KEY invalidates stored
   keys (documented). `OPENCODE_GO_API_KEY` is server-side env only (never
   `VITE_*`) — DEPLOY_RAILWAY documents it. Keep `.env` uncommitted
   (`.gitignore` covers it — verified). Residual: AuditEvent snapshots —
   verify at implementation time that no before/after blob ever carries
   api_key_material (the assistant code paths already claim booleans only;
   assert it in `accounts/test_assistant.py` explicitly).
9. MEDIUM — SIGNUP_CODE flow: reusable codes stored PLAINTEXT
   (`accounts/models.py:295-333`), no expiry, no use cap, infinite life,
   and under tenancy (before §2.5) a valid code admits an HR into the ONE
   global org — infinitely. Fixes (bundled): §2.5 binding + `max_uses` +
   `expires_at` + per-code creation/use audit; rotate the historical live
   code after the H30 deploy; document that plaintext holds ONLY because the
   operator reads it back to hand-carry it (owner's own product decision —
   kept, not changed silently).
10. LOW — `Department.code`, `RequestType.name`, `EmployeeProfile.employee_number` uniqueness flips
    to per-company (§2.6 step 5/6) — today an A-company employee #E-1 blocks
    a B-company E-1 and `iexact` login/code probes were global. Already
    covered by migrations; listed so tests cover it (§8.3).
11. LOW — `PendingDeviceFlow.device_code_or_id` is a provider credential in
    a DB column (documented, encrypted-at-rest is NOT used here — the H28
    brief says server-side only). Fix within H30: encrypt with the same
    Fernet pipeline or accept documented residue because its exposure
    shell is one user's own row (`OneToOneField(user)` today). Prioritize
    AFTER the tenancy work.

---

## 8. Test strategy

### 8.1 The cross-company leak suite (new files)

- `backend/tenants/tests_cross_company.py` — the flagship. Parametrized over
  EVERY endpoint × method once the two-company fixture
  (`tests/_h30_fixtures.py`: company A with HR/manager-of-dept/manager-grant/
  employees/requests/timesheets/attachments/holidays/assistant rows; company
  B with the same; shared seeded company C for a "third party") exists.
  Every assertion mirrors the user-visible envelope of today's 404 policy
  (`accounts/employee_views.py::safe_denial` shape):
  - A's EMPLOYEE reads B's employee/request/timesheet/notification/holiday/
    attachment/audit → 404-shaped, empty body of the same kind (no count,
    no hint).
  - A's MANAGER reads/writes B's in-scope peers → same.
  - A's HR (full company scope) hits B's everything → same, including
    `review/requests/queue`
    & reports/CSV (`scope_label` says `HR_ORGANIZATION` but only within A).
  - A's user POSTs to B's uuids (submit/decision/cancel/attachment) → 404,
    atomic side effects verified ABSENT (`EmployeeRequest.objects.count()
    for B` unchanged; `RequestEvent` empty; audit table unchanged).
  - URL guessing: random uuid + real uuid in wrong company both 404.
  - Direct media: `GET /attachments/<wrong-company-key>/download` 404 and
    file bytes do NOT arrive (without being logged as a leak attempt only).
- `backend/accounts/test_assistant_multitenant.py` — every READ and WRITE
  tool in `assistant_tools.py` run with a company-B user against
  company-A ids: `ok:false/not-found` never `ok:true`, `read_employee_directory`
  contains B only, `read_departments` B only, `read_review_queue` B only,
  confirm-token signed in A replayed later from a user who moved companies →
  refused (§5.1), cross-company probe writes
  `assistant.cross_company_denied` audit.
- Extend `backend/reqs/test_attachments.py`: cross-company uuid → the same
  attachment_download_blocked audit reason `out_of_scope` as today's
  out-of company requester; plus manager-of-parent read (§6.2 new rule).

### 8.2 Static guard

- `backend/tenants/test_scoping_static.py` — AST scan (§3.2.4) that fails on
  any bare `Model.objects.*` for tenant models outside the allow-list. Run
  with `pytest backend/tenants/test_scoping_static.py` in CI + locally; it
  doubles as the check-list of the §3.3 files.

### 8.3 The intra-company suite (exists, extend; file names from the repo)

- `backend/review/test_queues.py`, `backend/review/test_reports.py` — after
  §4.3's unification, add: manager of dept D1 sees queue rows of D1
  members and GRANTED outsiders, and CAN decide what the queue showed
  (regression for the read-vs-decide contradiction).
- `backend/accounts/test_employee_admin.py` — HR of A cannot list/reach B's
  employees (`_visible_users` tenant-filtered); duplicate
  employee_number/department code ACROSS companies is legal now (post-uniqueness flip).
- `backend/accounts/test_signup.py` — create_company + join flows; code
  bound to B refuses A-standalone signup; expired/max-used code variants.
- `backend/accounts/test_company.py` — singleton → per-company migration of
  the CompanyProfile / TimezoneConfig reads.
- `backend/reqs/test_decision.py`, `backend/timesheets` review tests —
  decision authorization with `.of(user)` inside the lock (unauthorized
  cross-company reviewer gets LookupError → 404, as the locked re-check
  demands).

### 8.4 How the suite gates rollout

R-target per §9 is "the increment is in" only when the cross-company suite
over its endpoint subset is green AND the static guard passes. The suite
grows in lockstep (endpoints added in R4–R7 get rows in the test matrix
the same commit).

---

## 9. Rollout order and risks

### 9.1 Order (each increment independently testable/deployable)

- **R0 — Foundation, no behavior change.** `tenants/` app skeleton,
  `TenantManager`, `TenantMiddleware` (pass-through while `company` is
  nullable), the static guard test written FIRST and passing against the
  current allow-list. Snapshot volume per §2.7. Test: `pytest` unchanged on
  mainline + the new guard passes.
- **R1 — Company + profiles.** `accounts` Company/CompanyProfile/
  TimezoneConfig migration (§2.1/§2.4) + the `__default__` data migration +
  null→hard FKs for `accounts` tables only. All reads still work: existing
  views switch gradually (the leak still exists, the schema doesn't block).
  Test: `test_company.py` snapshots the per-company reads.
- **R2 — Tenant FKs, the rest of the tables.** §2.6 steps 5–8 migrations
  (reqs, timesheets, holidays, notifications) + constraint flips
  (per-company uniqueness). Test: existing repo tests green (they now run
  against two tenants seeded by the `__default__` fill) + uniqueness cases.
- **R3 — Signup/binding.** §2.3 + §2.5 code fields. From here a NEW signup
  creates its own company — the primary owner complaint becomes impossible
  by construction. Gate: `accounts/test_signup.py` + cross-company suite
  subset for auth endpoints.
- **R4 — Enforcement, accounts surfaces.** `_visible_users`,
  employee/dept/grant/assistant-config endpoints + services through
  `tenants/scoping.py`; audit-helper + `AuditEvent.company`.
  Gate: `test_employee_admin.py`, `test_assistant_multitenant.py` subset.
- **R5 — Enforcement, requests/timesheets/review.** `review/scope.py` tenant
  inside, decision/reopen/submit/cancel inside locks (`.of(user)` on the
  locked fetch), attachments per §6, `notifications/services.py` +
  `related_object` resolution. Gate: full review/reqs/timesheets suites +
  cross-company rest-of-API rows.
- **R6 — Holidays + reports/CSV + assistant tool layer + confirm-token
  company binding.** Gate: full cross-company matrix including §5.
- **R7 — Security hardening batch** (§7 items 3–9 that are independent of
  tenancy): login lockout + audit on failures, password policy bump,
  CSP header, SECURE_SSL_REDIRECT=1 on the Railway service, export audit,
  signup-code expiry/caps. Each is one deploy-safe change; bundle for one
  review, ship separately if review rejects.
- **R8 — Ship-steps:** rotate the live operator code (§7.9), confirm
  DEPLOY_RAILWAY.md variables, run the migration in a maintenance window
  (SQLite table rebuilds are the slowest step — measure on a copy first
  via `railway ssh` + `sqlite3 .backup` replayed from the snapshot).

### 9.2 Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SQLite table-rebuild migrations slow the boot; Railway deploy healthcheck times out | Medium | Marginal downtime / failed deploy | Rehearse on the snapshot copy; set a longer healthcheck window in `railway.json` for that one deploy; keep the R2 batch under ~10 rebuilds |
| A missed unscoped manager bypasses tenant isolation | Medium | Privacy breach (the owner's complaint recurs) | Static guard (§8.2) + service-layer re-checks inside locks + cross-company suite; deny NULL-company users at middleware |
| TenantManager on mutable models silently changes writes that relied on `.create()` defaults | Medium | Data written without company → invisible forever | Explicit `company=` on every `create()`; managers REJECT `.create()` without a company (raise unless `company` in kwargs) — cheap tripwire |
| The data migration's `__default__` bind misses a table (future model without company) | Low | Same leak class as the founding one | Add an H30 test asserting every tenant model has a `company` field (introspection over `apps.get_models()`), standing in CI |
| Old `db.sqlite3.bak-h16`-style habits: the owner's dev DB on 8080 diverges from prod | High (habits) | Confusion during accept | Do NOT touch the 8080 dev server (per task rules); all proofs run `pytest` + a second dev server on 8090 against a copy, mirroring the DEPLOY_H29 pattern |
| ManagerGrant/H16 semantics change (§4.3) surfaces product complaints | Medium | Behavior change beyond isolation | Document in the plan review; keep `manager_at_submission` snapshot semantics for requests exactly as Story 2.4 policy states |
| Assistant becomes a covert channel (a user of A asks about B via the model's creativity) | Low after §5 | High if missed | Tools are the only data path (no raw provider subagent calls); the refusal wording never names companies; audit every denial |
| Sessions leak across tenants after a company re-binding edge case | Low | Low | Session identity stays per-user; binding is server-side; §5.1's confirm re-check covers the migrated-user token case |

## 10. Acceptance criteria (what H30 is done means)

1. Every table in §6's inventory carries `company`; the introspection test
   (§9.2 row 4) passes.
2. The cross-company suite over every endpoint + every assistant tool is
   green; a company-A user cannot even learn that company-B resources exist
   (identical 404 envelope, zero enumeration).
3. The static guard is in CI and its allow-list is minimal.
4. The pre-existing intra-company behavior is preserved for every test in
   `backend/review/*`, `backend/reqs/*`, `backend/timesheets/*`,
   `backend/accounts/*` except the single deliberate unification in §4.3,
   which has its own new test.
5. Old data lives in exactly one `Company` (`slug="__default__"`) and no
   row is lost (row-count assertions per table before/after the migration
   in the R1/R2 review).
6. No code pinned here is implemented until reviewed by the backend lead
   against this plan; the plan only names it.
