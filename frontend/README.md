# هي فوضى؟ — Frontend Visual Demo

Arabic-first (RTL) responsive clickable prototype for the **هي فوضى؟ / Heya Fawda?** employee
requests and time-tracking website. **This is a visual demo build: all data is mock data and
there is no backend integration.** The backend (Django + DRF) in this repository is untouched.

## Run locally

```bash
cd frontend
npm install
npm run dev
```

Then open the URL Vite prints (default: http://localhost:5173).

Production build + preview:

```bash
npm run build
npm run preview   # default: http://localhost:4173
```

Lint / typecheck:

```bash
npm run lint
```

## What the demo includes

- Arabic-first RTL UI with full English toggle (`العربية` / `English`), logical-property layout
  that mirrors automatically, and `<bdi>` isolation for mixed-script content.
- Light / Dark / System appearance following the approved candidate token palette
  (`src/styles/tokens.css`, from the UX brand direction §8).
- Sign-in screen (S01) with demo role selection: Employee / Manager / HR.
- Role-scoped home (S02), My requests + new-request editor (S03), request detail with
  append-only history (S04), My timesheets with weekly entry editor (S05), manager review
  queue with approve / reject / return decision modal (S06), notifications (S10).
- Loading (skeleton), empty, error + retry, validation, disabled/read-only, and success states
  throughout: submit/save/decision acknowledgements use the success tone, and reviewer tools in
  the sidebar (`أدوات حالات العرض`) preview the error and empty list states on the next load.
- Accessibility: keyboard-visible skip link, WAI-ARIA tabs pattern (arrow keys) on the review
  queue, Escape-to-close mobile drawer with focus return, dialog body scroll lock, unread
  notifications badge with an accessible label, and per-page document titles.
- Original composed-clipboard brand mark (favicon + nav), no third-party marks.
- Demo banner is shown at all times stating that displayed data is mock data.

## Deliberate demo limitations (not real-system behavior)

- No real authentication, no network calls, no attachment upload.
- Role switching is an explicit demo affordance for viewing each role's screens; it is not a
  permission simulator and does not exist in the approved UX direction.
- Mock data mirrors the shapes of the real API (`/api/v1/...`) but is not wired to it.

## Stack

React 19 + TypeScript + Vite + React Router (project-local `frontend/`, no global installs).

## Verified screenshots (headless Chrome, Arabic RTL dark theme)

- `docs/screenshots/demo-login.png` — S01 sign-in
- `docs/screenshots/demo-home.png` — S02 role-scoped home
- `docs/screenshots/demo-requests.png` — S03 my requests
- `docs/screenshots/demo-timesheets.png` — S05 my timesheets
- `docs/screenshots/demo-reviews.png` — S06 team review queue
- `docs/screenshots/demo-requests-mobile.png` — S03 my requests, 390px mobile viewport

