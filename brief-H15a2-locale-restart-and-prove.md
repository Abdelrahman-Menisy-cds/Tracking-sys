# H15a-2 — the locale fix is written but NOT LIVE; restart the server and prove it

Continuing H15a. You reported adding `LocaleMiddleware` and said the HTTP proof block was
"therefore not run against the served app; only in-process test-client probes were." The lead then
measured the served app directly, and **the fix has no effect yet**:

```
$ curl -s -H "Accept-Language: ar" -X POST http://192.168.1.19:8080/api/v1/auth/signup \
       -H "Content-Type: application/json" -H "X-CSRFToken: <real token>" -H "Origin: http://192.168.1.19:8080" \
       -d '{"email":"h15.ar.…@example.local","code":"Menisy2002","password":"123"}'
{"error":{"code":"validation_error","message":"Validation failed.",
 "fields":{"password":["This password is too short. It must contain at least 8 characters.",
                       "This password is too common.","This password is entirely numeric."]}}}
```

Identical output with and without `Accept-Language: ar` — and the same for the email field
("Enter a valid email address."). The cause is not your edit: the running process is

```
pid 259706, started 15:51:07 — /home/menisy/Desktop/Me/tracking_system_project/backend/.venv/bin/python
                                   manage.py runserver 0.0.0.0:8080 --noreload
settings.py mtime: 17:25:36
```

`--noreload` means it can never pick the change up. Your middleware placement (settings.py line 49,
after SessionMiddleware, before CommonMiddleware) is correct — it simply was never loaded.

## Do this

1. **Restart the server** with the SAME cmdline and environment it has now
   (`DJANGO_USE_SQLITE=1`, its own venv, `manage.py runserver 0.0.0.0:8080 --noreload`), then report
   the **new pid** and the exact command. Keep the app reachable at `http://192.168.1.19:8080` — the
   owner uses it.
2. **Then run the HTTP proof against the served app** (CSRF bootstrap → POST, exactly the command
   above with a fresh email each run) and paste the raw output in the report:
   - `Accept-Language: ar` + password `123` → the password messages are ARABIC;
   - no header / `Accept-Language: en` → they stay English;
   - `Accept-Language: ar` + email `bad` → the email message is ARABIC;
   - `Accept-Language: ar` + `code: "Menisy2002"` + a fresh email + a strong password → **200**, and
     `GET /api/v1/auth/me` reads that email back;
   - `Accept-Language: ar` + `code: "wrong"` → 400 «الكود غير صحيح.» unchanged.
3. **Close the Django 5.2 catalog gap you found.** You observed that Django 5.2's
   `MinimumLengthValidator` emits an msgid whose `%d` placeholder no longer matches its shipped
   Arabic catalog (`%(min_length)d`), upstream #36378 wontfix. The owner's own case IS that message,
   so "Arabic" is only true if it renders in Arabic. Preferred remedy: a project-owned validator (or
   a project catalog override) that emits the project's own Arabic sentence for the minimum-length
   rule, with the English string preserved for `en`. Whatever you choose, paste the live proof for
   the `123` case showing Arabic text, and say which mechanism you used.
4. Re-run the signup test module you wrote AND the full backend suite (`--keepdb` is fine) and paste
   the pass/fail counts. You ended last time with the full suite unrun.
5. If you touch `LocaleMiddleware` behaviour at all, keep the `django_language`-cookie caveat you
   found in mind: nothing in this project sets it, but a stale cookie would silently override
   `Accept-Language`, so say in the report whether a cookie was present in your live probe.

## Constraints
- Do not commit. The lead commits after review.
- Do not change `LANGUAGE_CODE` (stays `"en"`) or any response format — the frontend parses dates
  from existing endpoints and a global Arabic default would regress it.
- Report files changed with line counts, the exact commands, the RAW live output, and anything you
  could not verify — plainly, without implying coverage you did not have.
