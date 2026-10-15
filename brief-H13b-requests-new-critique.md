# H13b — «طلب جديد» (the new-request form): independent UX critique

You are reviewing one existing screen before it is redesigned. Work **independently**: do not look for,
read, or wait on any other design document for this page — your value is an unframed second opinion.
Nobody has told you what is wrong with it; find out.

## The product
A company time-tracking / attendance web app (Arabic-first, RTL, English second) used by employees,
team leads and HR. React + Vite + TypeScript. Dark theme is the default; a light theme exists at
`:root[data-theme="light"]` in `frontend/src/styles/global.css`; the app follows `prefers-color-scheme`
plus a header toggle. The shared design system is `frontend/src/styles/global.css` (tokens at the top,
control primitives below). Arabic type is `"Noto Sans Arabic"`, Latin is `Inter`.

## The screen in scope — and only this screen
Route `/requests/new` → `NewRequestPage`, exported from `frontend/src/screens/MyRequestsPage.tsx`
(the same file also exports the requests **list** page — the list is not in scope).

The form:
1. «نوع الطلب» — a select with 4 types: إجازة اعتيادية · إجازة مرضية · تصريح خروج أثناء اليوم · تصحيح سجل وقت
2. «المدة» — a from/to date range; for the exit permit a date + from/to **times**; for the time correction a **single** date
3. «السبب» — free-text textarea
4. «المرفقات» — file input (disabled in this demo)
5. Actions: «رجوع» · «حفظ كمسودة» · «إرسال الطلب»

Fixed behaviour (not up for debate): the chosen period is the request's source of truth — the manager's
review suggestion reads those dates before any free text; the title is derived, never typed; one press on
«إرسال الطلب» submits with no confirmation step.

A reference screenshot of the current page (light theme) is at `h13-current-requests-new.png` in the repo
root — if your runtime can view images, look at it. The app is served from the built bundle at
`http://192.168.1.19:8080/requests/new`; headless-Chrome-over-CDP harnesses already exist
(`frontend/scripts/cdp-new-request.mjs` shows the pattern: Node 22+ global `WebSocket`, no npm packages) —
measure the live DOM and `getComputedStyle` rather than trusting the stylesheet.

## Your job
1. **What reads as dated, generic, or templated on this screen today, and why.** Name the specific tell,
   not a vibe.
2. **Hierarchy, density, navigation.** What is an employee actually trying to do here, and where does the
   screen fight them? What should carry the eye first, and what gets equal weight today that should not?
3. **What to remove.**
4. **Edge cases that make or break this form** — the four request types (range · date+times · single date),
   partially filled periods, an end before a start, weekends/holidays, an unsaved-changes exit, a failed save,
   a very long reason, a long Arabic type name, RTL rendering of numbers and dates (Bidi), keyboard-only use,
   mixed Arabic/Latin content.
5. **Accessibility**: labels vs placeholders, error association (`aria-describedby`, `aria-invalid`),
   focus order, target sizes, contrast in **both** themes.
6. **Your recommended direction** — concrete: the structure you would ship, the hierarchy, what carries the
   eye, and the 2–3 things you would deliberately *not* do.
7. **Findings ranked by impact** (blocker / high / medium / low), each with the concrete fix beside it.

## Constraints
- **Do not edit anything under `frontend/src`.** Do not commit. This is a review document.
- Critique this screen; do not redesign the rest of the product and do not propose backend/API work.
- Every claim you can measure, measure (live DOM, computed styles, both themes) and say how.

## Deliverable — write `design-H13b-requests-new-critique.md` in the repo root
The seven items above, in that order, each with evidence. End with a 5-line summary of the three changes
you would make first and the one you would refuse to make. Do not edit `frontend/src`. Do not commit.
