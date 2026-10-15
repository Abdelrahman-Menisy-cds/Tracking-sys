# H17 — Company profile: backend (model + API)

## Why

Self-service HR signup (H14) activates an account with a subscription code and
then drops the HR user straight into the app. The organisation's own identity is
never captured, so nothing in the product can say whose company this is.

The product decision (from the owner): **immediately after the subscription is
activated, the first thing the HR user does is enter the company's data**, and
that data must be stored and shown again in a widget inside the organisation
settings page. This brief is the backend half: the model, the API, and the tests.
A separate brief covers the frontend gate, the onboarding screen, and the widget.

## Repository and runtime (verified, do not re-derive)

- Repo: `/home/menisy/Desktop/Me/tracking_system_project` (Django backend in
  `backend/`, React+TS+Vite frontend in `frontend/`).
- The running server is Django serving both the API and the built SPA on
  `http://192.168.1.19:8080`. Current cmdline, per `README.md`:
  `DJANGO_USE_SQLITE=1 PYTHONPATH="$PWD/.venv/lib/python3.11/site-packages" /usr/bin/python3.11 manage.py runserver 0.0.0.0:8080 --noreload`
- Database: SQLite (`backend/db.sqlite3`) with `DJANGO_USE_SQLITE=1`.
- Tests: the project's pytest runner, config in `backend/pytest.ini`.
- API prefix: `/api/v1/` (`backend/accounts/urls.py`), responses use the
  project's `{"data": ...}` envelope and its existing error shape — read
  `backend/accounts/views.py`, `permissions.py`, and `tests.py` first and match
  them exactly rather than inventing a new convention.
- After any model change: `makemigrations` + `migrate`, then **restart the
  server** (it runs with `--noreload`, so Python edits need a restart) and
  report the new pid and the exact command you used.

## Model — `accounts/models.py`

Add `CompanyProfile`: an organisation-wide **singleton**, following the
`TimezoneConfig` precedent in `timesheets/models.py` (single row, forced pk,
module docstring explaining why).

Required (blank is a validation error):

| field | type | meaning |
|---|---|---|
| `name` | CharField(200) | اسم الشركة |
| `activity` | CharField(200) | النشاط |
| `address` | CharField(300) | المقر |
| `phone` | CharField(32) | تليفون الشركة |

Optional (the owner explicitly asked that some fields be optional):

| field | type | meaning |
|---|---|---|
| `email` | EmailField(blank=True) | إيميل الشركة |
| `website` | URLField(blank=True) | الموقع |
| `logo_data_url` | TextField(blank=True) | الشعار as a `data:image/...;base64,` string |
| `commercial_register` | CharField(64, blank=True) | السجل التجاري |
| `tax_card` | CharField(64, blank=True) | البطاقة الضريبية |
| `contact_name` | CharField(120, blank=True) | مسؤول الاتصال |
| `contact_role` | CharField(120, blank=True) | وظيفته |
| `contact_phone` | CharField(32, blank=True) | تليفونه |

Plus `updated_at` (auto_now) and `updated_by` (FK to the user, null=True).

Validation rules that must be enforced server-side:
- `logo_data_url`, when non-empty, must start with `data:image/` and must be at
  most 200_000 characters, otherwise a field error. The frontend resizes before
  sending, but the server is the authority.
- `phone` / `contact_phone`: digits, spaces, `+`, `-`, `()` only.

## API

1. `GET /api/v1/company` — HR-only. Returns
   `{"data": {"profile": {...} | null, "needs_profile": <bool>}}` where
   `needs_profile` is true when any required field is blank (true when no row
   exists). Include every field above in `profile`.
2. `PATCH /api/v1/company` — HR-only, partial update. The merged result must
   still satisfy the required fields, otherwise 400 with per-field errors.
   On success: 200 with the same shape as GET, and an `AuditEvent` recording the
   actor and the changed fields (follow the existing audit precedent in
   `employee_views.py` / `models.AuditEvent` — read it, don't guess).
3. `GET /api/v1/auth/me` (`views.MeView`) — add `needs_company_profile` (bool,
   same computation as above) to the existing payload. The frontend gate reads
   it from there.

Permissions: HR/admin only for both company endpoints; an employee or a manager
gets the project's standard 403 shape. Reuse the existing permission helper.

## Files

- `backend/accounts/models.py` — the model.
- `backend/accounts/company_serializers.py` — read + write serializers (follow
  `department_serializers.py` style).
- `backend/accounts/company_views.py` — the two views.
- `backend/accounts/urls.py` — the two routes.
- `backend/accounts/views.py` — the `/auth/me` addition.
- `backend/accounts/migrations/00xx_companyprofile.py` — generated.
- `backend/accounts/test_company.py` — tests.

## Tests to write (pytest, project runner)

1. GET with no row: `profile` null, `needs_profile` true.
2. PATCH missing a required field: 400, per-field error, nothing stored.
3. PATCH with the four required fields only: 200, then GET reports
   `needs_profile` false and `/auth/me` reports `needs_company_profile` false.
4. PATCH with every optional field set: all round-trip unchanged.
5. PATCH as an employee: 403; as a manager: 403.
6. `logo_data_url` rejected when it is not `data:image/...` and when it exceeds
   the cap.
7. Singleton: two saves leave exactly one row.
8. PATCH that would blank a required field: 400.
9. An AuditEvent is written on a successful update (and not on a rejected one).

## Acceptance evidence (report all of it)

- `pytest` output for the new file **and** the existing suites (no regressions),
  with the exact command.
- The migration filename and the `migrate` output.
- The new server pid + the exact restart command, and proof the app is still
  reachable: `curl -s -o /dev/null -w '%{http_code}' http://192.168.1.19:8080/`.
- A live end-to-end probe against the running server with `curl` (or a short
  python script) that: bootstraps CSRF, signs up a fresh HR with the subscription
  code `Menisy2002`, reads `/auth/me` (expect `needs_company_profile: true`),
  PATCHes the four required fields, re-reads `/auth/me` (expect false) and
  `GET /company` (expect the values back). Paste the real responses.
- Every claim must be backed by real command output. No placeholders, no
  "should work", no invented responses.

## Out of scope

Frontend (gate, onboarding screen, settings widget) — a separate brief.

## Git

Do **not** commit, stage, or stash anything. The working tree already holds
uncommitted work from another task; leave every file you did not write exactly
as you found it.
