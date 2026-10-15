# Brief D — finish the prayer/dhikr lane: one real bug, then the proofs you owe

You are resuming your own work (`Ship prayer-time notifications and hourly adhkar`). Your run was cut by the 150-iteration cap while you were mid-verification, so you never wrote your final report and one `[patch]` against `src/features/prayer/adhkar.ts` failed to apply.

Since then the lead has committed your work as `b3bcf3f`, made `scripts/verify-prayer-times.ts` runnable (it needed the `.ts` extension on its import; it now exits 0), and verified parts of it independently. Two things are already settled, so do not redo them:

- **The prayer math is sound and independently confirmed.** `scripts/verify-prayer-times.ts` passes (exit 0). The golden values you pinned were checked against the live AlAdhan API by the lead and match exactly (Fajr 05:27, Dhuhr 12:42, Asr 16:02, Maghrib 18:30, Isha 19:47, method 5, Africa/Cairo). Your declared ±1-minute tolerances for Dhuhr and Asr are accepted as reasoned, not as errors.
- **The religion gate holds, end to end.** HR set كريم مصطفى (e1) to CHRISTIAN on `/admin/people/e1` via `people-hr-religion` and saved; signing in as «موظف» then showed no prayer block at all. That loop is proven.

## The bug you must fix

**The entire notification system never fires.** Not the prayer notice, not the 5-minute pre-reminder, not the hourly dhikr. The cause is in `src/features/prayer/usePrayerNotices.tsx`:

`prefsRef` (line 93) and `localeRef` (line 94) are declared with `useRef(prefs)` / `useRef(locale)` and then **never assigned again**. The comment above them says "they are written in an effect, never read during render" — but that effect does not exist. So both refs hold their mount-time values for the lifetime of the component, and:

- the provider at lines 168-206 reads `prefsRef.current` (line 169) and finds `prayerTimes: false, hourlyDhikr: false`, so it never builds a candidate and returns `null`;
- even if it did, `onTrigger`'s guards at lines 124-126 read the same frozen value and reject every trigger;
- `localeRef.current` is frozen too, so every notice's text would use the mount-time locale.

Evidence, reproduced by the lead against the served build:

- With the switch state genuinely changed (native checked-setter + `click` + `change` on the checkbox) the preference really did persist — `localStorage["tracking-sys.prayer-preferences.e1"] = {"prayerTimes":false,"preReminder":false,"hourlyDhikr":true}` — and `.notice-stack` stayed empty (`children.length === 0`) for a full 20-second watch.
- `grep -nE '(prefsRef|localeRef)\.current\s*=' src/features/prayer/usePrayerNotices.tsx` returns **no assignment**; the only ref assignment in the file is `prevHourlyDhikrRef.current = prefs.hourlyDhikr` on line 217.

Fix it the way the comment already intends — one effect that keeps both refs current:

```tsx
useEffect(() => {
  prefsRef.current = prefs;
  localeRef.current = locale;
}, [prefs, locale]);
```

Check whether `prefsRef` is read anywhere during render before you add it; if it is, the sync has to happen in a way that does not break that, and say so in your report.

While you are in there, look at the rest of the lane with the same eye and fix anything else that cannot possibly work — but do not refactor what is already proven working (the times table, the gate, the preference persistence).

## Then the proofs you owe

Your DoD was never demonstrated. Prove each with real output, in this order:

1. The **hourly dhikr** notice appears when the switch goes off→on, and disappears after about 14 seconds — measure the actual on-screen lifetime and print it.
2. The **prayer notice** fires. Today's times are all in the past, so drive the boundary directly rather than waiting: `triggerLoop.ts` is injectable (`setTimeoutFn`, `pollMs`) and its functions are pure. A focused script under `scripts/` that drives `nextPrayerTrigger` / `startTriggerLoop` with injected time and prints what fires is worth more than a wall-clock wait. If you cannot make a real notice render through the UI, say exactly what you could and could not show.
3. The **5-minute pre-reminder** fires only when both #1 and its nested switch are on, and is refused when the outer one is off.
4. Re-apply the `adhkar.ts` edit that failed, or state plainly that it is no longer needed.
5. `npm run build:demo` — real exit code.

## How to drive the browser (the lead already burned time on this)

- Serve **your** build and test against it; the demo on `:8000` serves the main checkout, which is not yours to rebuild. Ports: CDP **9500-9599**, static server **8210**.
- **`Input.dispatchMouseEvent` does not drive this page.** The lead's control experiment clicked the `/requests` nav link with real CDP mouse events and the route did not change. Do not build a verification on synthetic mouse input and then conclude the UI is broken — that mistake is already in the record.
- What does work: set a controlled checkbox through the native setter and dispatch `click` + `change`, then assert on `localStorage` and on `.notice-stack`'s children. `.notice-stack` is the prayer feature's own portal (the demo banner is a different element with `role="status"` — the lead's first attempt measured the banner and got a nonsense answer).
- Sign in by clicking `.role-segmented-option` by its Arabic label then `button.login-submit`.

## Report

Files changed, the exact commands, their real output, what you could not verify, and any decision the brief left open. If a fix works but you could not prove it, say that instead of implying proof.
