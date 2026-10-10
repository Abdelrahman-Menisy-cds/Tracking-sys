#!/usr/bin/env bash
#
# Provision the Postgres role + database this project's .env expects, generate a
# password for it, write that password into .env, then bring the schema and the
# demo accounts up. Idempotent — safe to re-run; it rotates the password and
# otherwise leaves an existing database alone.
#
# Why this is a script and not something the app does at boot: creating a role is
# a cluster-level act that needs a Postgres superuser. On this machine that means
# the postgres OS user, hence sudo.
#
# Usage (from anywhere):
#     sudo bash deploy/provision-postgres.sh
#
# On a deployment host, run the same command. The script reads POSTGRES_DB /
# POSTGRES_USER / POSTGRES_HOST / POSTGRES_PORT from .env, so it provisions what
# the deployment is actually configured to use rather than what this file guesses.
#
# The generated password is never echoed. It goes into .env, which is gitignored,
# and into the cluster. If you need it later, read it from .env.
#
# After this succeeds, restart the web process WITHOUT DJANGO_USE_SQLITE=1 and it
# will use Postgres; the nightly crontab entry should then drop that prefix too.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
BACKEND="$ROOT/backend"
PY="$BACKEND/.venv/bin/python"

[ -f "$ENV_FILE" ] || { echo "✗ no .env at $ENV_FILE" >&2; exit 1; }
[ -x "$PY" ] || { echo "✗ no venv python at $PY" >&2; exit 1; }

# --- read the four settings we need out of .env, without sourcing it -----------
envval() {
  python3 - "$ENV_FILE" "$1" <<'PY'
import sys, pathlib
path, key = pathlib.Path(sys.argv[1]), sys.argv[2]
for line in path.read_text(encoding="utf-8").splitlines():
    if line.startswith(key + "="):
        print(line.split("=", 1)[1].strip().strip('"').strip("'"))
        break
PY
}

DB="$(envval POSTGRES_DB)";     DB="${DB:-heya_fawda_dev}"
DBUSER="$(envval POSTGRES_USER)"; DBUSER="${DBUSER:-heya_fawda}"
DBHOST="$(envval POSTGRES_HOST)"; DBHOST="${DBHOST:-127.0.0.1}"
DBPORT="$(envval POSTGRES_PORT)"; DBPORT="${DBPORT:-5432}"

echo "→ provisioning Postgres role '$DBUSER' and database '$DB' on $DBHOST:$DBPORT"

if [ "$(id -u)" -ne 0 ]; then
  echo "✗ run me with sudo (creating a role needs a Postgres superuser)" >&2
  exit 1
fi

# Restricted alphabet so the value is safe in a single-quoted SQL literal, a .env
# line, and a DSN alike — no quoting subtleties to get wrong later.
PW="$(python3 -c 'import secrets, string; a = string.ascii_letters + string.digits + "-_"; print("".join(secrets.choice(a) for _ in range(32)))')"

# --- the role (create or rotate) ----------------------------------------------
# Decided in shell, and fed to psql on stdin rather than through -c: psql does not
# interpolate its :vars inside `-c` at all (verified against a throwaway cluster —
# it errors with `syntax error at or near ":"`), and a dollar-quoted DO block does
# not either. A heredoc keeps the password out of argv while letting the shell put
# the value straight into the literal; the generated alphabet has no quote, space
# or backslash for that literal to mishandle.
if [ "$(sudo -u postgres psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$DBUSER'")" = "1" ]; then
  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q <<SQL
ALTER ROLE "$DBUSER" LOGIN PASSWORD '$PW';
SQL
  echo "  role already existed — password rotated"
else
  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q <<SQL
CREATE ROLE "$DBUSER" LOGIN PASSWORD '$PW';
SQL
  echo "  role created"
fi

# --- the database, owned by that role -----------------------------------------
# -d postgres everywhere: without it psql picks a database named after the role,
# which happens to be right here but is not guaranteed on someone else's cluster.
if [ "$(sudo -u postgres psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB'")" = "1" ]; then
  echo "  database already exists — leaving its contents alone"
else
  sudo -u postgres createdb -O "$DBUSER" "$DB"
  echo "  database created"
fi

# --- write the password into .env, surgically ---------------------------------
python3 - "$ENV_FILE" "$PW" <<'PY'
import sys, pathlib
path, pw = pathlib.Path(sys.argv[1]), sys.argv[2]
lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
found = False
out = []
for line in lines:
    if line.startswith("POSTGRES_PASSWORD="):
        out.append(f"POSTGRES_PASSWORD={pw}\n"); found = True
    else:
        out.append(line)
if not found:
    out.append(f"POSTGRES_PASSWORD={pw}\n")
path.write_text("".join(out), encoding="utf-8")
PY
chmod 600 "$ENV_FILE"
echo "  password written to .env (chmod 600)"

# --- prove the new credential actually works ----------------------------------
export PGPASSWORD="$(envval POSTGRES_PASSWORD)"
if psql -h "$DBHOST" -p "$DBPORT" -U "$DBUSER" -d "$DB" -tAc "select current_user" >/dev/null 2>&1; then
  echo "  ✓ the role can connect to $DB"
else
  echo "✗ the role was created but cannot connect — check pg_hba.conf for this host/port" >&2
  exit 1
fi

# --- schema + demo data, through the app's own settings -----------------------
echo "→ migrating"
(cd "$BACKEND" && "$PY" manage.py migrate --noinput)

echo "→ seeding demo accounts"
(cd "$BACKEND" && "$PY" manage.py seed_demo_accounts) || echo "  (seed reported a problem; check its output above)"

echo
echo "✓ done. Postgres is provisioned and .env is configured."
echo "  Restart the web process WITHOUT DJANGO_USE_SQLITE=1 to serve from Postgres,"
echo "  and drop that prefix from the crontab entry too."
