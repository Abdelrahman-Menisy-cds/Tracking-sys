# Brief H11 — the Arabic day-period marker renders in the wrong place (bidi), fix the class

You have **full permissions** (`--yolo`). Work autonomously; commit progressively; do not stop to ask.

## The measured defect (this is objective — the numbers below are real browser output, not an opinion)

The product owner circled `9:30 ص → 4:30 م` on the attendance page and said it needs fixing. It does.
The **logical** strings are correct; the **rendered** order is not. Measured by reading per-character
`getBoundingClientRect().x` in a real browser (leftmost first) on the built demo:

```
/attendance   logical: 9:30 ص → 4:30 م          rendered: 9:30 م 4:30 → ص        ✗
/timesheets   logical: 11/10/2026 · 10:24 ص     rendered: 11/10/2026 · 10:ص24    ✗  (the marker lands INSIDE the time)
/requests     logical: 10/10/2026 · 10:24 ص     rendered: 10/1100/:22042 ص6 ·    ✗  (scrambled)
```

A ready-made acceptance harness is committed at **`frontend/scripts/probe-bidi-render.mjs`**
(`node scripts/probe-bidi-render.mjs http://192.168.1.19:8080`). It walks every date/time/duration leaf
on 8 routes, measures the true pixel order, ignores zero-width/bidi-control characters (so no false
positives), prints only real mismatches and **exits non-zero on any mismatch**. Current result:

```
=== سليم 18 ✓ · مقلوب 10 ✗ ===     (exit 1)
```

**Your acceptance criterion is that probe reporting `مقلوب 0` and exiting 0 across every route it
covers**, in the Arabic locale, on the freshly built demo. Do not weaken the probe or its routes to reach
that; if you extend it, extend coverage.

## The root cause (verify it, then fix the CLASS, not the three pages)

The day-period marker («ص» / «م») and unit letters («س» / «د») are **Arabic (RTL-class) characters placed
directly against Latin digits inside an LTR isolate**. Under the Unicode Bidi Algorithm that letter
resolves to a lower/odd corridor than the digits, so it detaches from its number and is reordered by the
enclosing RTL flow — sometimes landing on the other side of the range arrow, sometimes *inside* the clock
(`10:ص24`). `isolated()` (LRI…PDI) around the whole string is evidently **not sufficient** — that is the
finding; do not just re-wrap it and assume.

It is the same class in `formatDateLong` (each run isolated — verify it actually renders correctly, the
vision read of it looked right but that is not proof), in `formatTime`, `formatDateTime`, the ranges
(`formatTimeRange`, `formatDateTimeRange`, `formatWallClockRange`, `formatDateRange`, `weekInterval`) and
in durations that carry Arabic units (`7س 20د`). **Audit every shape with the probe before and after.**

Approaches worth testing (pick the one the probe proves, and record which):
- isolate the marker **as its own run**, adjacent to an isolated number (the technique `formatDateLong`
  already uses per run) and verify with the probe;
- bind the number and its marker with U+00A0 (no-break space) so they cannot be split;
- put an explicit LRM/embedding boundary between the marker and the following neutrals;
- or make the period marker an element-level concern (the call site renders it in its own
  `dir="ltr"`/`unicode-bidi: isolate` span) if no single-string solution survives the probe.
Whatever you choose must hold for BOTH locales and for every shape, and must not introduce a new
wrapper convention at call sites (H8 removed those; the formatter is where this belongs).

## Also in scope (same class, the owner pointed at this area)

Durations are currently rendered in **two different shapes**: the canonical `formatMinutes`
(«7 ساعة و20 دقيقة») on most pages, and a page-local copy in `AttendancePage.tsx:18` and
`AdminOverviewPage.tsx:321` producing «7س 20د» (the second one even hardcodes «س»/«د» inline instead of
using the dictionary). Unify them through the canonical module — one duration shape in the product — and
make sure that shape passes the probe. If you keep a compact form, it must live in the module with its
units coming from `dict.ts`, not hardcoded.

## Hard constraints

1. **Presentation only.** No timestamp VALUE, time-zone handling, stored string, comparison or key may
   change (`cairoDayIso`, `slice(0,10)` are logic — leave them). The logical strings must stay identical
   to what they are today; only their rendering order may change.
2. **Keep every existing `data-testid` / id** — 11 gates and the lead's measurements depend on them.
3. **All 11 gates must still pass**, unmodified in intent; extend `verify-datetime-format.ts` with
   whatever source-level invariant your fix establishes (e.g. the marker-binding technique) so a
   regression is caught without a browser.
4. No new colors, no new visual language, no new call-site wrapper convention.
5. Stay inside `frontend/` (do not touch `backend/`, `docs/`, `*.pdf`, `.claude/`, `.agents/`, `.hermes/`).

## Acceptance — prove it in a real browser, then in the gates

1. `node scripts/probe-bidi-render.mjs http://192.168.1.19:8080` → **`مقلوب 0`**, exit 0, on the demo
   built from your final commit. Paste the real output.
2. Paste the probe's output for the BEFORE state too (it is reproducible from the current HEAD).
3. Both locales spot-checked; the probe only covers `ar`, so also read the English routes and say what
   you saw.
4. All gates (`for g in scripts/verify-*.ts; do npx tsx "$g"; done`), `npx tsc -b`, `npm run build:demo`.
5. State plainly which shapes still mis-render if any, rather than hiding them.

## Commits

Commit progressively (the formatter fix + gate first, then the duration unification), so a partial run
leaves a coherent tree. Commit only files this brief produces.

## Report

With real output: the before/after rendered strings for all three reported cases; which technique you
adopted and why the probe accepts it; the full probe result; every shape you audited and its verdict; the
duration decision; all gates + tsc + build; anything unfinished, named.

---

## DECISION from the product owner (asked and answered while you work)

For the duration shape in the "Also in scope" section: **unify on the canonical `formatMinutes`** —
«7 ساعة و20 دقيقة» (Arabic) / «7 h 20 min» (English). That is the shape the owner chose; do NOT keep the
compact «7س 20د» form. Delete both page-local `duration` helpers and route their call sites through the
canonical function.
