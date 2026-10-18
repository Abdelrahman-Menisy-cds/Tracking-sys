# syntax=docker/dockerfile:1

# ============================================================================
# H29 — ONE image: Django API + the built SPA, one origin.
#
# Plan per the owner (Railway Free: 1 vCPU / 0.5 GB / 3 services): SQLite on a
# mounted volume, NO Postgres service. The deploy contract the image assumes:
#   - a volume mounted at /data (railway.json / DEPLOY_RAILWAY.md),
#   - DJANGO_USE_SQLITE=1 and DJANGO_SQLITE_PATH=/data/db.sqlite3,
#   - DJANGO_MEDIA_ROOT=/data/attachments so uploads also survive redeploys.
# gunicorn serves everything on $PORT (Railway injects it; workers capped at 2
# by backend/docker/entrypoint.sh).
#
# Secrets are never baked in: .env / auth.json / venvs never reach the build
# context (.dockerignore) and no env file is copied or sourced. Settings only
# ever read the environment of the running container.
# ============================================================================

# --- Stage 1: build the SPA -------------------------------------------------
FROM node:22-alpine AS spa-build
WORKDIR /app/frontend

# Manifest first so source edits do not invalidate the npm cache layer.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./

# The real build. This was `build:demo`, which sets DEMO_MODE: RequireSession
# then skips the session gate entirely (main.tsx), so the deployment served the
# app shell to anonymous visitors, never redirected to /login, and - with the
# mock layer gone - every screen read "تعذر الاتصال بالخادم". A deployed service
# signs users in.
RUN npm run build

# --- Stage 2: the serving image ---------------------------------------------
FROM python:3.11-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    # Safe-by-default posture for THIS image (dev runs use the host venv, not
    # the image): non-DEBUG forces Secure cookies/HSTS and makes the entrypoint
    # require DJANGO_SECRET_KEY + DJANGO_SQLITE_PATH — miss either and the
    # container exits with the fix in the message, never half-configured.
    DJANGO_DEBUG=0 \
    # H29 one-service plan: SQLite on the mounted volume (no Postgres service).
    DJANGO_USE_SQLITE=1 \
    DJANGO_SQLITE_PATH=/data/db.sqlite3 \
    DJANGO_MEDIA_ROOT=/data/attachments

# gosu: drop from root to the app user AFTER fixing volume ownership (below).
# Only needed inside the image; nothing else uses apt here.
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN python -m pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
# spa.py resolves <backend>/../frontend/dist, so the image mirrors the repo
# layout: /app/backend + /app/frontend. The product guide is the one file outside
# those two trees that is served (spa_guide reads /app/docs/user-guide.html), and
# without this copy the route 404s in the image while working in the checkout.
COPY docs/user-guide.html docs/user-guide.html
COPY --from=spa-build /app/frontend/dist frontend/dist

# No collectstatic: Django serves no /static/ route (config/urls.py has none)
# — the SPA ships as frontend/dist files served by config/spa.py, and Django
# admin is deliberately not installed (constitution §3).

# The mount point ONLY; the volume itself is attached by Railway. Running as
# root lets the entrypoint chown the volume once at boot, then drop to
# appuser for gunicorn (backend/docker/entrypoint.sh).
RUN mkdir -p /data \
    && useradd -m -u 1000 appuser \
    && chown -R appuser:appuser /app /data

EXPOSE 8000
ENTRYPOINT ["/app/backend/docker/entrypoint.sh"]
