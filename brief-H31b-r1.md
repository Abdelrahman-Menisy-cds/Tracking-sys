# H31b — finish R0 verification + implement R1 (H30 plan)

**Context:** the previous run of this task (`brief-H31-r0-r1.md`) was killed
mid-way (the owner shut the laptop down). **R0 appears complete** but is
**UNVERIFIED** — the run died while its "before" pytest was still executing, so
no test output was ever captured.

## State found on disk (verified just now — trust this, but re-check)

- `backend/tenants/` exists and is wired: `INSTALLED_APPS` has `"tenants"`
  (`config/settings.py:38`) and `MIDDLEWARE` has
  `"tenants.middleware.TenantMiddleware"` (`config/settings.py:65`).
- Files present: `apps.py`, `context.py`, `managers.py`, `middleware.py`,
  `test_scoping_static.py` (2 test functions, an AST-based leak ratchet).
- **`Company` model does NOT exist yet** — `accounts/models.py` still has only
  `CompanyProfile` (line 231). No new migration files in `accounts/migrations/`
  (newest is `0009_pendingdeviceflow.py`). So **R1 has not been started.**
- The working tree is committed clean (last commit `545dc2e`).

## Your task, in this order

### Step 1 — VERIFY R0 (evidence first, before touching anything)

1. Read the R0 files against §3.2 of the plan and fix any deviation from it.
2. Run the **existing** suite and report the real count:
   `cd backend && python -m pytest -q`
   (note: `.venv` is built for python3.11; if the plain `python` fails, use
   `PYTHONPATH="$PWD/.venv/lib/python3.11/site-packages" /usr/bin/python3.11 -m pytest -q`
   with `DJANGO_USE_SQLITE=1`).
3. Run the static guard alone and report its name + result.
4. Report the exact command and the exact output tail for both.

### Step 2 — implement R1 (from §9.1)

- the `Company` model + `CompanyProfile` becoming one-per-company + per-company
  `TimezoneConfig` (§2.1 / §2.4),
- the `__default__` data migration,
- the null→hard FK switch for the **`accounts` tables only** (§2.6 steps 1–4).

Then run the migration against the **LOCAL SQLite dev DB** (`DJANGO_USE_SQLITE=1`,
from `backend/`) and report row counts before/after (no data loss) plus the raw
`migrate` output.

**Do not start R2.**

## Evidence required in your final report

1. The existing-suite count, with the command and the output tail.
2. The static guard: test name + pass/fail.
3. `test_company.py` (per §8.1): name + pass/fail.
4. The `migrate` output for the new migrations + before/after row counts.
5. Anything in the plan that turned out wrong or impossible — state it with the
   evidence instead of deviating silently.

## Rules

- **Do not commit, stage, or stash anything.** The owner commits; you leave the
  tree dirty for review.
- **Do not touch port 8080.** If you need a server, use another port.
- The local dev DB is **empty** (0 users) on purpose — that is not a bug.
- Report only what you actually ran. Never claim a test passed without its output.
