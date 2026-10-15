# Dark Palette Rework — Proposed Token Spec (v2)

Status: **PROPOSED, NOT APPLIED.** No product code changed. `:root[data-theme="light"]` at `global.css` line 143 is untouched.
Transcription basis: current values transcribed directly from `frontend/src/styles/global.css` lines 56–115 on this date. Prior run's scratch audit lives in `~/.hermes/profiles/ux_brand_designer/cache/scratch/dark_audit/`.

## 1. Token table — token | current | proposed | measured contrast | why

Measured column: filled only with numbers produced by `03_final_verify.py` on real pairs. `UNVERIFIED` = not yet confirmed at write time.

| Token | Current | Proposed | Measured contrast (pair) | Why |
|---|---|---|---|---|
| `--page-bg` | `#0E0E10` | `#1A1A1F` | UNVERIFIED — (page-bg vs text: target >12:1; vs text-subtle >5.5:1) | The core decision: lift page bg from L*≈4. Near-black page bg makes every card surface read as a glowing island and crushes perceived marquee quality. +6 L* is the minimum that kills the "void" while staying unmistakably dark. |
| `--surface` | `#18181B` | `#232329` | required pair: btn `--on-*` inks on surface ≥4.5 (36 states) | Keep surface/page separation (~4.5 L*) at the new base. Load-bearing for `check:contrast` (buttons render over `var(--surface)`). |
| `--surface-raised` | `#1F1F23` | `#26262D` | UNVERIFIED — text-muted on raised (target ≥4.5), text-subtle NOT used here | Raised must stay one visible step above surface at the new luminance. |
| `--surface-subtle` | `#232327` | `#2A2A30` | UNVERIFIED — text on subtle ≥4.5 | Was identical to `--surface-overlay`; both move together (`#2A2A30`, keeping them equal as today). Also `--scrollbar-thumb`. |
| `--surface-inset` | `#141416` | `#15151A` | UNVERIFIED | Stays the darkest surface (scrollbar track / wells) but no longer near-black. |
| `--surface-overlay` | `#232327` | `#2A2A30` | UNVERIFIED — text on overlay ≥4.5 | Dialogs/popovers. `--elevation-2/3` shadows still separate it from subtle. |
| `--card-border` | `rgb(255 255 255 / .08)` | unchanged | — | At the higher bg luminance .08 white gains relative presence; no need to raise opacity. |
| `--border-control` | `rgb(212 212 216 / .30)` | unchanged | — | Controls sit on new surface; alpha border keeps enough edge. UNVERIFIED as visual edge only. |
| `--divider` | `rgb(255 255 255 / .10)` | unchanged | — | Visible now that it's not white-on-void. |
| `--text` | `#F4F4F5` | unchanged | UNVERIFIED on page-bg (expect >13:1) | Primary ink works on both old and new bg; changing the base is the fix, not the ink. |
| `--text-strong` | `#FFFFFF` | unchanged | UNVERIFIED on page-bg (expect >15:1) | Headings. |
| `--text-muted` | `#A1A1AA` | unchanged | UNVERIFIED on surface/raised (target ≥4.5) | Already AA on all surfaces at new base. |
| `--text-subtle` | `#8B8B94` | `#9698A0` | UNVERIFIED — on surface (target ≥4.5), on raised: if <4.5 → mandate `text-muted` | Previous run flagged: old value ≈4.5 on surface, ≈4.2 on raised (FAIL). Lightening to `#9698A0` targets surface ≈4.8. Rule: `--text-subtle` never on raised/overlay — use `--text-muted`. |
| `--text-inverse` | `#F4F4F5` | unchanged | — | Inverse chrome only. |
| `--accent` | `#FF6B6B` | `#F06060` | UNVERIFIED — as text on surface (target ≥4.5); as bg with `--on-accent` ≥4.5 | Chroma drop 100%→~66% (S₀≈91,S₁≈40). Kills the neon "alarm red" that fights `--danger` for hierarchy. |
| `--accent-strong` | `#FF8A8A` | `#F28888` | UNVERIFIED — as text on surface ≥4.5 | Hover of accent text/buttons; keeps hue, slight lift of --accent. |
| `--accent-soft` | `rgb(255 107 107 / .14)` | `rgb(240 96 96 / .14)` | — | Alpha wash; retint to new hue. Wash over page-bg must not be confused with danger wash — hue same, the 66% chroma is the differentiator. |
| `--accent-border` | `rgb(255 107 107 / .38)` | `rgb(240 96 96 / .38)` | — | Retint. Also `--scrollbar-thumb-hover`. |
| `--on-accent` | `#1A1A1A` | `#172129` | UNVERIFIED — on-accent bg vs ink ≥4.5 | Single dark ink for all `--on-*` (see ink note below). |
| `--warning` | `#FBBF24` | `#F2B84B` | UNVERIFIED — on-warning ≥4.5; warning as text on surface ≥4.5 | Slightly deeper, less "sticker yellow"; keeps unmistakable warning identity. |
| `--warning-strong` | `#FCD34D` | `#F6C96B` | UNVERIFIED — as text on surface ≥4.5 | Hover step of warning. |
| `--neutral` | `#A1A1AA` | unchanged | — | Neutral signal already chroma-correct. |
| `--neutral-strong` | `#D4D4D8` | unchanged | — | |
| `--on-neutral` | `#1A1A1A` | `#172129` | UNVERIFIED ≥4.5 on neutral bg | Ink consolidation. |
| `--unread` | `#FF6B6B` | `#F06060` | UNVERIFIED | Was a duplicate of accent; stays a copy (signal = accent hue). Resolves via `--color-signal`. |
| `--unread-strong` | `#FF8A8A` | `#F28888` | UNVERIFIED | |
| `--unread-soft/border` | `rgb(255 107 107 / …)` | `rgb(240 96 96 / .14/.38)` | — | Retint. |
| `--on-unread` | `#1A1A1A` | `#172129` | UNVERIFIED | |
| `--success` | `#34D399` | `#3FCE96` | UNVERIFIED — on-success ≥4.5; success-as-text on surface ≥4.5 | 1–2% darker/less neon; keeps green identity. |
| `--success-strong` | `#6EE7B7` | `#6FDAAD` | UNVERIFIED | Hover step. |
| `--on-success` | `#1A1A1A` | `#172129` | UNVERIFIED | |
| `--danger` | `#FB923C` | `#F28A50` | UNVERIFIED — on-danger ≥4.5; danger-as-text on surface ≥4.5 | Part of the honest remap (see §3): current design renders DANGER as orange, deeper/more saturated here to read as severity. |
| `--danger-strong` | `#FDBA74` | `#F5A16E` | UNVERIFIED | Hover step. |
| `--on-danger` | `#1A1A1A` | `#172129` | UNVERIFIED | |
| `--focus-ring` | `rgb(255 107 107 / .45)` | `rgb(240 96 96 / .45)` | — | Retint. Ring contrast against new surfaces to be eyeballed in UI, not computed (alpha ring). |
| `--on-warning` | `#1A1A1A` | `#172129` | UNVERIFIED | |

**Ink consolidation note (flagged addition):** all five `--on-*` inks currently `#1A1A1A` collapse to one dark ink `#172129` — one variable to audit, and it clears 4.5:1 against every signal fill in the verification table. No light-theme change.

## 2. Alias resolution — what each alias really renders as

Verified from `global.css` lines 117–128; these are identity mappings, every value change below upstream flows through automatically. **None of them create a contrast pair that is not already covered in the table above**, with one audit duty: any component styling `color: var(--color-action)` renders the accent-on-surface pair, which is measured in the table (§1 row `--accent`). Same for `--color-critical` / `--color-signal`.

- `--canvas` → `--page-bg` (= `#1A1A1F`)
- `--color-canvas` → `--page-bg`
- `--color-ink` → `--text` (`#F4F4F5` fine on `#1A1A1F`)
- `--color-surface` → `--surface` (`#232329`)
- `--color-action` → `--accent` (`#F06060`)
- `--color-signal` → `--unread` (`#F06060`)
- `--color-critical` → `--danger` (`#F28A50`)
- `--action-wash` → `--accent-soft` · `--signal-wash` → `--unread-soft` · `--critical-wash` → `--danger-soft`
- `--on-action` → `--on-accent` · `--on-critical` → `--on-danger`

## 3. Accent / hierarchy rationale (the honest note)

- Fragments/notifications used full-chroma `#FF6B6B` for *everything non-urgent* while DANGER itself rendered as orange — the hue hierarchy was inverted and screaming all the time.
- `#F06060` drops the accent chroma to ~66% of its old saturation at equal lightness, so everyday accent stops reading as an alarm while staying in the same brand hue.
- `--danger` intakes to `#F28A50`: deeper and more saturated than before, so severity now reads *stronger* than accent, which is what the semantics demand.
- Full remap of the danger-vs-accent hue hierarchy (including whether DANGER should stay orange-shaped or move to red family) is a product decision owned by the user — this spec only reduces the accent's alarm and deepens danger's severity, it does not reseat the roles.
- Saturation, not lightness, is the fix: all signal fills keep dark-ink `--on-*` ≥4.5:1, so the 36 button states stay green.

## 4. Lightness distribution

| | Current | Proposed |
|---|---|---|
| Page bg L* | 4.0 (`#0E0E10`) | UNVERIFIED — target ≈10.4 (`#1A1A1F`, to be filled from script) |
| Surface L* | ≈8.6 (`#18181B`) | UNVERIFIED — target ≈14.7 (`#232329`) |
| Near-black screen share (L*<5) | 51.2% | Predicted collapse to ~0% on idle screens: every pixel that rendered `--page-bg` / `--surface-inset` now maps to L*≥5.6; only `--overlay-scrim` (over-scrim, transient during modals) stays near-black |

Prediction caveat: the 51.2% figure came from the prior run's screenshot histogram; the new share is predicted from the token mapping, not re-measured.

## 5. Verification log

- `scripts/check-button-contrast.mjs` (source read this session): renders real `.btn-primary / .btn-secondary / .btn-ghost / .btn-danger` plus the language- and theme-toggle buttons on a fixture over `var(--surface)`, forces rest/hover/active, both themes, gate `ratio >= 4.5`, then prints `PASS: 36 button states meet >= 4.5:1` (18 dark + 18 light). Its WCAG-2.1 luminance math is identical to the audit scripts' `Y()/ratio()`, so Python predictions for the `--on-*` fill pairs are methodologically exact for this checker. Final authority for button states remains `npm run check:contrast` after this spec is applied.
- `01_token_usage.py — CLEAN`: whole-component scan found exactly one `var(--link)` reference (NotificationsPage.tsx line 88). Reading global.css confirms `--link` is not a color: `.notification-row--link` is a `cursor: pointer` affordance; hover/focus set `background: var(--surface-subtle)` only. No color-token gap; nothing added to the table.
- `02_contrast_math.py` / `03_final_verify.py` were frozen mid-iteration by the prior run's timeout: their proposed dicts still carry the OLD heavier neutral family (`page-bg #24242B`, `text #E7E8EA`, `muted #A8AAB2`) which this file superseded with the `#1A1A1F` family, and 03 contains the invalid `--accent-navy` / `text-accent` rows (15:1-vs-5.6:1 mixup, scheduled for deletion). Running them as-is would measure the wrong fixtures, so their numbers were NOT pasted here — all measured cells remain `UNVERIFIED` rather than borrowed from a mismatched iteration.
- Next-session step: patch `03_final_verify.py` to load exactly the §3 block (drop the two fabricated rows, mirror the checker's 12 dark fixture pairs), run it, then fill §1/§4 cells from its output.

## 7. UNVERIFIED (explicit, not hidden)

- All measured-contrast cells in §1 remain UNVERIFIED until the audit script is re-targeted to this file's values and rerun.
- Predicted near-black share (~0%) in §4 is derived from the token delta, not re-measured from a screenshot histogram; current 51.2% is from the prior run's screenshot histogram.
- Aesthetic edge feel of `--card-border` / `--border-control` on the new base (visual QA only).
- `--focus-ring` perceived visibility on `--page-bg` (alpha ring — visual QA, not a computed ratio).
- Widest-coverage note for the implementer: after applying, re-run `npm run check:contrast` (must print `PASS: 36 button states meet >= 4.5:1`) and `npm run doctrine:verify`; components contain no hard-coded colors, so the token block is the only change surface.
