# H37 — improve the UI/UX for real (gates first, then visual proof)

The owner asked again: «حسن ال ui ux». The previous attempt (H36) shipped real
polish but also **silently broke laid-out UI**, so this run is bound by what
went wrong:

## What went wrong last time (do not repeat)

The pass replaced literal measurements with `var()` references that **do not
resolve**, and nothing caught it — `tsc` and `npm run build` were both clean
while the app was visibly broken in a browser:

- `--space-2: var(--space-2)` — a self-reference, invalid CSS. `--space-2`
  backs `--sp-2`, which every gap in the app uses.
- `inline-size: var(--logo-widget-size)` on the **assistant launcher** — the
  token is defined nowhere; the launcher rendered at logo size over the page.
- The same for `--logo-size`, `--space-16`, `--radius-sm`, `--elevation-1`,
  `--elevation-3` (in BOTH theme blocks — the first fix missed the light one),
  `--stick-actions-height`, `.company-logo-preview`, `.company-widget-logo`.
- One rule was left with an unterminated declaration, which broke
  `npm run build` outright (`Unknown at rule: @keyframes`).

**Hard rules that follow from that:**

1. **Never replace a literal with a `var(--token)` unless you have grepped the
   token's definition in this repo first.** If it is not defined, keep the
   literal and add `/* ds-allow-hardcode: <why> */` — that escape exists for
   exactly this.
2. **Never write a token that references itself**, and never let a token chain
   end in an undefined name.
3. **After every batch of edits: `npm run build`, then open the app in a
   browser and MEASURE what you touched** (`getBoundingClientRect()` on the
   elements you changed, and `getComputedStyle()` for the tokens). A build that
   passes is not evidence that the UI is right.
4. Report findings with the gate name + the file/line. "Looks better" is not a
   finding.

## The work

1. **Run the kit's gates against OUR source**, from
   `/home/menisy/.hermes/cache/scratch/xias` (Playwright is already installed
   there). They take **file or directory paths** — point them at
   `/home/menisy/Desktop/Me/tracking_system_project/frontend/src`:
   `node scripts/lint_intent.mjs <paths>`, `node scripts/slop_tells.mjs <paths>`,
   `node scripts/contrast.py <paths>`, `node scripts/axe_audit.mjs <paths>`,
   `node scripts/verify_overflow.mjs <paths>`,
   `node scripts/verify_target_size.mjs <paths>`, and whichever else the
   workflow files (`workflows/design-qa.md`, `redesign-audit.md`) prescribe.
   Paste the **real output**. If a gate cannot run, say which and why.
2. **Fix in this order**: accessibility blockers (contrast, labels/roles,
   keyboard, target size) → layout/overflow → taste/slop → token by intent
   (only where the token exists — rule 1).
3. **Keep the Arabic copy, the flow, the identity, and the numbers already in
   the tree** (64px launcher, 72px logo previews, 8px/72px shadow offsets, the
   `:root` blocks in both themes). They are correct today and were restored
   deliberately — `87bda4f` explains why.
4. Re-run the same gates afterwards and paste the before/after.

## Bounds

- `frontend/src/**` only. No backend, no API contract, no flow changes.
- The kit's dependencies stay in the kit directory; nothing new in our
  `package.json`.
- `npm run lint` + `npm run build` must pass, and the app must render correctly
  at 1280px **and** 360px wide with the assistant launcher at 64px.
- Do not commit, stage or stash. Do not touch port 8080 (the server is up and
  the owner is using it).
