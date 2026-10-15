# H14 (backend) — subscription-code signup: «أول مرة؟ إنشاء حساب»

Implement the **server** half of a self-service signup for HR accounts. The frontend half (login page
UI) is a separate job and is **not** yours: do not touch anything under `frontend/`.

## The product
`/home/menisy/Desktop/Me/tracking_system_project` — a company time-tracking/attendance web app.
Arabic-first RTL SPA + a Django REST Framework backend in `backend/`. The backend serves the SPA on
the same origin (port 8080) so the session cookie and CSRF token stay first-party. PostgreSQL is the
approved database (`config/settings.py`: sqlite only when `DJANGO_USE_SQLITE=1`).

## What exists today (read these before writing anything)
- `backend/accounts/models.py` — email-based `User` (`AbstractBaseUser`), roles `EMPLOYEE` /
  `MANAGER` / `HR`, `is_active`, `EmployeeProfile`, an append-only `AuditEvent` whose `actor` is a
  required `PROTECT` FK.
- `backend/accounts/views.py` + `urls.py` — the auth contract, mounted under `/api/v1`:
  `POST auth/login`, `POST auth/logout`, `GET/PATCH auth/me`, `GET auth/csrf`.
  `LoginView` is anonymous-reachable, enforces CSRF **explicitly** via
  `CsrfEnforcedSessionAuthentication().enforce_csrf(request)`, is throttled by an `AnonRateThrottle`
  subclass (`scope = "login"`), and returns a non-enumerating `invalid_credentials` error through
  `config.api.error_payload`.
- `backend/accounts/services.py` (`sign_in` / `sign_out`), `serializers.py`, `throttles.py`,
  `permissions.py`, `authentication.py`, and the tests (`tests.py`, `test_preferences.py`,
  `test_employee_admin.py`; runner config in `backend/pytest.ini`).
- `backend/accounts/management/commands/seed_demo_accounts.py` — the seeding precedent.

**Follow these conventions, not your own.** A new endpoint that ignores the CSRF/throttle/error
envelope or invents its own response shape is wrong even if it works.

## Deliverable — the subscription-code signup

1. **A model for the subscription code** (in `accounts`): the code itself (unique, indexed), a short
   label/note field for the operator, `is_active`, `created_at`, `last_used_at`, and a use counter.
   A code is reusable while active (several people may subscribe with the same code) — do not build
   single-use semantics. Deciding where the code is *checked* is part of the model's job: keep the
   comparison constant-time-safe and store the real value, since an operator must be able to read it
   back to hand it to a subscriber.
2. **A migration** for it.
3. **A management command** that seeds a code **idempotently** — the value comes from a CLI argument
   or an environment variable, never hardcoded in the source. Run it for the code `Menisy2002`
   (this is the code the product owner wants live) and prove it landed by querying the row back.
4. **`POST /api/v1/auth/signup`** — anonymous-reachable, modelled directly on `LoginView`:
   - enforces CSRF the same way, is throttled (a scope of its own, comparable limit to login's 10/min);
   - takes `{ email, code, password }`;
   - **a new email + a valid active code** → creates an **HR** account (`role=HR`, `is_active=True`,
     a real password hashed through Django's validators — reject weak passwords with the validator
     messages the app already uses), records the code's use, and **signs the user in** (reuse the
     `sign_in` service so the session/CSRF behaviour is identical to login) — the point of the flow is
     that a valid code lets you straight in;
   - **a valid code + an email that already exists** → do NOT hijack or re-role an existing account
     and do NOT leak which emails exist: return a clear, non-enumerating outcome the UI can show, and
     the account's `role` must be unchanged;
   - **a wrong/inactive code** → rejected, non-enumerating about other accounts, an error the UI can
     render as «الكود غير صحيح»;
   - the response envelope matches the app's (`{"data": …, "meta": …}`), and a successful signup's
     `data` is the same `CurrentUserSerializer` shape `login` returns.
   - Do **not** fabricate an `AuditEvent` actor for a self-signup (the FK is `PROTECT` and a
     self-service caller has no actor). Record the decision in the module docstring.
5. **Tests** (the project's pytest runner) covering: a valid code creates an HR user and returns a
   signed-in session; a wrong code is rejected and creates nothing; an inactive code is rejected; an
   existing email is handled without re-roling or leaking; a weak password is rejected; CSRF is still
   enforced on the unsafe method; the throttle class is wired. Every test must fail if the behaviour
   it names is removed — no test that only asserts a status code without the state change.

## Environment / how to run
- The app's live server is the Django process listening on **:8080** (`ss -ltnp` shows it); find how
  it was started (its cmdline/env) so you run `manage.py` with the **same** settings and database
  credentials — a migration applied to a different database is a false result.
- Use the backend's own virtualenv (`backend/.venv`).
- Run: `python manage.py makemigrations` → `migrate` → the seed command → the tests.
- If the live server does not auto-reload, restart it after migrating and prove the new endpoint
  answers (a real HTTP call, including the CSRF bootstrap, not just a unit test).
- Do **not** commit anything. Do not touch `frontend/`.

## Report back (exact, because I verify independently)
1. Files changed/created with line counts, and the migration's name.
2. The exact commands you ran and their real output — including the failure path (a wrong code) and
   the success path (a real signup) as actual HTTP responses, with the created user's email + role
   queried back from the database.
3. The seeded code row as it exists in the database (query it back; do not restate the seed command).
4. Anything in this spec you could not do, and what you did instead.
5. The exact route + request/response shape the frontend must call, and whether the live :8080 server
   currently has your migration applied.
