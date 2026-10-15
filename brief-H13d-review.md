# H13d — independent review of the «طلب جديد» redesign (implemented, uncommitted)

You are the independent reviewer. The implementation is **in the working tree, not committed**.
Your job is to find what is wrong with it — not to praise it, and not to re-argue the design.

## Where everything is
- Repo: `/home/menisy/Desktop/Me/tracking_system_project` (working tree has the change; `git diff` is your diff).
- The spec the implementer had to follow: `brief-H13c-requests-new-impl.md` (binding decisions).
- The design proposal: `design-H13-requests-new.md`. The independent critique: `design-H13b-requests-new-critique.md`.
- Changed files: `frontend/src/styles/global.css`, `frontend/src/i18n/dict.ts`,
  `frontend/src/app/requestDraft.ts`, `frontend/src/screens/MyRequestsPage.tsx` (`NewRequestPage` only),
  plus `frontend/scripts/cdp-new-request.mjs` and `frontend/scripts/verify-request-period.ts`.
- The served app (the built demo bundle) is at `http://192.168.1.19:8080` — route `/requests/new`.
  It is served in **demo** mode: build with `npm run build:demo` (a plain `npm run build` turns the demo
  path off and the app falls back to the login screen — that mistake has already been made once).

## What I (the coordinator) already verified myself, so do NOT re-report it as new
- `npx tsc -b` clean; **13/13** gate scripts pass; the served bundle equals the built one
  (`npm run build:demo` → `index-abts8Rag.js` served).
- The CDP harness `frontend/scripts/cdp-new-request.mjs` passes end-to-end against the served build,
  including: the type picker is segmented with 4 options, no typed title field, one-press submit →
  lands on `/requests` with the new row titled «إجازة اعتيادية — 4 يوم عمل», the receipt matches the
  derived title, start-only reads «يوم واحد» live, a zero-working-day range warns in the danger color
  before submit, PART_DAY times arrive empty, the action strip is sticky, the attachments slot shows
  the Arabic demo line + a real disabled input, the draft banner states the outcome not the demo
  plumbing, and no fatal console error on any step.

## Your job — find the real problems
Work by measuring the served build (headless Chrome over CDP; `frontend/scripts/cdp-verify.mjs` and
`cdp-new-request.mjs` show the pattern — Node 22+ global `WebSocket`, no packages), and by reading the
diff. Report each finding as **CRITICAL / HIGH / MEDIUM / LOW** with the concrete fix.

1. **Did it follow the binding spec?** Walk `brief-H13c-requests-new-impl.md` §2–§5 decision by
   decision and say which were followed, which were quietly skipped, and any that were contradicted.
   A silently skipped decision is a finding.
2. **Did anything get weakened to make it pass?** Read the diffs of
   `frontend/scripts/verify-request-period.ts` and `frontend/scripts/cdp-new-request.mjs` and judge
   whether any pre-existing assertion was loosened, deleted, or rewritten into something weaker.
   Additive changes are fine; weakening is a CRITICAL.
3. **Accessibility, measured:** `aria-invalid` + `aria-describedby` actually present on the failing
   control after an invalid submit (and cleared after a valid one); the radio-group keyboard behaviour
   of the segmented picker (arrow keys / Space / Enter via real `Input.dispatchKeyEvent`, not a
   synthetic click); focus order; the sticky strip never covering the focused element or the success
   banner; the disabled file input still reachable to assistive tech.
4. **Contrast, both themes, per state:** the receipt line (accent + the danger variant — the light
   theme's danger measured as `rgb(154, 52, 18)`), muted hints on the inset, the segmented picker's
   selected and unselected states, the sticky strip over the card. Report ratios and whether they pass.
5. **Bidi:** the derived title and any composed receipt string render in the correct order in RTL
   (the repo's rule is in `frontend/src/app/useMockList.ts`'s docblock — the shared formatters already
   emit Unicode isolates, and the H8 gate forbids `<bdi>` around a formatter call). Verify the
   rendered order in the browser, including Arabic mixed with the Latin digits of a date.
6. **Behavioural regressions outside the page:** the redesign changed submit to navigate to
   `/requests`, made PART_DAY times start empty, and made a draft save clear the unsaved-changes flag.
   Check each does not break a neighbouring flow: the manager's review screen for a freshly submitted
   request, the requests list, a PART_DAY request submitted with empty times (is it refused with a
   usable message?), and leaving `/requests/new` mid-fill.
7. **The reason field:** `maxLength=500` in the UI — does the backend accept that (check the API's
   field limits in `backend/requests/` or wherever `details` is validated) or can a 500-char reason be
   rejected after the user typed it? A mismatch is a HIGH.
8. **Mobile ~375px and English locale:** no overflow, the sticky strip usable, the segmented picker
   wraps instead of truncating a long Arabic type name, and the receipt line readable in `en`.

## Rules
- **Do not fix anything.** Do not edit `frontend/src`, do not commit, do not rebuild unless a
  measurement needs it (if you rebuild, rebuild with `npm run build:demo`).
- Every claim must carry its evidence: the probe, the selector, the computed value, the ratio.
- If a check you ran passed, say so in one line — negative space matters for what I can trust.
- End with: the findings ranked, then a five-line summary of the three things that must be fixed
  before this ships and the two you would leave alone.
