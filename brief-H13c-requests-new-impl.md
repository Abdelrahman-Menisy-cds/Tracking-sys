# H13c — «طلب جديد» (`/requests/new`): implementation spec (authoritative)

You implement a redesign that has already been through design + independent critique. Two documents
sit beside this one and are the full argument; **this file is the binding spec** and resolves every
place where they disagree. Read all three, then build.

- `design-H13-requests-new.md` — the design proposal (measured baseline + tokens + layout + copy + states).
- `design-H13b-requests-new-critique.md` — the independent critique (measured defects + fixes).
- `h13-current-requests-new.png` + `shots/before-requests-new-light.png` / `-dark.png` — the page today.

Nothing under `frontend/src` may be committed. Do not commit at all; report for review.

## 1. What must not change (the product's fixed contract)

1. The picked **period is the request's source of truth** — the manager's review suggestion reads those
   dates before any free text.
2. The **title is derived**, never typed: it must be exactly `buildRequestTitle(draft, locale)`.
3. **One press** on «إرسال الطلب» submits — no confirmation dialog, no second step.
4. The reason stays free text (optional) and never becomes the title.
5. The four request types and their period shapes stay: FULL_DAYS (from/to dates), PART_DAY
   (date + from/to times), SINGLE_DATE (one date).

## 2. Test hooks the existing CDP harness depends on — verified by reading it, not guessed

`frontend/scripts/cdp-new-request.mjs` measures the **served** build. It uses, today:

| Hook | Used for |
|---|---|
| `#request-period` | poll for the form, set the start date, and re-read on the request's detail screen |
| `#request-period-end` | set the end date |
| `textarea[name="details"]` | the reason field (it reads back its value) |
| **absence** of `#request-title` | proves the typed title is gone |
| **absence** of `.attention-strip` after the first press | proves the one-press flow |
| `.form-actions .btn-primary` | the submit button |
| an element with class `.field-hint` existing, with `4 يوم عمل` in the body text | the live duration |
| `a[href="/requests"]` | the in-app way back to the list |

So: keep those ids/class hooks (`request-period`, `request-period-end`, `request-clock`,
`request-clock-end`, `name="details"`, `.form-actions` on the action strip, a `.field-hint` in the
tree — the receipt line can carry that class). **A single `.form-actions` wrapper containing the
primary button must survive.** Do not reintroduce a title field.

You **may** extend the harness (required here — see §5.2). You may not delete an assertion that is
already passing; if a change makes one obsolete, keep it and add the new one beside it, and say why
in the report.

## 3. Binding decisions (where the two documents disagree)

| Question | Decision |
|---|---|
| Type picker | **Segmented control using the existing `.role-segmented` / `.role-segmented-option` primitive** (design), *not* new radio-cards. Reason: it is already in-house (login, tasks, admin) and already ships RTL, focus-visible and wrap behaviour. Add a page-scoped wrap rule + a 12px muted path line inside each option (design §2.2). Do **not** modify the shared `.role-segmented-option.is-selected` rule — scope any softer selected state to this page or leave the primitive's solid-accent selection as-is. |
| Period layout | **One row** (both documents converge): dates side by side; for PART_DAY one row `[التاريخ] من [ساعة] إلى [ساعة]`. No stacked full-width siblings. |
| Live read-out | **One line** under the period, carrying the **derived title** exactly as `buildRequestTitle` returns it (that is both the design's preview and the critique's receipt), plus the picked range as a second muted line. Wrap any composed string containing Latin/digits in **`<bdi>`** or `unicode-bidi: isolate` (the list page already does this — `MyRequestsPage.tsx:28`). |
| Live warnings | The receipt must react **at pick time**, not only at submit: start-only FULL_DAYS reads «يوم واحد»; a span with **zero working days** reads its warning **in `--danger`** live. |
| Stale period on type switch | **Keep the values, re-run the live read-out and warnings** (do not silently clear the user's pick). If a kept value is invalid for the new type, the receipt says so before submit. |
| PART_DAY default times | **Start empty** (today they pre-fill 09:00/11:00, so a user can submit a window they never picked). Keep the existing validation that both are present and ordered. |
| After **submit** succeeds | **Navigate to `/requests`** — the page's job is done. This is an authorized behaviour change (the critique's blocker): today the form stays, keeps its values and the submit button still reads «إرسال الطلب», so a second press sends a duplicate from stale state. |
| After **save draft** succeeds | **Stay** on the page, show the success state, and **clear the unsaved-changes flag** so «رجوع» stops claiming «لديك تعديلات غير محفوظة» (the critique's second blocker). |
| Banner copy | Rewrite the demo-plumbing narration to the **state**, not the mechanism («تم الحفظ كمسودة — بانتظار مراجعة المدير» style). The app already carries a global demo banner, so per-action lifecycle sentences («طبقة العرض التجريبية… تختفي بعد إعادة التحميل») go away. If an existing verify script asserts the old wording, keep the assertion and report it — do not silently weaken a gate. |
| Action row | Sticky strip inside the card (design §2.6) with reserved space (`--stick-actions-height`) so it never covers the last field or the success banner: «إرسال الطلب» (primary, first in RTL reading order, min 180px) · «حفظ كمسودة» (secondary) · «رجوع» (ghost — it stays as the unsaved-changes entry point). |
| H1 size | **Keep 32px** (the app's `.page-header h1` scale). The critique's 22px suggestion is noted and deferred for product-wide consistency. |
| Attachments | One muted line, no 143px dead box: keep a real `<input type=file disabled>` in the tree for assistive tech, visually replaced by the styled line (design §2.5). |
| Light-theme token contrast | **Do not change global tokens.** The critique's 4.31:1 light-hint and sub-3:1 control borders pass or barely-miss and are app-wide decisions; report them, don't fix them here. |

## 4. Also in scope (cheap, measured, high-value)

- `aria-invalid="true"` + `aria-describedby` from the failing control to the error message node; clear both when valid again. (Today: zero `aria-invalid` anywhere, error text only in a banner.)
- `aria-describedby` for the type picker → its path line, and the period inputs → the receipt line.
- Reason: soft `maxlength` (e.g. 500) + a character count that stays quiet until near the cap, and say it is optional in the label.
- Keep every control's visible `:focus-visible` ring; keep the sticky strip clear of the focused element.
- Both themes (light is the under-tested one), RTL primary + LTR still working, ~375px, `prefers-reduced-motion`.

## 5. Files and order

Work in this order and keep each step green before the next:

1. `frontend/src/styles/global.css` — the three tokens (`--form-max`, `--stick-actions-height`,
   `--period-numeric: tabular-nums`), the page-scoped rules (`.new-request-page …`) for the label
   scale, the segmented wrap, the period row, the receipt line, the sticky strip and the file
   placeholder. Page-scoped only: other screens must not shift.
2. `frontend/src/i18n/dict.ts` — the new/changed strings from design §4, **both** `ar` and `en`.
3. `frontend/src/app/requestDraft.ts` — only what the live read-out needs (a duration/receipt text
   that also reports the zero-working-day and single-day states). **13 verify scripts gate this
   file**; run them all and keep them green. If a gate must change because a rule genuinely changed,
   that is a product decision: keep the old check, add the new one, and report it.
4. `frontend/src/screens/MyRequestsPage.tsx` — `NewRequestPage` only. Do not touch the list page's
   behaviour (its `<bdi>` title rendering is the reference for the bidi fix).
5. Verification:
   - `npx tsc -b` clean, **and** `npm run build` (the app serves the built bundle — my verification
     measures the served build, so a source-only change is invisible to it).
   - **Every** gate: `for f in scripts/verify-*.ts; do npx tsx "$f"; done` — all green.
   - `node scripts/cdp-new-request.mjs http://192.168.1.19:8080 9339` — green, extended per §5.2.
     `node scripts/cdp-shot.mjs http://192.168.1.19:8080 shots after-requests-new 1280` — capture
     both themes for the hand-off.
5.2 Harness additions (additive):
   - the type picker is no longer a native `<select>` (`document.querySelector('.role-segmented')` exists);
   - the receipt line exists and its text **equals** `buildRequestTitle` for the filled draft;
   - a start-only FULL_DAYS draft reads «يوم واحد»;
   - a zero-working-day range shows the live danger warning **before** submit;
   - after one press on «إرسال الطلب» the URL becomes `/requests` and the new row is present;
   - after a draft save, «رجوع» does not warn about unsaved changes;
   - the PART_DAY time inputs are empty on arrival;
   - the action strip is `position: sticky` and all three labels are present;
   - the attachments slot shows the Arabic demo line and a real disabled file input is still in the DOM.

## 6. Report back (this is what I verify, so be exact)

1. The files changed, with line counts.
2. The exact commands you ran and their real output (tsc, build, the gate loop's pass/fail count, the
   CDP harness — paste the last lines, not a paraphrase).
3. Which harness assertions you added, and which existing ones you had to adjust **and why**.
4. Anything in this spec you could not do, and what you did instead.
5. The two screenshots' paths.

Do not commit. Do not edit files outside the three listed plus the harness/scripts.
