# H15a — Signup validation errors must reach the client in the client's language

## Why (measured, not theorised)

The owner saw an all-Arabic signup screen report **"Validation failed."** — a generic ENGLISH
sentence that names no field. Reproduced against the served app (`http://192.168.1.19:8080`,
DB `backend/db.sqlite3`, `DJANGO_USE_SQLITE=1`) with a CSRF bootstrap + POST:

```
POST /api/v1/auth/signup  {"email":"repro…@example.local","code":"Menisy2002","password":"123"}
400/422 → {"error":{"code":"validation_error","message":"Validation failed.",
                    "fields":{"password":["This password is too short. It must contain at least 8 characters.",
                                          "This password is too common.",
                                          "This password is entirely numeric."]}}}
```

The specific reasons ARE in `fields`, in **English**, and they stayed English even when the request
carried `Accept-Language: ar`. Root cause: `backend/config/settings.py` has
`LANGUAGE_CODE = "en"`, `USE_I18N = True`, and **no `LocaleMiddleware`** in `MIDDLEWARE` — so Django
never activates a request locale and Django's own translated validator messages can never be used.
(Project-written messages are already Arabic — «الكود غير صحيح.» — which is why the wrong-code
path looked fine and the validation path did not.)

Also confirmed in the same probe: the seeded subscription code **`Menisy2002` IS valid** (the weak
password rejected first, the code never complained). Do not touch that behaviour.

## What to change (backend only)

1. Activate the request locale: add `django.middleware.locale.LocaleMiddleware` to `MIDDLEWARE`,
   positioned after `SessionMiddleware` and before `CommonMiddleware` (Django's documented order).
2. **Do NOT change `LANGUAGE_CODE`** and do not enable `USE_L10N`-era format switching: a global
   Arabic default would silently change date/number formats for every existing API response and
   break the frontend's parsing. The locale must come from the request (`Accept-Language`), per
   request, and default to today's behaviour when the header is absent or unsupported.
3. Leave the error envelope shape exactly as it is (`error.code`, `error.message`, `error.fields`,
   `error.request_id`). The frontend is being changed in H15b to read `fields`.

## Prove it (real HTTP against the served app, not a unit test alone)

Write/extend a backend test AND run the live probe; paste the real output in the report.

- `Accept-Language: ar` + a weak password → every string in `fields.password` is **Arabic**.
- `Accept-Language: en` (or no header) → the messages stay **English** (unchanged behaviour).
- `Accept-Language: ar` + a malformed email → `fields.email[0]` is **Arabic**.
- `code: "Menisy2002"` + a fresh email + a strong password → **200** with the signed-in user, and
  `GET /api/v1/auth/me` reads that email back (assert it; do not infer it from the response body).
- `code: "wrong"` → `400 invalid_code` with «الكود غير صحيح.» (unchanged).
- Add a test that the middleware is present and that a request without `Accept-Language` still gets
  English, so the default cannot drift.

## Constraints

- Migrations: none expected; if you add one, apply it to the live SQLite DB the app serves.
- Restart the running server with the SAME cmdline/env it has now, and say in the report the exact
  command you used and the pid.
- Do not commit. The lead commits after review.
- Report: files changed with line counts, the exact commands + real output, and anything you could
  not verify (say so plainly rather than implying coverage you did not have).
