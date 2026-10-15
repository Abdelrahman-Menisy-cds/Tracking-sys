Your previous run hit the 120-turn cap mid-work and stopped. The server is up
again on http://192.168.1.19:8080 and the backend half is live (GET
/api/v1/company answers 401 without a session, i.e. the route exists and is
protected).

Finish the frontend half exactly as brief-H17-company-profile-frontend.md
requires, and do not redo work that is already on disk:

1. Wire the mandatory gate in `src/app/AppShell.tsx`: when the identity says
   `needs_company_profile`, every route except `/onboarding/company` redirects
   there and only signing out escapes. Fail open — a missing flag must never
   brick the app.
2. Every new dict key present in BOTH the Arabic and the English block of
   `src/i18n/dict.ts`.
3. Register `/onboarding/company` in `PAGE_TOURS` in
   `src/features/tour/TourGuide.tsx` with the shared `pageSteps(...)` shape.
4. `npm run build:demo` (runs `tsc -b`) and `npm run lint` must both pass.
5. Write `scripts/probe-h17-company-onboarding.mjs` following the existing
   probe pattern in that directory, and RUN it against
   http://192.168.1.19:8080 with a fresh HR signup using subscription code
   `Menisy2002`. It must prove, with one printed line per check and a final
   pass/fail line: the app lands on the company step after signup; navigating
   to /requests returns to the onboarding screen; submitting with a required
   field blank surfaces the server's field error; submitting complete data
   saves and the app becomes usable; the organisation-settings widget then
   shows the saved values; and a reload does not bring the gate back.
6. Screenshots of the onboarding screen and of the settings widget under
   `/home/menisy/.hermes/cache/scratch/h17-shots/`.

Do NOT commit, stage, or stash anything. Leave files you did not write exactly
as you found them.

Finish with a short report that quotes the real command output you observed.
If any step could not be completed, say precisely which one and why — do not
claim success without the output to back it.
