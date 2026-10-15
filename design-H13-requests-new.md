# H13 — «طلب جديد» design proposal (`/requests/new`)

Design document only. Nothing under `frontend/src` is touched, nothing is committed.
Written against the **served** build (measured 2026-10-11 over CDP at `http://192.168.1.19:8080/requests/new`,
headless Chrome 1440×1000 and 375×800) and the reference screenshot `h13-current-requests-new.png`.
All numbers below are measured, not guessed.

---

## 0. Measured baseline (what the page does today)

| Fact | Measurement (dark theme, 1440×1000) |
|---|---|
| Form card | 760×915, `--surface #232329`, radius 12px, padding 24px, elevation-1 |
| Actions | y≈1119 — **118px below the 1000px fold**; submit (primary) is right-most, 126px wide |
| Period legend | `gapTop = 0` against the inset's 16px top padding — the title «المدة» visually collides with the inset's top border |
| Type select | full card width: 710px — same visual weight as everything else |
| Date input | full width: 672px for one date value |
| Reason textarea | `rows=2`, full width |
| Accent usage | **0 elements** in the form use `--accent` in either theme |
| Helper text | both hints `--text-muted #A1A1AA` at 14px — identical color and weight, reads as one gray wall |
| Mobile 375px | no horizontal overflow; actions stack full-width at y≈1148–1304 |
| Native file input | prints English «Choose File / No file chosen» inside an Arabic page; disabled in demo |

---

## 1. Design plan

### 1.1 Core palette (all existing tokens — no new colors)

The product already owns its palette; this page was just not using it. Five roles, reused verbatim:

| Role | Token (dark / light) | Named hex (dark) | Role on this page |
|---|---|---|---|
| Canvas | `--page-bg` | `#1A1A1F` | page ground |
| Work surface | `--surface` | `#232329` | the form card |
| Quiet inset | `--surface-inset` | `#15151A` | period + attachments inner boxes |
| Ink | `--text` | `#F4F4F5` | labels, filled values |
| Muted ink | `--text-subtle` | `#9698A0` | ALL helper/hint lines (one gray, differentiated by layout instead of five grays) |
| Accent | `--accent` | `#F06060` | **exactly three things**: the submit button, the picker's focus border, and the duration read-out numeral |

**The accent's rule on this page:** the accent answers one question — *what is this request about?* It appears on
(a) the submit button, (b) the active picker, and (c) the live duration summary. Nowhere else. Error text leaves the
accent family entirely and uses `--danger` (`#F28A50` dark / `#BF4A0A` light) — these are already different in the token
file, so a validation error can never be confused with the brand color.

### 1.2 New tokens (proposals — three, each with a reason)

| Token | Value | Why it exists |
|---|---|---|
| `--form-max: 720px` | width cap for this form card | today the card is 760px inside `--reading-max 760px`; a hair under the reading width tightens line lengths and leaves the right margin breathing. One place, not per-element widths. |
| `--period-size: 16px` + `--period-numeric: tabular-nums` | label-local var on the period row | date digits must line up (native date inputs shrink text to 12–13px in WebKit; forcing 16px + tabular numerals keeps both scripts' digits stable). |
| `--stick-actions-height: 64px` | reserved strip | the sticky action bar needs reserved space so it never covers the last field (guideline: sticky footers must not cover the focused element). |

Everything else — spacing, radius, elevation, focus ring — is already tokenized and reused as-is.

### 1.3 Type roles

One family per script (already decided in the tokens): `--font-ar` for Arabic, `--font-latin` for Latin, `--line-height-ar` lifted the moment Arabic runs.

| Role | Size | Weight | Notes |
|---|---|---|---|
| H1 «طلب جديد» | 32px (`--font-size-3xl`) | 700 | kept as the page's voice; the form is one narrative, not many sections |
| Field labels («نوع الطلب», «السبب») | 14px (`--font-size-sm`) | 700 | **labels shrink one step** from 16px: labels are directions, not body copy; the 16px/32px collision today flattens the hierarchy |
| Inline period values | 16px | 600, tabular-nums | the picked dates are the request's identity — they get the only body-size numerals |
| Inset legends («المدة», «المرفقات») | 14px | 700, color `--text-muted` | visually a step *below* the plain field labels so the three plain fields read as primary, the two inset boxes as contained |
| Helper lines | 12px (`--font-size-xs`) | 500 | **half a step smaller** than today's 14px; the hint is not a slogan, it is fine print |
| Duration read-out | 16px | 700, accent | the one emphasized interim value |
| Errors | 14px | 700 | `--danger`, inline, adjacent to the failing field |

### 1.4 Layout concept — the two-zone form

Today every field is a full-width row at the same weight. That is the flatness the brief complains about. The concept
replaces "one tall stack" with **two zones inside one card**:

- **The period zone is the page's protagonist.** Everything about this request is arguably *when* — the brief states
  the period is the source of truth and the title is derived from it. So the period gets the only inset with
  a distinct visual weight: a **lighter, card-in-card** row (inset background, no border of its own, radius
  `--radius-sm`), a live duration read-out beside it, and — the payoff — the **derived title preview** rendered live
  from type + period right underneath. That preview is the visual proof of the product's hardest rule ("the title is
  never typed"), which today is invisible to the user.
- **Type, reason and attachments collapse into quiet rows** below, narrower and calmer. Nothing else competes.

Alignment: **RTL start-aligned (right in Arabic), ragged end**. Nothing on this page is centered; buttons align to the
inline start (right in AR), each control hugs its content width instead of filling the card.

### 1.5 Two ASCII wireframe options for the period block

**Option A — calendar row + duration pill inline (chosen)**

```
┌─ المدة ──────────────────────────────── (inset row, bg --surface-inset) ─┐
│  من تاريخ [ 2026/10/11 ]  ←  إلى تاريخ [ 2026/10/14 ]   4 يوم عمل      │
│                                                            (accent 16px) │
│  العنوان الناتج: «إجازة اعتيادية — 4 يوم عمل»      (muted live preview) │
└─────────────────────────────────────────────────────────────────────────┘
```

The picked dates and the duration whisper next to each other in the *same line*; the derived-title preview is the
block's third line, its answer. One inset, no border, generous inner padding (`--sp-3` top + `--sp-4` bottom, breaking
the 0px-gap collision); the period never grows beyond its content width.

**Option B — status card + typed-enforced summary (rejected)**

```
┌────────────────────────────────────────────────────────────┐
│  ⚑  المدة   ←  "4 يوم عمل — 12/10 → 15/10"                 │  ← big pill, first-class
│  تاريخ البداية   تاريخ النهاية (stacked, native)            │
└────────────────────────────────────────────────────────────┘
```

Rejected because: (a) it spends the accent on a banner instead of on the hub+spoke information flow; (b) a large
pill on the cadence box competes with the page's real protagonist (the clock card uses a similar inset already on
the dashboard) and reads as "badge soup" from the anti-generic checklist; (c) it hides the actual inputs behind
a summary, which makes error recovery worse for PART_DAY (where time picks may be *the* fix, not the date).

**Chosen: Option A.** Reason: one source of truth, one frame; the picker remains a picker and the duration is a
read-out next to it, not an anouncement of its own; the derived-title preview answers the product's hardest
requirement without a new concept, only one extra line of copy.

### 1.6 Principles

1. **Period is the protagonist.** The user should understand within one glance "this is a request-to-be-away".
2. **One gray.** Helper text is one `--text-subtle`; hierarchy comes from *placement* (label beside vs. under,
   inset vs. surface) not from a stack of grays or borders.
3. **The accent answers one question** — what the request is about: the submit, the active period, the duration numeral.
4. **Do the communicating, not the deciding.** The preview shows the derived title live; the user does not type it,
   so the page must show what is being derived in the user's place.
5. **Silence is a state.** Empty period, filled period, invalid period, submit-in-flight each look unambiguously different
   with no new elements — border, numeral and accent do the communicating, not a new component.

---

## 2. Section-by-section treatment

### 2.1 Page header

Keep today's anatomy (title + one-line subtitle + «الطلبات» breadcrumb link). Changes:

- Title stays 32px `--text-strong`; subtitle moves from 24px-margin to **inline beyond the title on desktop**
  (a `.page-meta` line, 14px muted, directly under; on mobile the current stack). Today's subtitle string
  «طلب جديد · اختر النوع والمدة من التقويم» joins with the middle dot, which the constraint list names as a tell —
  split into two plain clauses, see §4.
- Add a **live step indicator** in the header's end side (desktop only): «النوع → المدة → السبب» as plain text
  rendered visually as one muted 14px line — no badge, no pill, no all-caps. It disappears on `≈<700px`; the
  place it occupied is not needed. This is structural signpost, not decoration.

### 2.2 Type picker (نوع الطلب)

- Move from a native `<select>` stretched full-width (710px) to the existing `.role-segmented` primitive already in
  global.css (used on login and admin). Four options fit: إجازة اعتيادية · إجازة مرضية · تصريح خروج أثناء اليوم ·
  تصحيح سجل وقت. All four names fit in one row at ≥900px; at 640–899px the group wraps naturally (flex already
  handles this in `.role-segmented`); at <640px the group wraps to 2×2.
- **Why segmented, not a select:** the type structurally changes which sub-fields appear below (dates vs. dates+times
  vs. one date). That is a layout-changing decision; a segmented control puts all four names permanently visible,
  so users see the taxonomy in one glance instead of opening a dropdown to discover it. Four options is exactly
  the upper end the pattern suits.
- Each option carries the review path hint *under its own label* in 12px subtle — «المسار: المدير ثم الموارد البشرية»
  under تصريح خروج and تصحيح سجل وقت, «المسار: المدير» under the other two. This kills the dropdown-helper that
  today repeats a sentence nobody relates to their actual choice until they pick.
- Selection state: `--accent-soft` bg + `--accent-border`, text `--accent-strong`; keyboard reachable (the existing
  `.role-segmented` already ships focus-visible, radios under the hood); `role="radiogroup"` + `aria-label=«نوع الطلب»`.

### 2.3 Period picker (المدة) — the core redesign

Use **one `.quiet-inset`** whose legend is visually-separated from the top border: legend 14px muted, `margin-block: 0 0 var(--sp-3)`,
padding-block `var(--sp-3)` on the inset. Concrete kernel:

- **`FULL_DAYS` (dates):** a single row, `display:flex; flex-wrap:wrap; align-items:center; gap var(--sp-3);`
  containing exactly two native date inputs (`#request-period`, `#request-period-end` — ids must not change) at a
  fixed intrinsic width (170px each in WebKit, so give them `width:170px; background:var(--surface);`), with the
  duration read-out (`t.requestPeriodDays` after interpolation, e.g. «4 يوم عمل») between and after them in 16px bold
  accent tabular-num text — not after a sentence.
- **`PART_DAY` (exit permit):** the date input then two `type=time` inputs (`#request-period-from-clock` etc. — ids
  today `#request-clock` / `#request-clock-end` must map correctly; see §7 implementation order) at `width:96px`
  each, same row, all with `--period-numeric: tabular-nums`.
- **`SINGLE_DATE` (time-correction):** the single date input alone in the row plus a live one-line reminder of
  *why* it is a single date: 12px subtle beside the input — «بيئة التصحيح تقدّ يوماً واحداً فقط» (§4).
- **Filled vs. empty:** before any date is picked the row's fields read as outline with a `--border-control`; once
  a value exists, the *inset* gains a bottom-side `--accent-border` on its inline-start edge (3px, matching the
  existing `.task-status-bar` grammar, not a glow) and the duration line turns accent. Uses no new color and no
  animation — the accent is the "filled" signal, consistent with the timer's `.is-running` accent treatment.
- **Error:** the specific failing input gets `aria-invalid=true` + `--danger` border (today's mechanism) —
  and the failure explanation moves **out of the general banner and inline** under the failing row
  (`t.requestPeriodReversed` / `t.requestPeriodTimesReversed` / `t.requestPeriodNoWorkingDay`). The top-of-page
  error banner stays only for `requestPeriodMissing` because the block itself is reached before any eye movement —
  the summary banner then links into the inset and auto-focuses `#request-period`.
- **Native `mm/dd/yyyy` locale-accident**: fixed by keeping the native input (CDP requires `type=date`) but
  forcing `--period-numeric`, `font-family` matching the document direction, and setting i18n-correct `lang` on
  the value container so screen readers read the same date order as the display. (The picker's *display*
  format stays native — not to be overridden with a fake JS-reversed string; native widgets are the accessible
  baseline and honoring them is what the web guidelines ask.)

### 2.4 Reason (السبب) — the only plain free-text field

- Change `rows=2` → `rows=3` and give the textarea the **first focal contrast bump** of the form: a two-line
  placeholder, in `--text-subtle` (not muted; one gray rule, one gray place):
  `«مثال: زيارة عائلية بتاريخ 15/10…»` — with `…` trailing the guideline's placeholder rule.
- Helper line, inline (not below): 12px subtle, directly under: «السبب اختياري — يليه تنسيق اليوم من الطرف أو مرفق». A
  shorter version of today's line (see §4).
- **Never** swap this into a Mad Libs / card / chip composition. It is a textarea, honest, plain as baked bread.

### 2.5 Attachments (المرفقات) — replacing native «Choose File»

- Replace the native `<input type=file>` (which renders English chrome in an Arabic page) with a **non-active
  `label.file-placeholder`**: one full-width commit-line inside the same inset, styled as a dashed `--border-control`
  1px border, radius `--radius-sm`, height 44px, centered text `«بيئة العرض — الرفع مغلق»` in `--text-muted`;
  a real `<input type=file disabled aria-hidden="true" class="visually-hidden">` stays in the DOM underneath so
  screen readers still hear a real disabled file control (this is why the visual center is a *styled span* and not
  the input itself; the input's own chrome — English labels in AR pages — disappears from view).
- Beside it, the server policy line from the dict (`attachmentsNote`) as 12px subtle. Not a second card, not a badge.
- By Chromium, the `disabled` state read by AT matches what the visuals show (`cursor: default` — not `not-allowed`;
  the existing `btn-holiday-soon` comment sets the precedent that a *demo-disabled* control shouldn't imply an error).

### 2.6 Action row and its hierarchy

Today the actions are the least-discoverable thing on the page: 118px below the fold on a 1000px viewport, and on
mobile they stack 3 rows below the fold too. Fix it structurally:

- **Sticky action strip inside the form card**: `position:sticky; bottom:0`, on `--surface` bg matching the card's
  bottom rounding, `padding-block: var(--sp-3)`, a top divider line (1px `--border-subtle`), and **reserved bottom
  space** (the `--stick-actions-height: 64px` platform) so the last field never hides behind it. On <640px the
  strip stays sticky (bottom-sheet behavior) but switches from row to full-width column — matching the existing
  `.form-actions { width:100% }` mobile rules.
- **Hierarchy inside the strip** (RTL start = right): «رجوع» as `btn-ghost` (today it is a heavy secondary);
  «حفظ كمسودة» as `btn-secondary`; «إرسال الطلب» as `btn-primary` and **first in the reading order** (inline-start),
  visually 180px minimum width so the page's one accent work-bag reads as the landing action, not a chip.
  Today the primary is the *right-most and second-smallest* — inverted emphasis. Switching inline-start placement
  makes «إرسال الطلب» the row's anchor, and «رجوع» the quietest element (what the `sign-out-action` divider rule
  already does for destructive choices — here applied to the *least* destructive).
- **Submitting**: the button keeps its «إرسال الطلب» label — that is the vocabulary rule, the action's name never
  changes — with a `spinner` inline-start and `disabled` until the request round-trips. «حفظ كمسودة» and «رجوع»
  disable alongside (today's behavior kept).
- **Success / notice**: today's success `Banner` appears *above the actions, inside the form*. Keep that location
  (it is where the eyes are after the press) but restyle: 3px `--success` inline-start border, 14px text, one accent
  numeral max. No dialog, no toast — this is where calm lives in this app already.
- **Unsaved-changes guard**: today's «رجوع» produces a warning Banner inside the form with two buttons after it.
  This is participation in flow and stays — the guard is a *banner-in-form*, not a modal, which is also what the
  guidelines' "warn before navigation" means here. The banner takes `role="alert"` (already today) and keeps
  `--warning-soft` bg.

### 2.7 What does NOT change on this page

No gradient washes anywhere; no glass; **one radius** family (`--radius-surface` 12px / `--radius-sm` 8px inside);
no decorative chart; no pill badges on this page (type review-path hints are plain text); no eyebrow headings in
caps above anything; the submit button has no arrow glyph; no meta strings joined by `·` (§4 shows the replacements);
no skeleton shimmer on the form itself (it renders inside a ready page today — the skeleton usage belongs to
a *list*, not to a single form).

---

## 3. States

| State | What the user sees (per field / per row) |
|---|---|
| Default | label, honest placeholder for reason («…مثال: زيارة عائلية…»), empty inputs outlined `--border-control`, inset background `--surface-inset`, action strip with all three buttons enabled (submit keeps its label «إرسال الطلب»); period duration line says nothing yet — no fake «0 يوم» |
| Filled | each picked value prints in `--text` tabular numerals; duration line turns `--accent` (16px bold); inset gains the inline-start 3px `--accent-border`; derived-title preview line appears under the inset once both dates + type can form a title — the preview *is* what `buildRequestTitle` will return, no paraphrase |
| Error | failing input: `aria-invalid=true`, `--danger` border, inline 14px `--danger` message next to it (`t.requestPeriodReversed` etc.). Inline message *replaces* today's grey hint under that field instead of stacking with it; focus auto-moves to the broken field (already in code); report also stays in the top `role="alert"` banner for the missing-period case |
| Busy / submitting | spinner inline-start of «إرسال الطلب» (label unchanged, per the action-name-stability rule); all three actions `disabled`; the strip's divider stays put — no full-card shimmer, no overlay, no button-width jump (the spinner reserves its own 16px box) |
| Success | success Banner (see §2.6) with the exact confirmation sentence the demo layer produced today. Form itself keeps its values (don't auto-clear — today's behavior). «إرسال الطلب» disabled until user navigates away or edits |
| Disabled-in-demo | attachments inset only. Dashed border, centered 14px `--text-muted` «بيئة العرض — الرفع مغلق», real disabled input hidden. `cursor: default`, not `not-allowed`, per the `.btn-holiday-soon` precept. No `--unread`/red styling — a demo limitation is neither an error nor an alarm |
| Keyboard | every control gets the global `:focus-visible` 4px `--focus-ring` (today's rule; both themes verified in the token file); segmented options are radios; the sticky strip never covers the focused element because of `--stick-actions-height` reserved space |
| Reduced motion | no entrance animation is added anywhere — the only motion is the submit spinner and it must (per global rule) collapse to `animation: none` — so a reduced-motion user sees a *static disabled button* with `aria-busy`, which still reads as "busy" from structure alone |

---

## 4. Copy — exact Arabic (and English) strings, with dict keys

Everything lives in `frontend/src/i18n/dict.ts`; nothing inline. `%s` placeholders keep today's `.replace()` convention.

| Dict key (new ⇒ exact) | Arabic | English | Note |
|---|---|---|---|
| `newRequestSubtitle` (change) | «اختر النوع والمدة، ثم أرسل. المدة هي عنوان الطلب.» | Choose a type and a period, then submit. The period becomes the request's title. | Replaces «…·…” joiner |
| `newRequestSteps` (new) | «النوع ← المدة ← السبب» | Type → Period → Reason | header's end-side; the arrow here is *structural*, it's a genuine sequence, not a button decoration |
| `requestTypePathManager` (change wording only) | «المسار: المدير» | Path: manager | shortened |
| `requestTypePathManagerHr` (change wording only) | «المسار: المدير ثم الموارد البشرية» | Path: manager then HR | shortened |
| `requestPeriodSingleOnly` (new) | «تصحيح سجل الوقت يحتاج يوماً واحداً فقط.» | One day only is needed for a time correction. | SINGLE_DATE helper |
| `requestPeriodDurationReady` (new) | «%s يوم عمل» (reuses today's `requestPeriodDays`) | %s working days | placed NEXT to the period, not after a sentence |
| `requestTitlePreview` (new) | «العنوان الناتج: %s» | Resulting title: %s | Interpolates the *actual* buildRequestTitle result; live-under-the-picker |
| `requestReasonPlaceholder` (new) | «مثال: زيارة عائلية يوم 15/10…» | e.g. family visit on 15 Oct… | trailing `…` per guidelines |
| `requestReasonHint` (change) | «اختياري — يُستخدم في قرار المدير، لا في عنوان الطلب.» | Optional — it reaches the manager's decision, not the title. | replaces today's line under period |
| `attachmentsDemo` (new) | «بيئة العرض — الرفع مغلق» | Demo build — upload disabled | the visible line instead of English native chrome |
| attachmentsNote | («unchanged») | («unchanged») | sits beside the demo placeholder |
| `saveDraft` / `submitRequest` | («unchanged») | («unchanged») | buttons never rename on submit; spinner + same words |
| `newRequestDemoBanner` (new, for the demo-banner existing elsewhere) | «البيانات تجريبية — تعديلاتك تختفي بعد تحديث الصفحة.» | Demo data — edits disappear after a page reload. | adds a place to say \"demo\" once, instead of in every helper paragraph |  |

Errors — all keep today's dict wording exactly (`requestPeriodMissing`, `requestPeriodNoWorkingDay`,
`requestPeriodReversed`, `requestPeriodTimesReversed`); only their location and styling change (inline under the
failing field instead of under the whole block).

Removed strings (no longer rendered): the current `requestPeriodHint` sentence
(«المدة تُختار من التقويم، والتفاصيل تبقى سببًا فقط.») — its meaning is now carried by the live duration preview
placement instead of a phrase. Deleting it is safe: the CDP harness does not assert on it.

---

## 5. Anti-generic self-review

What the template default would have produced for this page (and what arrived instead):

- **Template:** a `Card` wrapping a vertically-stacked `Form.Root` with five equal full-width fields, one gray
  helper under each, and a left-aligned primary CTA at the bottom of a 760px card.
  **This proposal:** type gets a segmented control because it *changes the form's sub-layout*, the period is the one
  inset with a live duration and the derived-title preview, and the submit anchors the inline-start of a sticky strip.
  Every helper moves next to the thing it explains.
- **Template:** a green "success toast", a red "error toast" and a centered modal for the unsaved-changes guard.
  **This proposal:** state feedback happens **in the strip** and **in the inset** — success and the leave guard
  are inline banners at the position the eyes are already on, no new chrome, no overlay, no dialog.
- **Template:** a mid-gray helper line like «المدة تُختار من التقويم…» trying to explain that the picker is the source
  of truth (the product's hardest rule, said with words). **This proposal:** *demonstrate* the rule — the derived-title
  preview updates live; the reason's helper instead states its *limited* job (it does not become the title).
  Same information, but from the place it's actually known.
- **Template:** new pill color tokens or a new accent for "the review path". **This proposal:** no new palette.
  Reuses `--accent-soft`/`--accent-border` for selection, `--danger` for validation, `--neutral-soft` only where
  the `btn-holiday-soon` precedent already uses it. Accent count in the form stays ≤3 elements in both themes.
- **Template:** a custom JS-built calendar overlay with month grid and a two-thumb range. **This proposal:** kept the
  native date/time inputs (the served-build CDP harness and the product's own source-of-truth rule are built on them;
  native widgets are the accessible baseline). The *styling* and the *auxiliary* HTML around them are what changed,
  not their nature — the accuracy risk is near zero and the accessibility win is provable.

---

## 6. Implementation order

Build order = dependency order, smallest pieces first, each shippable on its own (this is design-side order, to be
executed by the front-end engineer elsewhere; nothing here is code):

1. **Tokens** (`global.css`): add `--form-max`, `--stick-actions-height`, `--period-numeric: tabular-nums`.
   Light theme check: tokens repeat verbatim, nothing new to mirror.
2. **Dict entries** (`frontend/src/i18n/dict.ts`): add the six new keys and the two wording changes from §4.
   Delete `requestPeriodHint` in the same commit its last usage is removed (keep one PR atomic; don't dead-string).
3. **Field-label scale** (`global.css`, reuse): drop `.field-label` on this page to 14px via a page-local rule
   (`.new-request-page .field-label { font-size: var(--font-size-sm); }`), so other pages keep 16px — page-scoped
   class on the wrapping `.page`, not a global override.
4. **Type picker** (swap select → existing `.role-segmented` markup inside the page — the primitive already has
   RTL, focus-visible and wrap behavior; add a per-option muted 12px `.role-segmented-hint` inside each option's label).
5. **Period block**: restructure as one `.quiet-inset` per §2.3 — row of native date/time inputs at fixed widths,
   live duration read-out, live derived-title preview line. Keep ids (`#request-period`, `#request-period-end`,
   `#request-clock`, `#request-clock-end`) and the `radiogroup` semantics so the existing CDP harness still finds them.
6. **Reason + attachments** (`rows=3`, the `.file-placeholder` replaced input per §2.5).
7. **Action strip** (sticky, `--stick-actions-height` reserved slot, `btn-ghost` «رجوع», `btn-secondary`
   «حفظ كمسودة», `btn-primary` «إرسال الطلب» inline-start — DOM order per RTL reading would place the primary first).
8. **Review pass in both themes** (light is the under-tested one; validate U+0646 U+0627 «…مثال» placeholder wraps on
   375px; check tabular-nums in tokens; scroll-behavior unaffected by the sticky strip; `prefers-reduced-motion`
   pins the spinner).
9. **Extend the CDP harness** (`frontend/scripts/cdp-new-request.mjs`) — proposal, additive:
   - assert the type picker is no longer a native `<select>` (`document.querySelector('.role-segmented')` exists);
   - assert the derived-title preview element exists and its text matches `buildRequestTitle` end-to-end once dates
     are set;
   - assert the action strip is sticky and reachable (`sticky` position, all three labels in reading order);
   - assert the attachments slot renders the visible **Arabic** demo line and its real disabled input is still in
     the tree;
   - keep every existing assertion (dates ids, no title input, one-press submit, no strip, list round-trip)
     byte-for-byte — the harness is the safety net, not the change tracker.

---

## 7. Risks / notes for the implementer

- `--form-max` is deliberately *not* `max-width` on `.field` in general — it caps **this form card**, so other screens
  (login, admin) keep their widths.
- The derived-title preview must read **the same string** the `save()` call builds (`buildRequestTitle(draft,
  locale)`) to keep the promise literal. If the preview and the saved title ever diverge, that breaks the "title is
  never typed" contract more visibly than a wrong border would.
- The sticky strip must not overlap the success banner: the banner's `margin-block-start` inside the form, above the
  strip, stays inside reserved `--stick-actions-height` space; if this is too tight the strip scrolls the banner into
  view — add `scroll-margin-block-end: var(--stick-actions-height)` on the banner.
- `.role-segmented` today ships as an option group with a flex row; 4 Arabic options at ≥900px is *the* required
  layout, and the 639px and 1023px breakpoints need their own wrap rules — this is what the CSS file already
  provides for the other screens using it, so this stays cheap.
- Native date input inside an insets' `quiet-inset` dark bg: WebKit only handles `color-scheme`-aware rendering.
  The token system already sets `color-scheme` per theme at `:root`, so the native picker calendar follows the
  theme it is displayed in — keep the `:root` level declaration untouched and do not re-declare it locally.
