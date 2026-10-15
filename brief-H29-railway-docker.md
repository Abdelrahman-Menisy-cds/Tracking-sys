# H29 — make this repo deployable on Railway (Docker + Postgres, ONE service)

**CHANGE OF PLAN — the owner's latest decision (this overrides anything below
that mentions Postgres):** the owner will use Railway's **Free plan** — $1/month
of usage, with limits of 1 vCPU / 0.5 GB RAM / ONE project / 3 services /
**0.5 GB of volume storage**. A Postgres service alongside the app does NOT fit
that budget. So: **ONE service, NO Postgres.**

Use **SQLite on a Railway Volume**:
- mount a volume (e.g. at `/data`) and put the SQLite file on it
  (`DJANGO_USE_SQLITE=1`, DB path under `/data`). The DB must live on the volume,
  never in the image or the ephemeral layer — the container filesystem is wiped on
  every deploy.
- gunicorn with **1–2 workers** only (0.5 GB RAM).
- No Postgres env vars, no Postgres plugin.

Everything else stands: Docker, one service (Django also serves the built SPA),
multi-stage image, no secrets in the image, entrypoint runs `migrate` then
gunicorn on `$PORT`. Where the "Deliverables"/"Prove it" sections below mention
Postgres, read **SQLite on the volume** instead.

---


## The repo

`/home/menisy/Desktop/Me/tracking_system_project`
- `backend/` — Django 5.2.6 + DRF, deps in `backend/requirements.txt`
  (psycopg 3, cryptography, python-dotenv, uritemplate, inflection; pytest for tests)
- `frontend/` — Vite + React SPA; the production build is `npm run build:demo`,
  output in `frontend/dist`, which **Django already serves** in dev (that is the
  mechanism — do not invent a second static server)

Verified facts (do not re-derive, but do re-verify after your change):
- The backend **never spawns** `codex`/`opencode` — there is no `subprocess` use
  in `backend/**` outside `.venv`. Both subscription flows are pure HTTP/OAuth, so
  **no CLIs belong in the image**.
- `backend/config/settings.py` already reads Postgres from env
  (`POSTGRES_DB/USER/PASSWORD/HOST/PORT`), and uses SQLite only when
  `DJANGO_USE_SQLITE=1`. So Postgres needs no code change.

## Deliverables

1. **A `Dockerfile`** at the repo root, multi-stage:
   - stage 1 (node): build the SPA (`npm ci`, `npm run build:demo`) → `/app/frontend/dist`
   - stage 2 (python:3.11-slim): install `backend/requirements.txt` **plus
     `gunicorn`** (it is not currently listed — add it to requirements.txt), copy
     the backend and the built `dist`, run `collectstatic` at build or start.
   - **No secrets baked in.** Never copy `.env`, `auth.json`, or a venv.
2. **An entrypoint** that: waits for the DB to be reachable, runs
   `manage.py migrate`, then serves with gunicorn bound to `$PORT` (Railway sets
   it). Fail loudly if `SECRET_KEY` is missing in a non-DEBUG run.
3. **`.dockerignore`** (exclude `backend/.venv`, `frontend/node_modules`,
   `frontend/dist`, `.git`, `.env`, `*.sqlite3`).
4. **`railway.json`** (or documented Railway settings) pinning the Dockerfile
   build and the start command, plus a `README`-style **deploy note** listing the
   exact env vars the owner must set:
   `SECRET_KEY`, `DEBUG=0`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`,
   `POSTGRES_DB/USER/PASSWORD/HOST/PORT` (Railway's Postgres plugin provides
   most of these — map them, do not hardcode).
5. **Settings hardening only if actually needed** (e.g. `ALLOWED_HOSTS` from env,
   `CSRF_TRUSTED_ORIGINS` from env, `SECURE_PROXY_SSL_HEADER`). Keep it minimal;
   do not restructure settings.

## Constraints

- **Do not commit, stage, stash, or push.**
- **Do not touch the running dev server on port 8080** — the owner is using it
  right now to link a subscription. Build and test on **other ports only**
  (e.g. run your container on `-p 8090:8000`).
- The pending-subscription-flow persistence (H28) must be in place before this is
  useful in production: on a server every deploy restarts the process, so an
  in-memory flow would die mid-link. **Verify it is persisted; if it is not,
  report that clearly** rather than silently shipping a broken link flow.
- Docker may need to be started/installed — if `docker` is unavailable, say so
  plainly and deliver the files anyway, with the exact commands the owner must run.

## Prove it

- `docker build` succeeds (paste the tail of the real output).
- Run the image locally against a **Postgres** container (or an existing local
  Postgres — the host has one on :5432; do NOT use the project's dev database,
  create a throwaway one) on `-p 8090:8000`, then:
  - `GET /` returns the SPA (200, and the HTML references the built bundle)
  - `GET /api/v1/auth/csrf` returns 200
  - sign up a throwaway user and `GET /api/v1/assistant/config` returns 200
  - the migration ran (show the real output)
- Report the real commands and their real output. No invented results.
