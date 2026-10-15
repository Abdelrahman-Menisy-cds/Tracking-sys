# H18 fix-up — two known defects (assistant loop + probe signup)

The H18 feature is implemented and the migration is applied. The server was
restarted and the assistant endpoints are now live on `http://192.168.1.19:8080`
(`GET /api/v1/assistant/config` → 401, not 404). Two defects remain.

## Defect 1 — backend: the read-tool result is not appended before the next round

`backend/accounts/test_assistant.py::test_read_tool_runs_without_confirmation`
fails:

```
File ".../accounts/test_assistant.py", line 316, in fake_chat_round
    assert tool_messages, "the read result must be appended before the next round"
AssertionError: the read result must be appended before the next round
assert []
```

Run: `cd backend && DJANGO_USE_SQLITE=1 PYTHONPATH="$PWD/.venv/lib/python3.11/site-packages" /usr/bin/python3.11 -m pytest -q accounts/test_assistant.py`

In `backend/accounts/assistant_chat.py` the loop (around lines 91-190) appends a
tool result to `provider_messages` on each branch. A read tool that runs
immediately must append its result in the **OpenAI tool-message shape**
(`{"role": "tool", "tool_call_id": <the call's id>, "content": <result>}`) before
the next provider round — the test's stub inspects exactly that. Find why the
immediate branch's append is missing or malformed (wrong role, missing
`tool_call_id`, or appended to the wrong list) and fix the **class** of bug, not
just this call site: every branch that answers a tool call (immediate read,
refused, pending-confirmation) must append a correctly shaped tool message.

## Defect 2 — frontend: the probe's signup step returns undefined

`node frontend/scripts/probe-h18-afaf-assistant.mjs http://192.168.1.19:8080 <shotsDir>`
prints `signup (fresh HR): HTTP undefined` and then crashes at line 277
(`Cannot read properties of undefined (reading 'exists')`) because the state read
never ran.

The signup block (around lines 209-235) navigates to `/login`, waits for
`input[type="email"]`, then evaluates an async IIFE that fetches
`/api/v1/auth/csrf` and posts to `/api/v1/auth/signup` with the subscription code
`Menisy2002`. A working precedent exists in this repo:
`frontend/scripts/probe-h17-company-onboarding.mjs` — the same flow succeeds
there, so compare the two and fix the difference (the CSRF cookie name it reads,
the `awaitPromise`/return shape of the evaluate helper, or the readiness wait).

Note the app currently has **no company profile saved**, so a fresh session lands
on `/onboarding/company` and `/login` may redirect. Make the signup step robust
to that (it must not depend on the login form being reachable after the redirect;
fetching from the app's own origin is enough).

## Then prove both halves

1. Backend: `pytest -q accounts/test_assistant.py` — all green — and paste the
   full-suite summary (known pre-existing failures, do not "fix" them:
   `config/test_schema.py::...resolves_to_a_real_view` and the
   `cookie["secure"]` login test — the demo runs over plain HTTP).
2. Frontend: rerun the probe end-to-end (it starts its own stub provider) and
   paste the per-check lines plus the final pass/fail line, then save the
   screenshots under `/home/menisy/.hermes/cache/scratch/h18-shots/` (faded
   launcher with its hint, the open chat panel with a confirmation card, the
   profile widget). If a check genuinely cannot run, say exactly which one and
   why — never fake a screenshot or a result.
3. Do not commit, stage, or stash anything.
