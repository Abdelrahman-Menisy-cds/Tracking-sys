# H13b — Independent UX critique: «طلب جديد» (`/requests/new`)

Independent review of the current new-request screen. Measured against the served build at
`http://192.168.1.19:8080/requests/new` (2026-10-11), via headless-Chrome CDP probes
(`getComputedStyle`, live DOM, both themes, dark default + light override, desktop 1600px and
mobile 390px, AR + EN locales). All ratios computed from the live token values. Contrast numbers
are WCAG relative-luminance ratios I computed from the rendered tokens.

Not in scope: the list page, router, backend, API. No files under `frontend/src` were touched.

---

## 1. What reads as dated, generic, or templated — the specific tells

The screen is competent infrastructure, but it reads as "wireframe that grew a boss", not a 2026
product. Concrete tells, with measurements:

- **The templated-metaphor label vocabulary.** Every section is a `.quiet-inset` box with a bold
  16px/700 label and an identical anatomy (label → control → 14px muted hint), stacked
  full-width: نوع الطلب (710px wide), المدة (706px), السبب (710px), المرفقات (706px). Nothing
  ever breaks the rhythm — no alignment with the actual information shape of a request
  (who · what · when · why). This is the default "form with boxes" pattern that every form
  library ships; the single strongest dated tell.
- **Vertical stacking of peer controls at full width.** In the exit-permit variant, التاريخ,
  من الساعة, إلى الساعة each render **672px wide, one per row** (measured; verified again at
  390px mobile where they are still stacked). A date plus two times is one fact — a working
  window on one day — presented as three ~10-digit-wide fields each occupying a full row,
  then a 143px-tall attachments box carrying one disabled control. The form is ~1,400px tall
  for roughly six facts.
- **The hint line is a system log, not a UI copy.** Both the «حفظ كمسودة» and «إرسال الطلب»
  success banner print, verbatim: *"حفظت طبقة العرض التجريبية الطلب بالحالة «…». هذا التغيير غير
  دائم وسيختفي بعد إعادة تحميل الصفحة."* An user-facing screen narrating its own demo plumbing
  ("الطبقة التجريبية", "will disappear on reload") breaks the product voice at the moment of the
  user's most important action (submitting). Same for the attachments hint that promises
  "سياسة الخادم عند الربط" (a sentence about a future server policy, in the employee's face).
- **Copy that explains the mechanism instead of the task.** «المدة تُختار من التقويم، والتفاصيل
  تبقى سببًا فقط» — this sentence is an instruction to a reviewer of the implementation, not to
  an employee. It reads as an engineering note leaked into the interface. Contrast the path
  hint «المسار: مراجعة المدير.» which is genuinely useful and is the *third* line of muted text
  subordinate to a bold label — the one line carrying real consequence gets the least weight.
- **A 32px/700 centered-feel H1 ("طلب جديد") repeated twice** (`<h1>` + title metadata + a mute
  breadcrumb link «طلباتي») and a single main fieldset with no subheads. Desktop is a cursor
  reading page (`max-width: 760px`, `.reading-page`), i.e., newspaper-centering of a utility
  form; the visual language between the H1 and the boxes is a plain-framed rectangle with
  12px radius — completely fine, just not designed; nothing here distinguishes "ending a workday
  request" from "configuring a notification" (which the file also handles elsewhere).
- **The disabled attachments box has no visual "off" state distinct enough**, its hint is
  14px muted (`#a1a1aa` on `#15151a`, 6.32:1 dark — passes, and 4.31:1 light on the `#e8e8ea`
  inset — borderline). A whole 143px section of the screen is spent on a dead control.

---

## 2. Hierarchy, density, navigation

**The employee's actual job on this screen** (fixed contract): pick a type, pick a period, give a
reason, submit. Everything else is context.

Where the screen fights them, with measurements:

- **The two facts that matter least for eye guidance, the type name and the "path" hint, sit at
  the top in a 710×119 box; the fact that carries the whole request — the period — is buried
  inside a 300px-tall quiet-inset box at y=441.** On a 1000px-tall viewport the period's CalDav
  datepickers start around viewport-lower-third. For the exit-permit variant (3 input rows),
  the whole period block runs y=441→741, and the reason textarea starts at y=765 — the user is
  scrolling to give the reason before the period is even fully visible.
- **No live receipt of the request as it will be seen by the manager.** The chosen period is the
  source of truth (a good contract!), and the screen knows the derived duration — it shows it as
  *the second half of a muted 14px hint inside the box*: "المدة تُختار من التقويم، والتفاصيل تبقى
  سببًا فقط. 150 دقيقة". That one number — "150 دقيقة", "2 يوم عمل" — is the single most valuable
  summarization token the request produces, and it is the least-weights-weight element on the
  page. It deserves a role of its own (a "receipt" line): what the manager will read first.
- **Peer-equal weighting where it isn't peer-equal.** «حفظ كمسودة» and «إرسال الطلب» are equal
  weight in intent but the screen's attention hierarchy after them is wrong in subtle ways:
  «رجوع» (a navigation affordance, no data) sits **leftmost in an RTL action row (first in DOM,
  first in DOM order for a tab-first reach)** and in a 44px×68px button. The submit action is
  `#f06060` 126px wide in dark, `#c80000` 126px in light; contrast of accent vs the adjacent
  `#26262d` secondary button surface is 4.68:1 dark / 5.53:1 light — visible, but the two
  secondary buttons (`#26262d` dark) vs (`#fff` light) are visually interchangeable with the
  submit button's *shape/text*, so the visual differentiator is color alone — and color is the
  one thing the dark/light switch alters between them.
- **Navigation from here is three directions and none is strongly signposted:** back to the
  list «رجوع», back via the breadcrumb «طلباتي», or forward on submit. On mobile (390px) the
  three action buttons stack vertically and take 3×324px-wide rows (measured) — the biggest
  thing on the screen is no longer the form; it is three buttons.
- **Success never transitions you forward.** After a valid submit (measured): URL stays
  `/requests/new`, the date fields keep their values, the textarea keeps its text, the primary
  button still reads «إرسال الطلب», and the only evidence is a `role="status"` success banner
  above the form actions. The employee who submits (the happy path — the *point* of the page)
  gets a green explainer banner and no forward motion.

---

## 3. What to remove

1. **The "demo layer" narration in the success/error banners.** Keep the *state* ("تم الحفظ
   كمسودة — بانتظار مراجعة المدير" / "تم إرسال الطلب — بانتظار مراجعة المدير"); drop every
   sentence that talks about the demo lifecycle or non-persistence. If the demo's transience
   must be disclosed, that is a footer/global note, not the submit-banner copy.
2. **The hint under المدة ("المدة تُختار من التقويم، والتفاصيل تبقى سببًا فقط.").** Replace with
   only the derived receipt: "إجازة اعتيادية · الأحد 11–14 أكتوبر · 3 أيام عمل".
3. **The المرفقات quiet-inset box while it can't work.** One line, muted, no fieldset chrome;
   "لن يُطلب منك رفع مرفقات في هذه النسخة" — or drop completely after integration.
4. **The «رجوع» label + the breadcrumb doing the same job.** A back affordance at the top
   (breadcrumb «طلباتي / طلب جديد») is navigation; a back *button* among the form actions in the
   footer mixes navigation with submission and creates the unsaved-changes.banner pattern
   described in §4 instead of a simple link at the top. One or the other, not both.
5. **The extra field-label layer inside the quiet-inset (التاريخ / من الساعة / إلى الساعة).** In
   the exit-permit case these are three stacked full-width fields for one fact; collapse them
   into one row that reads like a sentence: [date] from [time] to [time]. This is what the
   fixed contract already says ("date + from/to times" describes one period object) — the UI
   should visually decompose it the way the data does, not as three siblings.
6. **The type select as a plain dropdown once a type is chosen** — replace with 4 discrete
   *type cards* (read as toggles) so the "long Arabic type name" (المصحيح سجل وقت / تصريح خروج
   أثناء اليوم) never truncates inside a `<select>` pill where its option text is clipped by the
   chevron. A `<select>` can truncate a long Arabic label; card-native chips can wrap.

---

## 4. Edge cases that make or break this form

Each verified live against the served build (`requestDraft.ts` + the DOM it renders). Contract
first: what the screen does today, and where it breaks.

| # | Case | Today (measured) | Verdict |
|---|------|------------------|---------|
| 4.1 | **Annual leave: start without end.** Pick «من تاريخ» only. | Screen's own generic hint stays: «المدة تُختار من التقويم، والتفاصيل…» and the submit succeeds against `endDate = startDate` (my probe submitted a request whose conditions read as 2 يوم عمل when I had picked start=14th and a stale end=17th — the stale-to-date *persisted* across a type switch). | **Breaks.** When the end is blank, `draftPeriodFields` silently sets `endDate = startDate` — the request becomes a 1-day leave without ever telling the employee. A "من تاريخ only" annual leave should (a) show the receipt as "1 يوم عمل", (b) explicitly say "من يوم واحد" before submit. |
| 4.2 | **End before start.** start=2026-10-10, end=2026-10-05. | Banner-error «تاريخ النهاية قبل تاريخ البداية.», `role="alert"`, focus moves to `#request-period`. Correct. | Passes. |
| 4.3 | **End date's `min` attribute.** Measured from the live DOM's `<input min>` — present after picking a start (component supplies `min: startDate`). | Passes for typing; **does not** prevent picking a reversed range in the calendar widget before typing the start (the min is data-driven, silently unset when startDate is empty after a type switch). Combined with 4.1 the field pair is fragile. |
| 4.4 | **Weekend-only range.** start=16th (Fri), end=17th (Sat). | «المدة المختارة ما فيها يوم عمل.» after submit. Correct per the contract. **But at *pick* time** the live period hint still shows the generic text and no working-day count (my probe shows the count only when > 0 — `durationText` returns `null` for a 0 day span). Notice only on submit. | Borderline. The screen should be able to interpret a picked range at the moment it's picked (Saturday-week complaint), not only at submit. |
| 4.5 | **Exit permit: end-time ≤ start-time.** 11:00→09:00. | «وقت النهاية لازم يكون بعد وقت البداية.» on submit, focus → `#request-clock`. **Default values are 09:00/11:00 pre-filled** — a new user might submit a real request with default times. | Breaks. Pre-filled times hide the field from the user (they never *picked* a period, the form just decides). At minimum show pickedness; better: start empty and only require the user to fill both. |
| 4.6 | **Type switch mid-fill: stale period survives.** Pick an annual range → switch to «تصحيح سجل وقت» → switch back to annual. Measured: `request-period=2026-10-14`, `request-period-end=2026-10-17` (weekend range) survived the round-trip **and submitted as 2 يوم عمل when I pressed submit after coming back from تصحيح.** | **Breaks.** A request type's period is the source of truth — the screen should either clear the period on a type change, or keep it and re-run the receipt hint (show "ما فيها يوم عمل" warning). Today it does neither; the period renders as if valid even after the type's semantic requirement has changed. |
| 4.7 | **Unsaved-changes exit.** «رجوع» with values filled: warning Banner (role="alert") «لديك تعديلات غير محفوظة...» is shown, stay/leave buttons inside the banner. | Passes functionally, **fails navigationally** — the unsaved-changes warning appears as an *inline banner at the bottom of the form*, not a modal; the buttons sit inside a banner whose *first* button is «خروج دون حفظ», the destructive one. Tab order reads خروج-before-cancel. Small but real — destructive should not be the leftmost (first tab stop) control. |
| 4.8 | **Back after successful save.** Draft saved → click «رجوع» (fields still filled). Measured: still warned as "uncommitted" (the `hasUnsaved` check does not clear after a save). | Breaks. After a successful save, «رجوع» is a pure navigation act; warning the lie "لديك تعديلات غير محفوظة" is at best noise, at worst an employee closing the dialog under false pretenses. |
| 4.9 | **Failed save.** Live failure path: catch branch prints «لم تؤكد طبقة العرض التغيير. احتفظنا بالقيم؛ أعد المحاولة.» — the *right* message, but it shares one muted 14px slot with the success banner position, and cannot be retried by keyboard re-focus (the banner is not focusable; the focus state at this point is wherever it was). | Borderline. Retry as an action ("أعد المحاولة") inside the banner; keep the field values (they already are). |
| 4.10 | **Very long reason.** `maxlength`: **-1** (no limit, measured). `rows: 2`, computed rendered height 120px, `resize: vertical`. | Breaks in the RTL sense: Arabic wraps happily at 1.65 line-height; but with no cap, a pathological paste (a whole wiki page) makes the form act like a document editor. Add a soft cap (e.g. 500 chars) + a visible counter, and *say* whether reason is required (the contract says it's optional unless required by type — the screen never says). |
| 4.11 | **Long Arabic type name.** «تصحيح سجل وقت» and «تصريح خروج أثناء اليوم» render 1-line inside `<option>` (fine), but the inline *chip/summary* copy — if you adopt the receipt line — will collide with the narrow chip. Measured at 390px: form width 358 and the select truncates (324px available). | Plan for it: the mixing of long Arabic names with Latin numerals breaks onto the `bdi`-less inline text without a wrap. Wrap, don't truncate. |
| 4.12 | **RTL / Bidi.** `<input type=date>` renders `dir="ltr"` inside an `rtl` document (measured: `direction:ltr`, `textAlign:start` in `#request-period`). Native `type=date` in Chrome shows a Gregorian `2026/10/14` LTR widget — correct control, but the *live receipt line* ("3 أيام عمل") and the mixed hint with Arabic text and Latin numerals (my probe: `Branch: RBK-142 / ticket https://example.com/t/142 توضيح` in a `dir=rtl`, `unicode-bidi: normal` textarea) **will misorder**: the Latin URL run rides on the wrong side visually with standard `unicode-bidi: normal` in an RTL paragraph. | Break. Wrap user-entered/derived mixed content in `<bdi>` (the list page already does it — `MyRequestsPage.tsx:28` uses `<bdi>{request.title}</bdi>`; the new-request screen's hint line doesn't). For the receipt string, compose with explicit `dir="rtl"` on the container and `unicode-bidi: isolate` on Latin/number runs. |
| 4.13 | **Keyboard-only use.** Measured tab order: `SELECT → #request-period → #request-period-end → textarea → رجوع → حفظ كمسودة → إرسال الطلب`. Logical. **But no `:focus-visible` reached state was measured; the design relies on `--elevation-focus: 0 0 0 4px …ring` which is 46% alpha, and the ERR banner's anchor (href #request-period) is outside the tab order — it's a `<a>` inside a banner with `tabIndex="-1"` on the banner and the anchor's default behavior scrolls;** invisible to keyboard-only flow. Reaching the *banner* requires clicking the anchor with a mouse. | Borderline; fixable by (a) giving the banner an accessible name + live region so SRs announce it, (b) not relying on an anchor. |
| 4.14 | **Mixed Arabic/Latin content.** Discovered in 4.12. Any employee pasting a ticket id, a ticket URL, or just a `#review-42` reference into the reason will hit the bidi collision. | Breaks. |

---

## 5. Accessibility (measured, both themes)

- **Labels:** every control is wrapped in a real `<label>` wrapping its `.field-label`, so click
  and programmatic association work — good. `<select>` has no `id` and no `aria-describedby`
  linking it to the «مسار» hint (measured: `described:false` for select and `#request-period`,
  but `describedCount:1` for the file input). Two of five controls can't see their own hint text
  to a screen reader. **Fix: add `aria-describedby` for select/path, dates/hint line.**
- **Errors:** on invalid submit the screen shows a `role="alert"` banner-error with an anchor,
  and focuses the offending field — nice. But **`aria-invalid` is never set** (measured 0 across
  an invalid submit) and **there is no `aria-describedby` link from the failing field to the
  error message**; error text lives in a banner far from the field, associated only by
  proximity + scroll-into-view anchor. Blind users get the announcement (alert) but no
  field↔message binding. **Fix: when issuing a DraftIssue, set `aria-invalid="true"` +
  `aria-describedby` to the banner's message block on the offending control, and clear both on
  successful re-validate.**
- **Focus order:** logical (measured tab order). The error banner's anchor is
  `tabIndex=-1`-on-banner, and the click-to-focus does `setTimeout(0)` to land on the field
  (verified: after an empty submit, `document.activeElement` = `#request-period`). Solid. The
  «خروج دون حفظ» button (destructive) being first in the unsaved-changes banner's tab order is
  the one ordering inversion (4.7).
- **Target sizes:** all action buttons 44px tall (min per `--control-min-h 44px`). Mobile
  measured 324px-wide buttons — more than enough. No issue.
- **Contrast:**
  - Dark: body `#f4f4f5` on `#1a1a1f` = 14.2:1; muted hint `#a1a1aa` on surface `#232329` =
    6.1:1; hint `#9698a0` on inset `#15151a` = 6.32:1; submit `#172129` on `#f06060` = 5.09:1.
    All pass AA.
  - Light: body `#18181b` on `#fff` = 17.7:1; muted `#606060` on `#fff` = 6.29:1; **hint
    `#6b6b74` on the `#e8e8ea` inset = 4.31:1** (passes AA only for normal text, and only
    barely — the inset background degrades it); submit `#fff` on `#c80000` = 6.08:1.
  - **Borders:** the secondary button border composited over its fill — light `rgba(24,24,27,.34)`
    over `#fff` gives `#b0b0b1`-equivalent, **2.17:1 vs its own fill**; dark
    `rgba(212,212,216,.3)` over `#26262d` = 2.23:1. Non-text contrast for control boundaries
    should be ≥3:1 (WCAG 1.4.11 applies to *meaningful* boundaries — partially, since the
    buttons also carry text, so this is a soft miss, not a blocker).
  - Both themes **pass the hard bars**; the recurring soft misses are `#6b6b74`-on-inset
    (light hints) and control borders.

---

## 6. Recommended direction

The screen deserves a two-column period block, a receipt line as a first-class object, no
verbal plumbing anywhere in the banner, and a type switcher as cards — nothing else.

**Structure to ship (a single column, two visual weights):**

1. **Page opens with the request as it exists, not the form as a stack.** Top: small breadcrumb
   «طلباتي / طلب جديد». H1 «طلب جديد» at 22px, not 32 (the 32px heading is the biggest item on
   the page and the *page* is not what matters here — the request is).
2. **Type as 4 radio-cards** (the 4 long Arabic names properly wrapped inside them), each card
   a `.quiet-inset` with a 16px bold name, the review-path line as its 14px muted footercue
   (المدير / المدير ثم الموارد البشرية). Card > select: no dropdown to hide the long Arabic
   names, no truncation, and choosing a type *is* the first moment of commitment.
3. **The period as a single visual block, using the type's shape:**
   - Annual / sick: one `[date] من` + one `[date] إلى` side-by-side on desktop (the pair
     describes one fact); mobile stacks.
   - Exit permit: one `[date] التاريخ` plus a joined "من HH:MM إلى HH:MM" on one row —
     three stacked full-width rows becomes one.
   - Time correction: one `[date] التاريخ`.
   - Above all, no pre-filled clock values in the exit-permit field (4.5) and no stale dates
     carried across a type change (4.6) — show them empty and let the receipt speak.
4. **A receipt line between the period block and the reason, styled as an accent-soft wash
   (`--accent-soft` / `--accent-border`), not a muted 14px tail.** Content:
   `إجازة اعتيادية · الأحد 11 أكتوبر → الأربعاء 14 أكتوبر · 3 أيام عمل`. This is the manager's
   first read; shift it from the bottom of a hint to its own visual object. When the picked
   span is 0 working days, the receipt line becomes the warning color *live* — the fix for
   4.4 — not after a submit attempt.
5. **Reason as the last block, labeled «السبب (اختياري)» if it's optional for the type,**
   capped (e.g. 500), with a visible character count that stays quiet until near the cap.
6. **Actions row, RTL natural order: «إرسال الطلب» (accent) · «حفظ كمسودة» (secondary) · a
   text-link «إلغاء»** back to the list — not a road-block button at the same visual weight on
   the rightmost spot. Submit button state changes to «جارٍ الإرسال…» then, on success,
   **navigates to the list with the new request's title visible at the top** — the current
   page's role is done. Draft-save keeps the user on the page but **clears `hasUnsaved`** (fix
   for 4.8) and shows a single, short status line ("حُفظت كمسودة — بانتظار مراجعة المدير"), no
   demo-lifecycle narration. Unsaved-changes warning uses a modal (or the banner but with
   «الإلغاء» first in tab order), fix for 4.8's "خروج first" inversion.
7. **Toast/banner protocol:** one message slot, tone-tagged (success = success token, retry =
   danger token + an «أعد المحاولة» button inside it); `aria-live="polite"` for success,
   `role="alert"` for failure with `aria-describedby` binding to the offending field.

**What I would deliberately NOT do:**

1. **Do not introduce a datetime-range picker component that shadows the native `type=date`
   widgets.** The native widgets are correct for RTL, keyboard, and mobile; the fixed contract
   says "from/to date range", and a custom picker is the single greatest risk to good values.
   Keep `<input type=date>` and `<input type=time>`.
2. **Do not add a confirmation dialog before إرسال الطلب.** The fixed contract says one press
   submits with no confirm step. A receipt line (§6.4) makes the confirmation redundant, not
   absent — the user has already read what they're sending, in Arabic, in their own words.
3. **Do not redesign the mute/bold hierarchy into an "AI-assist" or "suggest the period"
   flourish.** This screen is a utility moment, not a showcase; the two-column period block
   and the receipt line are the refinements that pay off. Anything more (inline validation gifs,
   smart duration glyphs, animation on type switch) is the dated vector in a nicer costume.

---

## 7. Findings ranked by impact, each with its concrete fix

| Impact | Finding | Concrete fix |
|---|---|---|
| **Blocker** | After a valid submit the page does not move forward; fields stay filled; the primary button still reads «إرسال الطلب» and pressing it again submits a duplicate from stale state. | On successful submit, navigate to `/requests` (or clear the form + switch the primary label to «طلب جديد آخر»). Verify with a probe: URL changes. |
| **Blocker** | After a successful save, «رجوع» still warns «لديك تعديلات غير محفوظة» — `hasUnsaved` never clears; a saved-draft employee is warned about a lie. | Recompute dirty state against the last-saved snapshot after a successful save/draft. |
| **High** | Annual leave with start-only silently becomes a 1-day request (`endDate = startDate` inside `draftPeriodFields`), never visible to the user. | When the type is FULL_DAYS and `endDate` is empty, the receipt must show "يوم واحد" and the submit button's aria-label should say it; or require an explicit end. |
| **High** | Type switch mid-fill keeps a stale period across the semantic change (a weekend range for annual → switch to تصحيح and back → submit succeeds with 2 weekend days). | Clear the period (or re-run live duration + warnings) on a type change. |
| **High** | Exit-permit times pre-filled 09:00/11:00 — the user can submit a request they never actually picked. | Ship the exit-permit time fields empty; validate both are present before submit. |
| **High** | Live period hint shows the generic instructional copy and stays silent (no count) exactly when the picked span is 0 working days; the working-days warning appears only after submit. | `durationText` should render the "ما فيها يوم عمل" state *live* at pick time, styled as the danger token, not just at validate time. |
| **High** | No `aria-invalid`, no field↔error `aria-describedby` binding; blind users get the alert but no structured link between the offending field and the message. | Set `aria-invalid="true"` on the failing control and point its `aria-describedby` at the banner's message node; clear both when resolved. |
| **High** | The success/error banner text narrates the demo layer («طبقة العرض التجريبية», "will disappear on reload") — voice breaks at the most consequential moment. | Rewrite the banner copy to the state, not the mechanism; move any demo-transiency disclosure to a footer/global note. |
| **Medium** | Bidi: `<input type=date>` renders LTR (correct) but the derived receipt string and any Latin user text in the RTL hint/textarea will misorder (measured `unicode-bidi: normal` in the textarea; the list page already uses `<bdi>`, this screen doesn't). | Wrap every composed receipt string in `<bdi>` or set `unicode-bidi: isolate` on Latin/number runs; keep `dir="rtl"` on the string container. |
| **Medium** | Peer-full-width stacked rows for one composite fact (exit permit date + 2 times each 672px/row; mobile stacks 3 rows) makes the form ~1,400px tall with a 143px dead attachments box. | One row: `[date التاريخ] من [time] إلى [time]`; attachments down to a single muted line. |
| **Medium** | `<select>` truncates long Arabic type names at 324px on mobile (measured). | Type as 4 radio-cards that wrap, not a dropdown. |
| **Medium** | Light theme: hint `#6b6b74` on `#e8e8ea` inset = 4.31:1 (AA-passing but the weakest text on the screen sits in a muted box on the most important info). Control borders under 3:1 in both themes (`#b0b0b1`-equivalent on white; `#26262d`-border-composited). | Raise the light-muted token above `#606060` when composited on `#e8e8ea`; push control borders to ≥3:1. |
| **Medium** | Reason has no maxlength and no character count; a pathological paste turns the form into a document. | Soft cap (e.g. 500) + counter visible near cap + say «اختياري» in the label when it is. |
| **Medium** | «رجوع» (navigation) occupies the same row and weight as submit in the actions row; the destructive «خروج دون حفظ» is first in tab order inside the unsaved-changes banner. | Move «رجوع» to the breadcrumb; in the unsaved-changes banner, «إلغاء» (safe) first. |
| **Low** | H1 at 32px is larger than every other heading in the app's own hierarchy suggests for a utility moment; the page offers one h1 and no subheads. | H1 at 22px (`--font-size-xl`), intro of each section is carried by the fieldset legend itself. |
| **Low** | Select and date inputs have no `aria-describedby` to their (useful) path/duration hints. | Add `aria-describedby` for the select and the period inputs. |
| **Low** | The unsaved-changes banner is inline (not a modal) and sits far above the fold on mobile when the employee is deep in the form. | Use a modal or a sticky-positioned confirm; not an inline banner the user may never scroll to. |

---

## Summary — three first changes, one refusal

1. **Fix the post-submit dead-end and the lying unsaved-changes warning** (blocker pair): on submit
   navigate forward to the list; after any successful save clear `hasUnsaved` against the saved
   snapshot.
2. **Make the receipt a first-class object, not a muted 14px tail**: on type change re-run it
   live, show "يوم واحد" for start-only annual leaves, and show «ما فيها يوم عمل» in the danger
   color the moment a picked span has zero working days — before any submit attempt.
3. **Compress the period into its composite fact** (side-by-side dates, one exit-permit row with
   empty-not-pre-filled times) and put the 4 types as radio-cards so long Arabic names never
   truncate in a `<select>`.

**Refuse:** a custom date-time range picker over the native inputs, and any pre-submit confirmation
dialog — the native widgets are already RTL/keyboard/mobile-correct and the one-press contract plus
a live receipt already carry the confirmation burden.
