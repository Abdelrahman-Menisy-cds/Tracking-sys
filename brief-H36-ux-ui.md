# H36 — UX/UI enhancement pass on the whole system (using the XIAS kit)

The owner's instruction: use `plugin87/ux-ui-agent-skills` (MIT) to enhance the
UI/UX of the whole system.

## The kit is already cloned here

```
/home/menisy/.hermes/cache/scratch/xias     ← the XIAS repo, MIT, already cloned
```
It is a Claude-plugin-shaped kit: 138 design systems, 52 component specs, DTCG
tokens, and **52 objective gates, 34 of which drive a real browser** (WCAG
contrast in every state, axe roles/landmarks, keyboard, target size, reduced
motion, no horizontal overflow at 280px, token-by-intent, screen economy).

## What to do

1. **Read the kit's own entry points before running anything:**
   `AGENTS.md`, `CONTEXT.md`, `workflows/redesign-audit.md`,
   `workflows/design-qa.md`, `taste/` and `scripts/_targets.mjs` (it decides how
   a gate points at a target app).
2. **Install the kit's dependencies INSIDE the kit directory** (`cd
   /home/menisy/.hermes/cache/scratch/xias && npm install`) so its Playwright
   stays there. **Never add Playwright or any kit dependency to the app's
   `frontend/package.json`** — the shipped app must not grow test-only weight.
3. **Point the gates at the running app: http://localhost:8080** (the built SPA
   is served there; the dev server is already up — do NOT start another one and
   do NOT touch port 8080).
4. **Run the gates and paste their REAL output** (not a description):
   `npm run test:gates`, `npm run verify:overflow`, `npm run test:axe`,
   `npm run a11y:target-size`, `npm run a11y:keyboard`,
   `npm run a11y:reduced-motion`, `npm run lint:intent`, `npm run taste:slop`,
   plus `node scripts/contrast.py` / `scripts/axe_audit.mjs` if the workflow says
   to. If a gate cannot run against a URL, say which and why — do not fake it.
5. **Report the findings as a table**: gate → what it caught → the file/selector
   → severity. Findings with no evidence are not findings.
6. **Then fix them in the app**, in this order: accessibility blockers (contrast,
   labels/roles, keyboard, target size), layout breakage (overflow at 280px,
   reduced motion), token-by-intent (replace hardcoded colours/spacing with the
   app's existing tokens), then the taste/slop items. **Keep the Arabic copy,
   the flow and the visual identity** — this is a quality pass, not a redesign.
7. **Re-run the same gates afterwards and paste the before/after numbers.**

## Hard rules

- `frontend/src/**` only. Do not touch the backend or the API contract.
- `npm run lint` and `npm run build` must pass (there is no `npm run check`).
- Do not commit, stage or stash. Do not touch port 8080 or start a second server.
- A gate that passes broken work is worse than a missing one: if something is
  only "fixed" by weakening the check, that is a fail — say so instead.
