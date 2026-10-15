# H15b — Show the operator WHICH field failed, in their own language

## Why (the screenshot + the measured server behaviour)

The owner typed `menisy@gmail.com`, the code `Menisy2002`, and a password, and got a bare
**"Validation failed."** in an otherwise fully Arabic screen. Measured against the served app:

- the resolution is in `error.fields` — e.g. `{"password":["This password is too short…","too common",
  "entirely numeric"]}`, or `{"email":["Enter a valid email address."]}`;
- `error.message` is only the generic sentence, so rendering it (today's behaviour) tells the
  operator nothing;
- after H15a the field strings come back **in the language of the request** (`Accept-Language`).

## What to change (frontend only)

1. `src/app/api.ts` — `signup()`: send `Accept-Language` taken from the current UI locale (`ar`/`en`)
   on the request, so the server's own validator messages speak the operator's language.
2. On a validation failure, surface the **specific** reason, not the generic sentence:
   - keep the generic `error.message` only as a last-resort fallback when `fields` is absent or empty;
   - render the field's message(s) as the banner text AND attach it to the offending field:
     `aria-invalid="true"` + an inline message linked by `aria-describedby`, matching the pattern the
     requests pages already use (H13d). Map server field names → the form's inputs
     (`email` → email, `code` → code, `password` → password, `non_field_errors` → the banner).
   - prefix the banner with the field's own label («كلمة المرور: …» / «البريد الإلكتروني: …») so a
     reader who never sees the field still knows what to fix.
   - clear the message as soon as the operator edits that field (do not leave it stuck).
3. Never print a raw English validator sentence in the Arabic UI. If the server cannot supply a
   translated string for a field, fall back to a translated dict key (add keys in BOTH locales) —
   e.g. «كلمة المرور ضعيفة — لازم ٨ حروف على الأقل ومش كلها أرقام.».
4. State the password rules up-front under the password field (minimum 8 characters, not entirely
   numeric, not a common password) so the failure is preventable, not just explained.
5. **`Menisy2002` must stay accepted.** Confirm the demo-lane constant
   (`DEMO_SIGNUP_CODE` in `LoginPage.tsx`) equals `Menisy2002`, so the offline demo path accepts the
   same code as the live backend; if it differs, align it and say so.
6. Do not change the request shape, the fields' order, or the confirm-password behaviour added today.

## Prove it (browser, on the SERVED build — extend `frontend/scripts/cdp-signup-live.mjs`)

Rebuild before measuring (`npm run build:demo`) and paste the real output:

- a weak password (`123`) + `Menisy2002` → the banner names the password AND an Arabic reason appears
  (assert there is no English sentence left in the panel and no bare "Validation failed.");
- a malformed email → the message attaches to the email field (assert `aria-invalid` + the linked id);
- editing the field clears the message (assert it disappears without another submit);
- a fresh email + `Menisy2002` + a strong password → signed in and `/api/v1/auth/me` reads that email;
- a wrong code → «الكود غير صحيح.» (unchanged);
- with the UI switched to English, the same weak-password attempt shows the English message.
- Keep every existing check in that probe passing, and keep the gates green
  (`for f in scripts/verify-*.ts; do npx tsx "$f"; done` → 13/13) and `npx tsc -b` clean.

## Constraints

- Do not commit. The lead commits after review.
- Report: files changed with line counts, the exact commands + real output, and anything you could
  not verify — say so plainly instead of implying coverage you did not have.
