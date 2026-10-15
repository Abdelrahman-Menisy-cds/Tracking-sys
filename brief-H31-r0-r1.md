# H31 — implement R0 + R1 of the H30 multi-tenant plan

The plan at `.hermes/plans/h30-multi-tenant-isolation.md` is the **approved
spec** (the owner reviewed and said «توكل على الله»). **Read it fully first** —
it is authoritative, including §1.2 (the contradictions it found in the original
brief) and §2.6 (the exact migration order). Do not re-derive what it states.

## Scope of THIS task: R0 and R1 ONLY (from §9.1)

**R0 — Foundation, no behavior change:**
- the `tenants/` app skeleton (`context.py`, `managers.py` per §3.2),
  `INSTALLED_APPS` + `MIDDLEWARE` wiring,
- `TenantManager` and `TenantMiddleware` (pass-through while `company` is
  nullable — the middleware's NULL-company denial only arms once the FK is hard),
- the **static guard test written FIRST**, passing against the current
  allow-list (§8.2),
- a snapshot of the DB volume per §2.7.

**R1 — Company + profiles:**
- the `Company` model + `CompanyProfile` becoming one-per-company +
  per-company `TimezoneConfig` (§2.1 / §2.4),
- the `__default__` data migration,
- the null→hard FK switch for the **`accounts` tables only** (§2.6 steps 1–4).

**Do not start R2.** Stop at R1's gate.

## Evidence required in your final report

1. `pytest` on the existing suite — state the **before** count and the **after**
   count, and they must match (no regressions).
2. The new static guard test: passing, with its name.
3. `test_company.py` (per §8.1): passing, with its name.
4. The migration applied to the **LOCAL SQLite dev DB** (`DJANGO_USE_SQLITE=1`,
   run from `backend/`), with row counts before/after showing **no data loss**.
5. The exact `python manage.py migrate` output for the new migrations.

## Rules

- **Do not commit, stage, or stash anything.**
- **Do not touch the dev server on port 8080** — the owner is using it. If you
  need a server, use a different port.
- **Do not implement R2+**, and do not "helpfully" add tenancy FKs to the other
  apps in this task.
- The local dev DB is currently **empty** (0 users) by the owner's request —
  that is expected, not a bug.
- If the plan is wrong, impossible, or contradicts the code somewhere, **say so
  in your report with the evidence** — do not silently deviate.
- Report honestly: real test output, real counts. Never claim a test passed
  without its output.
