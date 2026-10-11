# Heya Fawda?

**هي فوضى؟** — Arabic-first employee requests and time-tracking system.

## Project stack

- Backend: Django + Django REST Framework
- Frontend: React + TypeScript + Vite
- Database: SQLite for the demo (`backend/db.sqlite3`); PostgreSQL settings exist in `.env` but
  `POSTGRES_PASSWORD` is empty, so a Postgres run fails with `fe_sendauth: no password supplied`.
  Set `DJANGO_USE_SQLITE=1` for the demo store.
- Workflow: BMAD BMM
- Appearance: System (default), Light, and Dark

## Running it locally

Django serves BOTH the built SPA and the API on one origin (`config/spa.py` reads
`frontend/dist`), so a static file server is not a substitute for the backend — the SPA
would load but every request under `/api/v1/` would fail, and the sign-in screen would
report a server error. Build the frontend, then run the backend:

```bash
cd frontend && npm run build:demo          # writes frontend/dist
cd ../backend
DJANGO_USE_SQLITE=1 \
PYTHONPATH="$PWD/.venv/lib/python3.11/site-packages" \
/usr/bin/python3.11 manage.py runserver 0.0.0.0:8080
```

- Use `/usr/bin/python3.11` with the venv's `site-packages` on `PYTHONPATH`: `backend/.venv`
  was created from a rotating Hermes runtime interpreter and breaks when that generation is
  replaced.
- Check it: `/health/ready` reports the database, `/api/v1/auth/csrf` returns JSON, and an
  unknown `/api/v1/...` path must be a JSON 404 (not the SPA shell).
- Demo accounts (`manage.py seed_demo_accounts`) live in the SQLite store:
  `employee@demo.local`, `manager@demo.local`, `hr@demo.local`.

## Project documentation

- [Project context](docs/PROJECT_CONTEXT.md)
- [Work log](docs/WORK_LOG.md)
- [Constitution](specs/constitution.md)
- [Product brief](_bmad-output/planning-artifacts/briefs/brief-tracking_system_project-2026-09-11/brief.md)
- [UX and brand direction](_bmad-output/planning-artifacts/ux/ux-brand-direction.md)
- [Architecture and security](_bmad-output/planning-artifacts/architecture/architecture-security.md)
- [Master plan](/.hermes/plans/2026-09-10_021026-employee-operations-blueprint.md)

This repository is dedicated to Tracking-sys. Odoo work uses separate repositories,
profiles, skills, memories, and team rules.
