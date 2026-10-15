# Deploying to Railway — one service, SQLite on a volume

H29 (revised per owner plan change): Railway **Free plan** = $1/month of usage,
1 vCPU / 0.5 GB RAM / 3 services / **0.5 GB volume storage**. A Postgres
service does not fit that budget, so the deploy is **ONE service and NO
Postgres**: one image serving the API and the built SPA from the same origin,
with the database as a **SQLite file on a mounted volume**. (In-memory/Pending-
flow state, sessions, and uploaded attachments all live in that file/directory,
which is exactly why it must be on the volume, not in the image layer.)

## What the image assumes (already sensible defaults in it)

- Volume mounted at **`/data`** (enforced by `requiredMountPath` in
  `railway.json`: the deploy refuses until a volume is attached there).
- `DJANGO_USE_SQLITE=1`, `DJANGO_SQLITE_PATH=/data/db.sqlite3`,
  `DJANGO_MEDIA_ROOT=/data/attachments`, `DJANGO_DEBUG=0` — all four are baked
  as image ENV; you may override any of them but should not need to.
- Entrypoint (`/app/backend/docker/entrypoint.sh`): fixes `/data` ownership,
  drops to `appuser`, verifies the DB path is writable, runs `migrate`, then
  execs gunicorn on `$PORT` with **2 workers max** (SQLite + 0.5 GB: more
  workers just pile writers onto one file).
- No secrets are baked in: `.env`, `auth.json`, and venvs never enter the
  build context (`.dockerignore`).

## Yes/once setup (Railway CLI, or the dashboard equivalent)

```bash
npm i -g @railway/cli
railway login
railway init                      # create the project
railway up                        # build from the Dockerfile + railway.json
# IMPORTANT: attach the volume BEFORE the first real deploy (up may fail
# readiness without it, by design — requiredMountPath):
railway volume add --mount-path /data
railway redeploy                  # now start with the volume attached
railway domain                    # e.g. heya-fawda-production.up.railway.app
```

Dashboard equivalent: create a service (GitHub/deploy) → **Volumes** tab →
new volume, mount path `/data` → Variables → set the secrets below →
Settings → Networking → generate domain.

## Environment variables — set these ONCE on the service

Railway injects `PORT` itself; the entrypoint binds to it. Everything else
comes from the variables tab. **No Postgres variables, no database plugin.**

| Variable | Value / how to get it |
|---|---|
| `DJANGO_SECRET_KEY` | `python -c "import secrets; print(secrets.token_urlsafe(64))"` — required when `DJANGO_DEBUG != 1`; the entrypoint refuses to boot without it (settings.py holds an insecure dev-only fallback that must never ship). |
| `DJANGO_DEBUG` | `0` (baked in the image; set it only if you want an explicit copy) |
| `DJANGO_ALLOWED_HOSTS` | your domain, e.g. `heya-fawda-production.up.railway.app` (no scheme; comma-separated if several) |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `https://heya-fawda-production.up.railway.app` (WITH scheme) |
| `DJANGO_USE_SQLITE` | `1` (baked in) |
| `DJANGO_SQLITE_PATH` | `/data/db.sqlite3` (baked in) |
| `DJANGO_MEDIA_ROOT` | `/data/attachments` (baked in) |
| `ASSISTANT_SECRET_KEY` | recommended beyond a demo: separate Fernet key at rest (see `.env.example`) — rotating it invalidates stored keys (users re-save) |
| `OPENCODE_GO_API_KEY` | server-side only, for the «مدام عفاف» assistant. NEVER a `VITE_*` variable. |

The session/CSRF cookie flags (Secure, HttpOnly, SameSite=Lax),
`SECURE_PROXY_SSL_HEADER`, and HSTS in non-DEBUG are already handled in
`config/settings.py` — nothing to configure.

## Nightly holidays refresh (cron)

`deploy/holidays-refresh.cron` is for a self-managed server. On Railway, do
not run cron inside the container (the image has no cron daemon and charging a
second service for it makes no sense on this plan). Options: run it from your
laptop on a schedule against the deployed app's management command via
`railway run python manage.py refresh_holidays`, or leave it off — the
register is refreshed when someone runs it by hand.

## Verify the deploy

```bash
curl -s https://<your-app>.up.railway.app/health/ready   # {"status":"ok","checks":{"database":"ok"}}
curl -s https://<your-app>.up.railway.app/api/v1/auth/csrf  # {"data":{"csrftoken":"…"}}
open https://<your-app>.up.railway.app/                 # the SPA sign-in screen
```

Then from the browser: create a test account, sign in, open the assistant
config screen (this exercises the API + DB + `GCS`ing nothing else), and
finally sign out. If `railway logs` shows the entrypoint FATAL messages above,
read them — they tell you exactly which variable/volume is missing.

## Rollback

The volume (DB + reports + attachments) persists across redeploys and
rollbacks; only the image is rolled back. `migrate` runs forward on every
boot — a destructive migration cannot be undone by reverting the deploy; you
must manually replay it BACKWARD on the SQLite file first (e.g. download the
db file via `railway ssh` — or plan migrations forward-only as the project
docs require). `PendingDeviceFlow` (H28) is persisted in the DB, so the
subscription-link flow survives redeploys mid-link.

## Local proof (H29 ordering contract)

Docker is not installed on this machine, so this exact sequence is what runs
after `docker` is available (the same commands, with a local docker run on
**port 8090 only** — the owner's dev server on 8080 stays untouched):

```bash
docker build -t tracking-sys .

# throwaway persistent store: docker-managed volume named h29data (like an empty Railway volume)
docker volume create h29data
docker run --rm -p 8090:8000 -v h29data:/data \
  -e DJANGO_SECRET_KEY=local-proof-not-a-real-secret \
  -e DJANGO_USE_SQLITE=1 \
  tracking-sys

# in another terminal:
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8090/   # 200 + SPA HTML
curl -s http://localhost:8090/api/v1/auth/csrf                   # {"data":{"csrftoken":…}}
```

(Fully throwaway ephemeral run instead: add
`-e DJANGO_SQLITE_PATH=/tmp/proof.sqlite3 -e DJANGO_MEDIA_ROOT=/tmp/attachments`
and drop the `-v` — data will NOT survive that container.)
