# H17 — Company profile: frontend (mandatory first step + settings widget)

## Why

Self-service HR signup (H14) activates an account and drops the HR user straight
into the app, without ever capturing the organisation's identity. The owner's
decision: **right after the subscription is activated, the first thing the HR
user does is enter the company's data**, and that data must be stored and shown
again as a **separate widget inside the organisation settings page**.

The backend half (model `CompanyProfile`, `GET/PATCH /api/v1/company`, and a
`needs_company_profile` flag on `/auth/me`) is landing in parallel — see
`brief-H17-company-profile-backend.md`. This brief is the frontend half.

## Repository and runtime (verified, do not re-derive)

- Repo: `/home/menisy/Desktop/Me/tracking_system_project`, frontend in
  `frontend/` (React 19 + TS + Vite, react-router-dom 7).
- The app is served at `http://192.168.1.19:8080` (Django serves the built SPA
  and the API on the same origin). Build with `npm run build:demo` (it runs
  `tsc -b` first — a type error fails the build), lint with `npm run lint`.
- The existing CDP probe pattern lives in `frontend/scripts/` (see
  `probe-h16-tour-pages.mjs`): headless Chrome over `--remote-debugging-port`,
  signup via `POST /api/v1/auth/signup` with the subscription code `Menisy2002`,
  then assertions printed as plain lines. Follow that shape.
- i18n: **all user-facing text lives in `frontend/src/i18n/dict.ts`**, with an
  Arabic and an English block that must both gain every new key. Never inline a
  string in a component.

## API contract (frozen — implement against exactly this)

- `GET /api/v1/company` → `{"data": {"profile": {...}|null, "needs_profile": bool}}`
- `PATCH /api/v1/company` → same shape; 400 with per-field errors otherwise.
- `/api/v1/auth/me` gains `needs_company_profile: bool`.

Profile fields: `name`, `activity`, `address`, `phone` (**required**);
`email`, `website`, `logo_data_url`, `commercial_register`, `tax_card`,
`contact_name`, `contact_role`, `contact_phone` (**optional**).

## What to build

1. **API client** (`src/app/api.ts`): `fetchCompany()` and `saveCompany(patch)`
   following the existing helpers' style, and extend the identity type with
   `needs_company_profile`. If the API is not answering yet, retry with backoff
   for a bounded period and then report precisely what you could not verify —
   never fabricate a response.
2. **Mandatory gate** (`src/app/AppShell.tsx`): when the identity says
   `needs_company_profile` is true, every route except `/onboarding/company`
   redirects there (`<Navigate replace />`), and the only escape is signing out
   from the profile menu (the tour, nav, and other screens must not be
   reachable). **Fail open**: if the flag is absent or the request fails, the app
   behaves exactly as it does today — a missing flag must never brick the app.
3. **Onboarding screen** (`src/screens/OnboardingCompanyPage.tsx`, route
   `/onboarding/company`): a form split into a required group (الاسم، النشاط،
   المقر، التليفون) and an optional group (the rest), a logo picker that reads
   the file with `FileReader`, downscales it to at most 200 KB and sends a
   `data:image/...;base64,` string, a summary of what is still missing, and a
   primary "حفظ ومتابعة" that saves and then continues into the app. Use the
   existing form/field/button classes and tokens so it matches the signup screen.
   Show per-field errors from the server's 400 response, translated.
4. **Settings widget** (`src/screens/admin/CompanyProfilePanel.tsx`, mounted as
   its own widget inside `src/screens/admin/AdminSettingsPage.tsx`, beside the
   departments/schedule/leave/holidays widgets): shows the company identity
   (logo, name, activity, address, phone, contact, legal numbers) with an edit
   action that reuses the same form, and an empty state pointing at the missing
   fields. It is a distinct widget card, not a paragraph inside another one.
5. **Tour**: add `/onboarding/company` to the per-page tour registry in
   `src/features/tour/TourGuide.tsx` (same `pageSteps(...)` shape, new dict keys)
   so the new screen explains itself on first visit like every other page.
6. **Dict**: every new label, hint, error, and empty state in Arabic and English.

## Verification (real runs, paste the output)

1. `npm run build:demo` (must pass `tsc -b`) and `npm run lint`.
2. A new probe `scripts/probe-h17-company-onboarding.mjs` that, against the
   running app, proves with a **fresh HR account**:
   - after signup the app lands on the company step and the rest of the app is
     not reachable (navigate to `/requests` and confirm you end up back on the
     onboarding screen, with the nav not usable);
   - submitting with a required field blank shows the server's error;
   - submitting complete data saves, leaves the onboarding, and the app works;
   - the settings widget then shows the saved values;
   - after a reload the gate does not come back.
   Print one line per check and a final pass/fail line, like the existing probes.
3. A screenshot of the onboarding screen and one of the settings widget, saved
   under `/home/menisy/.hermes/cache/scratch/h17-shots/`.

Every claim must be backed by real command output. No placeholders, no "should
work", no invented screenshots.

## Git

Do **not** commit, stage, or stash anything. The working tree already holds
uncommitted work from another task; leave every file you did not write exactly
as you found it.
