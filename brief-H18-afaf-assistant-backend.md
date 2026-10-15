# H18 — "مدام عفاف" assistant: backend (per-user provider config + agent chat)

## What the owner asked for

A floating chat assistant inside the app, named **مدام عفاف — شؤون العاملين**.
The user can talk to it and it can **carry out actions in the system**. Each
employee links **their own** provider: a base URL, an API key, and a model (no
built-in provider presets — the owner explicitly rejected shipping any), or **HR
links it for them from the employee's file**. HR-linked keys are **never readable
by the employee** — but the employee **may replace** them. A **Test button**
proves the connection works.

Decisions already made by the owner:
- **No provider presets.** A free-form OpenAI-compatible base URL + key + model.
- **Execution authority**: the assistant **reads freely**; **every action that
  changes data must be confirmed** by the user before it runs.
- The employee's settings live in a widget on **/profile**; HR's controls live in
  **/admin/people/:employeeId**.

This brief is the backend half. A separate brief covers the floating button, the
chat panel, and both settings surfaces.

## Repository and runtime (verified, do not re-derive)

- Repo `/home/menisy/Desktop/Me/tracking_system_project`; Django backend in
  `backend/` (app `accounts`, plus `requests`, `timesheets`, `tasks`,
  `notifications`, `attendance`-style apps — read the tree first).
- The running server serves the API **and** the built SPA on
  `http://192.168.1.19:8080`:
  `DJANGO_USE_SQLITE=1 PYTHONPATH="$PWD/.venv/lib/python3.11/site-packages" /usr/bin/python3.11 manage.py runserver 0.0.0.0:8080 --noreload`
- SQLite (`backend/db.sqlite3`). Tests: `backend/pytest.ini`. Responses use the
  project's `{"data": ...}` envelope and its existing error shape — read
  `accounts/views.py`, `permissions.py`, `company_views.py` (the newest
  precedent) and match them.
- After a model change: `makemigrations` + `migrate`, then **restart the server**
  (`--noreload`) and report the new pid + the exact command.
- **Do not commit, stage, or stash anything** — the tree holds another task's
  uncommitted work.

## Model — `accounts/models.py`

`AssistantConfig`, **one per user** (`OneToOneField(User)`), plus:

| field | type | meaning |
|---|---|---|
| `base_url` | URLField(blank) | OpenAI-compatible endpoint, e.g. `https://api.example.com/v1` |
| `api_key_ciphertext` | BinaryField / TextField(blank) | the key, **encrypted at rest** |
| `api_key_hint` | CharField(blank) | display hint only, e.g. `••••3f2a` |
| `api_key_set_by` | FK(User, null) | who supplied the key (self or HR) |
| `model` | CharField(blank) | the model id to call |
| `is_active` | BooleanField(default False) | HR can switch the assistant off for a user |
| `enabled_by_hr` | BooleanField(default False) | whether HR activated it |
| `updated_at` | auto_now | |

- Encryption: use `cryptography.fernet` with the key read from settings/env (add
  `ASSISTANT_SECRET_KEY`; derive a stable fallback from `SECRET_KEY` so a demo
  run works, and document it). **Never** store the plaintext, **never** log it.
- `is_configured` = `base_url` and `model` present and a key stored.

## API

1. `GET /api/v1/assistant/config` — the **caller's own** config. Returns
   `{"data": {"is_configured": bool, "is_active": bool, "base_url": str,
   "model": str, "key_hint": str, "key_source": "self"|"hr"|null,
   "can_replace_key": true}}`. **The key itself is never returned, ever.**
2. `PUT /api/v1/assistant/config` — set `base_url`, `model`, and optionally
   `api_key`. An employee **may replace** an HR-set key (the owner's rule); the
   new key is marked `key_source: "self"`.
3. `POST /api/v1/assistant/test` — the Test button. Makes a **real, minimal**
   call to the configured endpoint (a 1-token chat completion) and returns
   `{"data": {"ok": bool, "latency_ms": int, "detail": str}}`. A failure must
   return the provider's own status/message, not a generic one. Timeout ~15s.
4. `GET|PUT /api/v1/employees/<int:target_id>/assistant` — HR-only. Read the
   employee's config (still no key), set `base_url`/`model`/`api_key`, and toggle
   `is_active`/`enabled_by_hr`. Audit every change (follow the `AuditEvent`
   precedent in `employee_views.py`).
5. `POST /api/v1/assistant/chat` — the conversation. Body:
   `{"messages": [{"role": "user"|"assistant", "content": str}, ...]}`. The
   server: loads the caller's config (never a client-supplied key), sends the
   conversation plus the **tool definitions** to the provider, and returns
   `{"data": {"reply": str, "pending_action": {...} | null, "tool_trace": [...]}}`.
6. `POST /api/v1/assistant/actions/<token>/confirm` — run a pending write action.
   The token is signed, short-lived (~10 min), bound to the user, and carries the
   exact tool + arguments; it must be rejected if the user, tool, or arguments do
   not match.

## Tools (the "execute anything in the system" part)

Every tool executes **as the calling user**, through the project's existing
services/permission helpers — never a privileged shortcut. A user who cannot do
something in the UI must not be able to do it through the assistant.

- Read (run immediately): my requests, my timesheets, my leave balance, my
  tasks, my attendance, and — for managers — the review queue; for HR — the
  employee directory and departments.
- Write (**must return a pending action, never execute inline**): create a
  request, submit a timesheet, decide a request, decide a timesheet, create a
  task, clock in/out.
- Every confirmed write is audited with the actor, the tool, and the arguments.
- Bound the tool loop (max ~5 provider round-trips) so a confused model cannot
  spin.

## Tests (pytest, project runner)

1. A config with no key is `is_configured: false`; the chat endpoint refuses with
   a clear error.
2. `PUT` stores the key encrypted: the raw value is **not** in the DB column and
   **not** in any response.
3. An HR-set key is readable as `key_hint` + `key_source: "hr"`, is not returned
   in plaintext, and the employee's `PUT` **replaces** it (`key_source: "self"`).
4. A non-HR user gets 403 on the employee config endpoints; a manager does too.
5. `POST /assistant/test` against a stub endpoint returns ok + latency, and
   against a failing endpoint returns the provider's status/message.
6. A read tool runs without confirmation; a write tool returns a pending action
   and **does not** change data until `confirm` is called.
7. A confirm token is rejected when reused, when expired, when the user differs,
   or when the arguments were tampered with.
8. A user without the permission for an action cannot confirm it (e.g. an
   employee confirming `decide_request`).
9. Every confirmed write produces an AuditEvent.
10. The chat endpoint never accepts a client-supplied key or base URL.

## Evidence to report

- `pytest` output for the new file and the full suite, with the exact command.
  Note (do not "fix" unless asked): `config/test_schema.py` and the
  `cookie["secure"]` login test already fail on this checkout for pre-existing
  reasons (H16 schema map gap; the demo runs over plain HTTP).
- The migration name + `migrate` output + the new server pid + the restart
  command + `curl -o /dev/null -w '%{http_code}' http://192.168.1.19:8080/`.
- A live `curl` (or short python) walkthrough against the running server: sign up
  a fresh HR with code `Menisy2002`, `PUT` a config pointing at a **local stub**
  OpenAI-compatible endpoint you start yourself, `POST /assistant/test`, then
  `POST /assistant/chat` and show the reply. Paste the real responses — including
  the proof that the key never appears in any response body.
- No placeholders, no "should work", no invented output.
