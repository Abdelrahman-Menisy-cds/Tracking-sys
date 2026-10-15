# H14b (frontend) — login page: drop the role picker, add «أول مرة؟ إنشاء حساب»

Implement the **SPA half** of the signup feature. The backend half already exists (see below).
Work only in `frontend/`. Do not touch `backend/`.

## The product
`/home/menisy/Desktop/Me/tracking_system_project` — Arabic-first RTL time-tracking app (React + Vite +
TypeScript). The Django+DRF backend serves the SPA on the same origin, port **8080**. The page you
change is `frontend/src/screens/LoginPage.tsx` (route `/login`, reached whenever there is no session).

## The backend half is already live (verify it yourself before coding against it)
`POST /api/v1/auth/signup` exists on `http://192.168.1.19:8080` and answers (a bare POST returns **403**
because it enforces CSRF exactly like `POST /api/v1/auth/login` — that is correct, not a bug).
Read `backend/accounts/views.py`, `serializers.py` and `urls.py` for the exact payload and response
shape, and bootstrap CSRF the same way the existing `login()` in `frontend/src/app/api.ts` does.
**The live implementation is the source of truth**; if it differs from the notes below, follow it and
report the difference.

Expected contract (confirm, do not assume): request `{ email, code, password }`; on success the
response envelope is the app's `{"data": <CurrentUserSerializer>, "meta": {"csrftoken": …}}` — the same
shape `login()` returns — and a valid code signs the new **HR** account straight in, so the user must
land inside the app, not back on the login screen. A wrong/inactive code is rejected with a
non-enumerating error; an email that already exists is handled without re-roling or leaking.

## What to build on the login screen
1. **Remove the role picker.** Today `showRoleBlock` includes `DEMO_MODE`, so the «الدور» segmented
   control is always visible and it *looks* like it grants a role (it does not — the comment in the
   file says so, the server decides). Remove it from the normal screen: `?dev=1` may still reveal it
   as the opt-in dev affordance it was designed to be. The role readout line («الدور: …») goes with it.
   Nothing else about signing in changes.
2. **A new entry under the sign-in button**: «أول مرة؟» followed by an «إنشاء حساب» action (a button
   or a link-styled control — it must be a real interactive element with a visible focus state, not a
   `<span>` with a click handler). It reveals the signup form **on the same page** (a panel that
   replaces the sign-in form inside the same card, with a way back to signing in).
3. **The signup form** — four fields, in this order (the owner's spec):
   - «البريد الإلكتروني» — the account email (the account is created as **HR**; say so in the copy,
     e.g. «الحساب بيتعمل كـ موارد بشرية»);
   - «كود الاشتراك» — the code, `dir="ltr"`, `autoComplete="off"`, `spellCheck={false}`;
   - «كلمة المرور» — required (the account needs one to sign in again later); reuse the existing
     password-field pattern with its show/hide eye toggle;
   - «تأكيد كلمة المرور» — must match the first one; a mismatch is refused **client-side** with a
     clear message on the second field (and `aria-invalid` + a described-by pointer), and the request
     is not sent. The server still receives a single `password` — never send the confirmation.
   This is a **first-time creation**: a valid code stores the email + password as a real account
   (Django hashes the password — never store or echo it in plain text).
4. **Under the code field**, the line the product owner asked for, verbatim in Arabic:
   «مفيش كود؟ اتواصل معانا للاشتراك واستلام الكود الخاص بك» and the phone number **01200704564**
   rendered exactly, as a `tel:` link (`tel:01200704564`). In RTL, wrap the digits so the number
   reads in one piece (the codebase precedent is `<bdi>` for such content — the repo's rule against
   `<bdi>` applies only to the shared date/time formatter calls).
5. **Submit**: the button says «إنشاء حساب»; on success the user is signed in and lands inside the app
   (same `adoptSession(me)` + `navigate("/")` path the sign-in uses); invalid code / bad email / weak
   password show the server's message in the page's existing error banner style, and the busy state
   uses the existing spinner pattern with the button disabled.
6. **Demo / unreachable-server fallback**: this build is the **demo** bundle
   (`npm run build:demo`), and `LoginPage` already has a fallback when the API is unreachable
   (`ApiError.kind === "unreachable"` → local demo path). The signup must keep working there: the code
   **`Menisy2002`** passes locally (a demo-only constant, exactly like the existing `DEMO_ACCOUNTS`
   map that is in the bundle on purpose), and anything else is refused. Document that in the same
   style as the existing DEMO_ACCOUNTS comment.

## Copy
All new strings go into `frontend/src/i18n/dict.ts`, **both** `ar` and `en` (follow the file's existing
key naming). `t()` must be used for every label, hint and error you add — no inline ternary literals.

## Constraints
- Do not touch any other screen, the router, `global.css` tokens used elsewhere, or the request pages
  (another change to `/requests/new` is in the working tree — leave it alone).
- Both themes, `375px`, keyboard-only use, visible focus, `prefers-reduced-motion`.
- Do not commit.

## Verify before you report
- `npx tsc -b` clean.
- **Every** gate: `for f in scripts/verify-*.ts; do npx tsx "$f"; done` — all green. If an existing gate
  asserts the role picker's presence, **report it — do not weaken the gate.**
- Rebuild the served bundle with **`npm run build:demo`** (a plain `npm run build` disables the demo
  path and sends the app back to `/login` — this mistake was already made once in this repo).
- Drive the served build over CDP (the pattern is in `frontend/scripts/cdp-new-request.mjs` /
  `cdp-shot.mjs`: headless Chrome + Node 22 global `WebSocket`, no packages) and **prove the flow**:
  the role picker is gone from the normal page; the new entry exists; the signup form shows the three
  fields and the contact line with the number; a **wrong** code is refused; the code **Menisy2002**
  signs in and lands inside the app (assert the URL, not just the absence of an error); the account
  created is HR. Write that probe as a script under `frontend/scripts/` so I can re-run it.

## Report back
1. Files changed with line counts.
2. The exact commands + real output: tsc, the gate loop's pass/fail count, the build, and your CDP
   probe's output (paste the check lines).
3. What the live backend actually did when you called it (request + response), including the failure case.
4. Anything in this brief you could not do, and what you did instead.
