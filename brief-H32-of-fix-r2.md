# H32 — fix the TenantManager.of() contract, then implement R2

The plan `.hermes/plans/h30-multi-tenant-isolation.md` is the spec. R0+R1 are
done and verified (see `HANDOFF`-style notes below). Read §2.6 steps 5–8 and
§9.1 (R2) before you start.

## Verified state you inherit (do not redo)

- R0: `backend/tenants/` (context/managers/middleware + the AST leak guard
  `tenants/test_scoping_static.py`), wired in `config/settings.py`.
- R1: `Company` model + `company` FKs on the accounts tables (migrations
  `accounts/0010_company` → `0013_tenant_fk_hard`) + `timesheets/0008`/`0009`
  for `TimezoneConfig`. The `__default__` backfill is proven to work on a DB
  that HAS rows (rehearsed independently: an existing CompanyProfile gave the
  default company its name, and pre-existing users/departments attached).
- The hard FK is real: creating a user without a company raises
  `NOT NULL constraint failed: accounts_user.company_id`.
- Baseline suite: 487 collected / 486 passed / 1 failed
  (`accounts/tests.py::test_login_active_user_sets_authenticated_rotated_secure_session`
  — pre-existing and **environmental**: the repo-root `.env` sets
  `DJANGO_ALLOW_INSECURE_COOKIES=1`; that file is excluded from the Docker image
  and the live service sends `Secure` + HSTS, so it is NOT a production issue).
  After R1: 490 collected / 489 passed / 1 failed (same one).

## Step 0 — unblock the suite: the stub_server fixture HANGS the full run

**This is verified by the lead, with a minimal repro — fix it first, it is
worth more than R2.**

The full suite (`cd backend && pytest -o addopts=""`) never finishes: it stops
at `accounts/test_assistant_subscription.py::test_no_response_body_contains_the_token`
and hangs forever (no `pytest-timeout` is installed, so nothing kills it).

Minimal repro (2 tests, ~100s, never completes):
```
pytest accounts/test_assistant_subscription.py -v -o addopts="" \
  -k "test_subscription_test_and_chat_use_the_session_header_and_bearer or test_no_response_body_contains_the_token"
```
The first test PASSES, the second starts and never returns. Run alone, the
second test passes in ~3s — so it is an interaction, not that test's logic.

Cause: the `stub_server` fixture (accounts/test_assistant_subscription.py:311)
uses `HTTPServer`, which is **single-threaded**. The preceding test leaves a
keep-alive connection open, so the one handler thread stays blocked on the old
socket and the next test's request is never served → hang.

Fix the fixture (e.g. `ThreadingHTTPServer`, or answer with `Connection: close`
/ `self.close_connection = True`), then prove it: the whole file must pass, and
the full `cd backend && pytest -o addopts=""` run must reach its summary line
with a real count.

**Why this matters:** every count reported so far was measured from the repo
root, where pytest's `testpaths` don't resolve and only **490 of the 631** tests
are collected — so the hanging file was never in scope. The "489 passed" figure
covers ~78% of the suite. Report the count from `backend/` (631 collected) once
the hang is fixed.

## Step 1 — fix `TenantManager.of()` (gate: do this FIRST, with a test)

`backend/tenants/managers.py` documents `of(user_or_company)` as accepting
"either a company instance or an authenticated user". **The company-instance
path is broken**: a `Company` has no `.company` attribute, so the `except
AttributeError` branch calls `current_company(company)`, which checks
`is_authenticated` (absent on a Company) and returns `None` → `.of(company)`
silently returns an **empty queryset** instead of that company's rows.
Fail-closed, so not a leak — but a silent wrong answer, which is worse to debug.

Fix it so the documented contract actually holds (branch on the type, or
delegate to the existing `company_all()`), keep the fail-closed behaviour for a
genuinely company-less caller, and add a regression test that fails on the
current code (`.of(company)` must return that company's rows; `.of(anonymous)`
must return none). Also fix the docstring typo `User.gif.company`.

## Step 2 — implement R2 (§9.1)

- the tenant `company` FKs on the rest of the tables — `reqs`, `timesheets`,
  `holidays`, `notifications` (§2.6 steps 5–8), nullable → backfill into
  `__default__` → hard, exactly like R1 did for accounts;
- the constraint flips: per-company uniqueness where a global unique constraint
  existed (state each one you flip and why);
- the R2 tests per §8.1/§8.3.

**Stop at R2's gate. Do not start R3.**

## Evidence required in your final report

1. The suite count before and after (state the exact command; note that
   `pytest.ini` has `addopts = -q`, so pass `-o addopts=""` to see the count
   line instead of `-qq`).
2. The Step-1 regression test: name + the fact that it fails on the old code
   and passes on the new.
3. The `migrate` output for the new migrations + before/after row counts on the
   LOCAL SQLite dev DB.
4. **Rehearse the R2 backfill on a DB that has rows** — an empty DB proves
   nothing (that is exactly how R1's backfill looked "verified" while untested).
   Build a scratch DB at the pre-R2 migration state, insert real rows in each
   affected table, migrate forward, and report what attached to `__default__`.
5. Anything the plan got wrong — with evidence, not a silent deviation.

## Rules

- **Do not commit, stage, or stash.** The owner commits.
- **Do not touch port 8080.**
- The dev DB is currently **empty** by the owner's request — that is expected.
- Report only what you ran. Never claim a test passed without its output.
