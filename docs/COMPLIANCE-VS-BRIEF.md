# Compliance vs. the Product Brief
### `Employee_Requests_and_Time_Tracking_System.pdf`

Reviewed against the brief's §5–§18. Evidence is what the repository and the live
service actually contain, checked on 18 Oct 2026 — not what was intended.

---

## 1. Verdict

The product is **substantially compliant**. Every core module in §6 exists and is
wired end to end, RBAC is enforced server-side, the SpecKit artifacts are real,
and the app is deployed and reachable. Three gaps remain, and only one of them is
a hard requirement: **the deployed instance runs SQLite, not PostgreSQL**.

---

## 2. Role capabilities (§5) — met

| Role | Required | State |
|---|---|---|
| Employee | profile, own requests, own timesheets, status + history | ✓ `emp1@demo.local`; `/requests`, `/timesheets`, detail routes |
| Manager | direct reports, approve/reject/return requests, review timesheets, team hours | ✓ `manager@demo.local`; `/reviews`, `/reviews/requests/:id`, `/reviews/timesheets/:id` |
| HR | employee records, org-wide oversight, reports, request types + settings | ✓ `hr@demo.local`; `/admin`, `/reports` (4 tabs), `/admin/employees` |

Authorization is enforced in Django (`IsHR`, ownership scopes), not by hiding
controls: an anonymous caller gets 401 and a foreign-company id gets 404 —
verified against the live API.

---

## 3. Core modules (§6) — met

| Module | Evidence |
|---|---|
| Authentication & users | session auth + CSRF; `/api/v1/auth/{csrf,login,me,logout}` |
| Role-based access | server-side permission classes + ownership scopes |
| Employee requests | create, edit draft, submit, cancel; status history |
| Request approvals | manager → HR routing, per-request-type flags, return for correction |
| Timesheets | daily entries, draft, submit, read-only after submit |
| Timesheet review | approve / reject / return for correction |
| Dashboards | home (personal work, weekly target, notifications), team, HR panel |
| Search & filters | status/department/employee/date filters; **cascading** (department → employee) |
| Notifications | in-app notification list with unread state |
| Reporting | `/reports` with requests / timesheets / attendance / people tabs, totals + CSV export |

---

## 4. Gaps

### 4.1 ✗ Deployed database is SQLite, not PostgreSQL — **hard requirement**
§10 and §16 require PostgreSQL with migrations. The codebase **does** support it
(`psycopg==3.3.5`, `settings.py:114` selects the PostgreSQL backend by default);
the deployed service is started with `DJANGO_USE_SQLITE=1` and keeps its database
on the mounted volume (`/data`), so the live instance is SQLite.

**Fix**: provision a Railway PostgreSQL service, drop `DJANGO_USE_SQLITE` from the
service variables, set `DATABASE_URL`, and let the entrypoint run `migrate`. The
migrations are already versioned (through `accounts/0015`).

### 4.2 ✗ SpecKit layout differs from §13's suggestion
`specs/` holds `constitution.md`, `acceptance-criteria.md`, `permission-matrix.md`
and three state machines — real and useful, but flat. The brief's suggested shape
is numbered features (`001-brand-product-foundation/spec.md, plan.md, tasks.md` …).

**Fix**: either add the numbered folders alongside what exists, or note in the
README that the flat set is the deliberate equivalent. Either way, say it out loud
in the presentation.

### 4.3 ✗ Deliverables that are documents, not code
§17 asks for AI-usage evidence, a presentation, and technical documentation
(architecture, data model, API). `docs/WORK_LOG.md` and `docs/PROJECT_CONTEXT.md`
partly cover this; an explicit AI-usage record and an API/architecture document do
not exist as such.

---

## 5. Testing scope (§15) — met, with one caveat

138 test modules cover authentication, the three roles and their ownership
boundaries, request create/validate/submit/review, timesheet create/edit/submit/
review/return, unauthorized API access, filters, pagination and empty results.

Caveat: the suite runs under **pytest**, not `manage.py test` (the tests are
plain `def test_*(db)` functions), so the brief's reader must be told the runner.

---

## 6. Security (§12) — met, and this session found a real breach

Server-side RBAC, ownership checks, input validation, secrets outside the repo
(`.env`, `.railwayignore` excludes them from the deploy upload), pagination and
migrations are all in place.

**Found and fixed this session**: `DepartmentListView.get` was
`Department.objects.all()` — an HR account received **every tenant's**
departments. Three sibling queries in the same file had the same flaw. All four are
scoped to `request.user.company` now, with 404 on a foreign id, and the department
endpoints are covered by `tenants/test_isolation.py`.

---

## 7. Deployment (§16) — met

- Live URL: `https://heya-fawda-production.up.railway.app` (HTTP 200, `/health/live` ok)
- Migrations run in `backend/docker/entrypoint.sh`
- Secrets in Railway variables, never in the repo
- **Demo credentials for all three roles**: `hr@demo.local`, `manager@demo.local`,
  `emp1@demo.local` — all `demo1234`
- README present

---

## 8. What this session changed (for the AI-usage record)

Fixed: the tenant-isolation leak in the department endpoints · the demo banner
that called real data fake · a crash on an empty date in the timesheet report ·
cascading report filters · the onboarding tour re-running per page and per sign-in ·
the schedule feature (model, API, add button) · the assistant card rendering
`[object Object]` · a refused submit speaking in machine tokens · the assistant
panel's empty space and duplicated waiting state · the sidebar toggle (modern
chevron, moved into the rail, slim collapsed rail) · a modern scrollbar · the tour
and theme defaults · and the deploy itself (`.railwayignore`, the real build
instead of the demo build, demo data seeded on the server).

Every one of those is committed with the reasoning in the message body.
