# Brief G — the hourly dhikr must be random per person, not derived from the clock

## The defect (root cause already verified by the lead — do not re-investigate)

The product owner reported: *"why does the same dhikr appear every time I enable it — shouldn't they be random for everyone?"*

Cause, in `frontend/src/features/prayer/triggerLoop.ts`:

```ts
immediateDhikrTrigger:  const hourIndex = Math.floor(nowMs / 3_600_000) % dhikrCount;
nextHourlyDhikrTrigger: const hourIndex = Math.floor(hourStart / 3_600_000) % dhikrCount;
```

The index is `floor(epochMs / 3_600_000) % 17` — the hour since 1970, modulo the list length. Consequences, both confirmed:

1. **It is stable for the whole hour**, so toggling the switch any number of times inside one hour shows the SAME dhikr every time. Measured: at 23:4x the hour index is `497684 % 17 = 9`, and `ADHKAR[9]` is «اللهم عافني في بدني، اللهم عافني في سمعي، اللهم عافني في بصري» — exactly the card in the owner's screenshot. That is a direct hit, not a guess.
2. **There is no per-person input in the formula**, so every employee sees the same dhikr in the same hour.

The existing comment calls this "stable rotation by hour" and "so an enable at 10:xx doesn't always show dhikr #0" — it fixed an earlier symptom by making the choice deterministic. That is the behaviour being replaced.

## Required behaviour

- **Every appearance draws a fresh random dhikr** — the immediate "enable feedback" notice AND the top-of-the-hour notice. Enabling the switch twice in a row must not reliably show the same one.
- **Random per employee**, so two people signed in in the same hour do not get the same card.
- **Never repeat the immediately previous dhikr for that person.** A repeat reads to the owner as "not random", so track the last shown per employee for the session and exclude it from the draw. With 17 entries, draw from the other 16.
- **Keep the hour boundary itself** (the notice still fires at the top of the hour) and keep the «ذكر الساعة» wording — it is still an hourly dhikr, only the pick becomes random.
- **Make the randomness injectable.** `triggerLoop.ts` is pure and injected-time today, and the committed gate `scripts/verify-prayer-triggers.ts` depends on that. Add an optional `random?: () => number` parameter (default `Math.random`) so the gate can pass a deterministic sequence; do NOT call `Math.random()` in a way that makes the existing gate flaky.

## What to prove (extend the committed gate, exit non-zero on failure)

`npx tsx scripts/verify-prayer-triggers.ts` must still pass, plus new assertions:

1. With an injected RNG returning a fixed sequence, the chosen index follows that sequence — i.e. the draw actually consults the injected randomness.
2. Two consecutive draws for the same person never return the same index (run it over many iterations with a real RNG; a repeat is a failure).
3. The index is always inside `[0, dhikrCount)` for a range of counts, including `dhikrCount = 1` (must not divide by zero or go out of range) and `0` (must return null).
4. The immediate trigger and the hourly trigger both randomise — not just one of them.
5. The hour boundary is still the top of the next hour (keep the existing assertion passing).

Then re-measure in the browser, against `http://192.168.1.19:8000`:
- Enable the switch, record the card text; disable, enable again, record it again; repeat a few times and print every card text. They must not all be identical, and no two in a row may match.
- Note: `Input.dispatchMouseEvent` does NOT drive this app (the lead's control experiment proved it), so drive the switch the way the existing harness does — native setter plus `click` + `change`, asserted in a separate evaluation. `.notice-stack` is the notice container; the demo banner is a different element that also carries `role="status"`, so do not match on that.

## Constraints

- **No new npm dependency** (`package.json` must stay untouched).
- `tsc -b` clean and `npm run build:demo` exit 0.
- Preferences stay in `localStorage`; anything per-session (the last-shown dhikr) must NOT become a durable preference — keep it in the session or a ref.
- Run with `--max-turns 400`. Commit your work and report the hash.

## Report

Root cause (one line), the changed files, the exact commands and their real output, the measured card texts from the browser run, and anything you could not verify.
