# H35 — reports for the manager and for HR (backend contract + UI)

The owner's request, verbatim: «عاوزك تضيفلي ريبورتات للمدير وريبورتات للاتش ار».

What exists today (verified): `review/reports.py` with **two** categories
(`requests`, `timesheets`) and four endpoints each — `/rows`, `/totals`,
`/dashboard`, `/csv` — all correctly tenant-scoped (`scope_requests` /
`scope_timesheets`: a manager sees their own department/reports, HR sees their
own company) **and the frontend has no reports screen at all**.

## The owner's answers

- **Manager report**: team requests by status, team hours by week + employee,
  team attendance, CSV export for all of it.
- **HR report**: every company request by status, every employee's hours by
  employee / department / week, attendance + **month closing**, employees and
  departments counts.
- **Shape**: a NEW reports page with filters (**from/to date, department,
  employee**) and simple charts.

## The contract to build against (both sides fix this first)

Every report endpoint keeps its current shape and gains the missing pieces.
`category` is one of `requests` | `timesheets` | `attendance` | `people`.

Filters accepted as query params on `rows`/`totals`/`dashboard`/`csv`:
`from`, `to` (ISO dates, inclusive; default = the current week), `department`
(id), `employee` (id), `status` (repeatable). A filter that names a department
or employee the caller cannot see is **not** an error to leak: it must simply
narrow to nothing (the queryset is already scoped, so resolve the id inside the
scope and 403/404 only when the id is entirely outside it).

- `requests` (exists) — team/company requests by status.
- `timesheets` (exists) — hours by week and employee.
- **`attendance` (new)** — from the attendance register: present / absent /
  leave / incomplete per employee, and the **month closing** (`totals` with
  `from`/`to` covering a month returns per-employee totals ready for payroll).
- **`people` (new)** — employee and department **counts** (active employees,
  per-department headcount, managers).
- `/csv` returns the same rows as `/rows` with `Content-Disposition`, audited.

**Scoping is the server's job and must stay that way.** A manager's report is
their department/reports; HR's is their company; nothing crosses a company.
Do NOT add any company/tenant parameter to the API.

## Backend task (backend_engineer)

Implement the two new categories + the filter set + the month-closing totals on
the existing endpoints. Reuse `scope_requests`/`scope_timesheets` and the
attendance/people sources rather than writing new unscoped queries — a new
unscoped queryset here would reintroduce exactly the leak H30 removed.
Tests: each new category scoped for both roles, a cross-company department id
narrowing to nothing, the month closing totals, and the CSV shape.
`pytest -o addopts=""` must stay green except the known env cookie test.

## Frontend task (frontend_engineer)

ONE new reports screen (a route both roles can open; the DATA differs by role
because the server scopes it — never filter by role in the client):
- filters: from/to, department, employee (dropdowns fed by the real endpoints)
- per category: a totals strip, a simple table, and a simple chart (no new
  chart dependency — reuse what the repo already has, or draw with CSS/SVG)
- a CSV download button per category
- honest empty states ("لا توجد بيانات في هذه الفترة") — never fake rows
- keep the existing design language and Arabic copy; `npm run lint` and
  `npm run build` must pass (there is no `npm run check`).

Both: do not commit, stage or stash; do not touch port 8080.
