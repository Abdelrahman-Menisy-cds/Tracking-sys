# H13 — «طلب جديد» (the new-request form): design proposal

You are the design lead for **one page**. Deliver a **design proposal document**, not code.

## The product
A company time-tracking / attendance web app (Arabic-first, RTL, English second) used by employees,
team leads and HR. React + Vite + TypeScript. **Dark theme is the default**; a light theme exists at
`:root[data-theme="light"]` in `frontend/src/styles/global.css`, and the app follows
`prefers-color-scheme` plus a header toggle. One shared design system lives in
`frontend/src/styles/global.css` — tokens at the top (spacing scale `--space-*`, radii, type scale,
elevations, semantic colors) and the control primitives below (`.btn*`, `.field*`, `.input/.select/.textarea`,
`.work-surface`, `.quiet-inset`, `.page-header`). Accent is a warm red `#F06060`; type is
`"Noto Sans Arabic"` for Arabic and `Inter` for Latin.

## The page in scope — and only this page
Route `/requests/new` → `NewRequestPage`, exported from `frontend/src/screens/MyRequestsPage.tsx`
(the same file also exports the requests **list** page — the list is not in scope).

The form:
1. «نوع الطلب» — a select with 4 types: إجازة اعتيادية · إجازة مرضية · تصريح خروج أثناء اليوم · تصحيح سجل وقت
2. «المدة» — a from/to date range; for the exit permit a date + from/to **times**; for the time correction a **single** date
3. «السبب» — free-text textarea
4. «المرفقات» — file input (disabled in this demo)
5. Actions: «رجوع» · «حفظ كمسودة» · «إرسال الطلب»

**Behaviour that must not change** (the redesign is visual/interaction, not functional):
the chosen period is the request's source of truth — the manager's review suggestion reads those dates
*before* any free text; the request title is derived from type + period and is never typed; one press on
«إرسال الطلب» submits with no confirmation step; the reason stays optional free text.

## What the page looks like today (measured, not guessed)
- The period control is the browser's native `<input type="date">`: it prints `mm/dd/yyyy`, carries a
  native calendar glyph, and its value order is a locale accident.
- The attachment control is a native file input printing English «Choose File» / «No file chosen»
  inside an Arabic page.
- The period block reads as a bordered box whose title is jammed against its top border.
- Every field is full width at the same visual weight, so nothing guides the eye from type → period → reason.
- Both helper lines are a wall of muted gray (e.g. «المدة تُختار من التقويم، والتفاصيل تبقى سببًا فقط.»).
- The three actions sit at the bottom of a long card, below the fold.
- The whole screen is one tall white card on a gray page — the generic card default.

A reference screenshot of the **current** page (light theme) is at
`h13-current-requests-new.png` in this repo root: if your runtime can view images, look at it;
if not, the measured facts above are complete and you should also measure the live page yourself
(see Verification below).

## Required reading before you design (binding)
- `.agents/skills/frontend-design/SKILL.md` — treat as binding: deliberate, opinionated choices,
  a real token system, the anti-default trait list at the end, and the two-pass process
  (design plan → review against the brief → only then code).
- `.agents/skills/web-design-guidelines/SKILL.md` — fetch the guidelines from the URL it names and apply them.
- `frontend/src/styles/global.css` (tokens + primitives) and the page source in `frontend/src/screens/MyRequestsPage.tsx`.

## Constraints
- Reuse the existing tokens. You may propose **new** tokens, but say why for each and keep the palette
  coherent with the product (warm red accent on a dark UI, muted surfaces, one family per script).
- **Both themes must work** — light is the under-tested one (the reference screenshot is light).
- Arabic RTL is primary; English LTR must still work. All copy lives in `frontend/src/i18n/dict.ts`,
  never inline in components.
- No generic AI/SaaS tells: no gradient washes, glassmorphism, identical oversized rounded cards,
  one radius for everything, decorative charts, badge soup, tracked-out ALL-CAPS eyebrows,
  `→` appended to buttons, or meta strings joined by `·`.
- Survive ~375px width; visible keyboard focus; respect `prefers-reduced-motion`.
- **Do not edit anything under `frontend/src`.** This is a design document. Do not commit.
- Do not weaken verification: the page has a CDP check (`frontend/scripts/cdp-new-request.mjs`) that
  measures the **served** build and must keep passing after implementation. You may propose extending it.

## Verification available to you
The app is served from the built bundle at `http://192.168.1.19:8080` (route `/requests/new`).
Headless-Chrome-over-CDP harnesses already exist — read `frontend/scripts/cdp-new-request.mjs` for the
pattern (Node 22+ global `WebSocket`, no npm packages). Measure the live DOM (`getComputedStyle`) rather
than reasoning from the CSS file alone.

## Deliverable — write `design-H13-requests-new.md` in the repo root
1. **Design plan**: 4–6 named hex values and the accent's role; the type roles and sizes; the layout
   concept with **ASCII wireframes comparing at least 2 options for the period block** (say which you
   chose and why); alignment guidance.
2. **Section-by-section treatment**: page header · type picker · period picker (dates and times) ·
   reason · attachments · the action row and its hierarchy.
3. **States**: default · filled · error · busy/submitting · success · disabled-in-demo.
4. **Copy**: the exact Arabic (and English) strings for every label, placeholder, hint or error you add or change.
5. **Anti-generic self-review**: what a template would have produced for this page, and what you did instead.
6. **Implementation order**: the components/tokens to add or change, in the order to build them.

Report the file path and a 5-line summary at the end. Do not edit `frontend/src`. Do not commit.
