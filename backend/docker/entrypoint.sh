#!/usr/bin/env sh
# H29 container entrypoint, SQLite-on-volume edition (owner plan change:
# Railway Free plan = 1 vCPU / 0.5 GB / 3 services, so the Postgres plugin
# is OUT and the database is a SQLite file on a mounted volume).
#
# Order of operations, each one allowed to fail loudly:
#   1. refuse to start without a real SECRET_KEY in a non-DEBUG run;
#   2. prove the DB destination exists AND is writable — with no volume
#      mounted, /data does not exist and dying here beats writing an
#      ephemeral db the next deploy wipes;
#   3. migrate (mforward-only, no-input);
#   4. exec gunicorn on $PORT (Railway injects it; 8000 locally).
# There is no network database to wait for: the "wait for DB" step of the
# Postgres plan becomes a writability probe below.
set -eu

# Image layout is /app/{backend,frontend}. Overridable so the same script can
# be exercised on a host tree without a container (release proof runs do it).
APP_DIR="${APP_DIR:-/app}"

# --- 0. One-time privilege drop ---------------------------------------------
# The container starts as root solely so it can give the mounted volume to the
# app user (Railway mounts volumes root-owned; non-root would fail to write).
# Everything below runs as appuser: if the container was already started with
# --user (non-root), this branch is skipped and the volume must already be
# owned correctly.
if [ "$(id -u)" = "0" ]; then
    mkdir -p /data 2>/dev/null || true
    chown appuser:appuser /data 2>/dev/null || true
    export HOME=/home/appuser
    exec gosu appuser "$0" "$@"
fi

cd "$APP_DIR/backend"

# --- 1. Secrets: refuse to boot with Django's insecure dev default ----------
# settings.py falls back to "dev-only-insecure-key-change-me" when
# DJANGO_SECRET_KEY is unset; that default must never reach the internet.
if [ "${DJANGO_DEBUG:-1}" != "1" ] && [ -z "${DJANGO_SECRET_KEY:-}" ]; then
    echo "FATAL: DJANGO_SECRET_KEY is not set (DJANGO_DEBUG=${DJANGO_DEBUG:-1})." >&2
    echo "       Refusing to serve on an insecure fallback key. Generate one with:" >&2
    echo "         python -c \"import secrets; print(secrets.token_urlsafe(64))\"" >&2
    exit 1
fi

# --- 2. DB destination: a real, writable file on the volume ------------------
if [ "${DJANGO_USE_SQLITE:-0}" != "1" ]; then
    echo "FATAL: DJANGO_USE_SQLITE is not set." >&2
    echo "       The one-service container runs SQLite on a mounted volume; set" >&2
    echo "       DJANGO_USE_SQLITE=1 and DJANGO_SQLITE_PATH=/data/db.sqlite3." >&2
    echo "       (Postgres is still the settings default for the dev server, but" >&2
    echo "       this container image is built and proven for SQLite only.)" >&2
    exit 1
fi

MAX_TRIES="${SQLITE_WAIT_TRIES:-30}"
i=0
while :; do
    if [ -n "${DJANGO_SQLITE_PATH:-}" ]; then
        DB_PARENT=$(dirname "$DJANGO_SQLITE_PATH")
        DB_PATH="$DJANGO_SQLITE_PATH"
    elif [ "${DJANGO_DEBUG:-1}" = "1" ]; then
        # Dev-style run inside the image: the bare settings default is fine
        # (nothing here is persistent data worth protecting).
        DB_PATH=""
        break
    else
        echo "FATAL: DJANGO_SQLITE_PATH is not set (DJANGO_DEBUG != 1)." >&2
        echo "       Without it the DB lands in the image layer, which Railway" >&2
        echo "       wipes on every deploy. Mount the volume at /data and set" >&2
        echo "       DJANGO_SQLITE_PATH=/data/db.sqlite3." >&2
        exit 1
    fi

    if [ -d "$DB_PARENT" ] && [ -w "$DB_PARENT" ] && [ \( -z "$DB_PATH" \) -o \( ! -e "$DB_PATH" \) -o -w "$DB_PATH" ]; then
        break
    fi

    i=$((i + 1))
    if [ "$i" -ge "$MAX_TRIES" ]; then
        echo "FATAL: SQLite database destination not writable after ${MAX_TRIES} checks:" >&2
        echo "       DJANGO_SQLITE_PATH=${DJANGO_SQLITE_PATH:-<unset>}" >&2
        echo "       If this is Railway: is the Volume attached and mounted at" >&2
        echo "       /data (service -> Volumes -> mount path /data)?" >&2
        exit 1
    fi
    echo "waiting for the DB volume to become writable... ($i/$MAX_TRIES)"
    sleep 2
done
if [ -n "$DB_PATH" ]; then
    echo "sqlite db reachable: $DB_PATH (writable)"
fi

# --- 3. Migrate --------------------------------------------------------------
# Every deploy restarts the container, so migrations MUST run from here (not
# a one-off terminal) or a freshly-added model crashes the first request.
python manage.py migrate --no-input

# Optional demo accounts (opt-in).
if [ "${SEED_DEMO_ACCOUNTS:-0}" = "1" ]; then
    python manage.py seed_demo_accounts
fi

# Optional subscription signup code (opt-in). A fresh database has NO codes, so
# self-service signup returns 403 for everyone until one exists. The value never
# lives in the source (seed_signup_code reads --code or $SIGNUP_CODE) — set
# SIGNUP_CODE in the service variables instead. Re-running refreshes in place.
if [ -n "${SIGNUP_CODE:-}" ]; then
    python manage.py seed_signup_code --code "$SIGNUP_CODE" --label "seeded from SIGNUP_CODE"
fi

# --- 4. Serve ----------------------------------------------------------------
# Railway Free tier: 1 vCPU / 0.5 GB. More than 2 gunicorn workers would both
# exceed the RAM budget and pile contending writers onto one SQLite file —
# hard-cap at 2 and say so. Files under MEDIA live on the volume as well (see
# DJANGO_MEDIA_ROOT in the deploy note) so attachments survive redeploys.
WORKERS="${WEB_CONCURRENCY:-2}"
case "$WORKERS" in (*[!0-9]*) WORKERS=2 ;; esac
if [ "$WORKERS" -lt 1 ]; then WORKERS=1; fi
if [ "$WORKERS" -gt 2 ]; then
    echo "note: capping WEB_CONCURRENCY=$WORKERS at 2 (SQLite + 0.5 GB RAM)" >&2
    WORKERS=2
fi

PORT="${PORT:-8000}"
echo "gunicorn: $WORKERS worker(s) on 0.0.0.0:$PORT"
exec gunicorn config.wsgi:application \
    --bind "0.0.0.0:$PORT" \
    --workers "$WORKERS" \
    --timeout 120 \
    --access-logfile - \
    --error-logfile -
