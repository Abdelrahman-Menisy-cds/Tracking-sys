# Brief B — prayer-time notifications and hourly adhkar (piece 3)

**Read first: a previous run attempted this and refused to ship the prayer math because it failed its own check. That was the right instinct and this brief tells you how to settle it properly. Do not guess at times. Start writing code within your first 15 minutes.**

## Project

- Repo `/home/menisy/Desktop/Me/tracking_system_project`, frontend `frontend/`.
- React + TS + Vite. Arabic-first RTL, English secondary. Dict: `src/i18n/dict.ts` (AR ~300-520, EN ~840-1060). **Both locales for every new string.**
- Tokens only (`--sp-*`, `--surface-*`, `--text-*`, `--border-*`, `--radius-*`, `--font-size-*`) — see `src/styles/global.css`.
- Build: `cd frontend && npm run build:demo`. Must be zero errors.
- Demo served prebuilt at `http://192.168.1.19:8000`; sign in via `.role-segmented-option` + `button.login-submit`.
- **No new npm dependencies.** The only network access allowed is a *test-time* fetch used to record reference values (see below); nothing shipped may call the network.

## What already exists (read it, it is real)

- `src/mock/data.ts`: `ReligionCode = "MUSLIM" | "CHRISTIAN" | "OTHER"`, and `EmployeeHrOnlyFile.religion` / `.religion_other`. Fixtures are seeded: one MUSLIM, one CHRISTIAN, one OTHER-with-detail.
- `src/app/AppContext.tsx`: the directory is exposed with HR overrides applied as `employeeDirectory`. Preference pattern to copy: `APPEARANCE_STORAGE_KEY` / `readStoredAppearance()` / `storePreference()` / `appearance` + `setAppearance` — useState seeded from storage, written on change, wired through the value object **and its dependency array**.
- `src/screens/ProfilePage.tsx` (route `/profile`) is the employee's own page.
- `src/app/AppShell.tsx` is the shell every authenticated screen renders inside.

## What to build

### A · The employee's own opt-in, on `/profile`

The employee's own religion is read from their directory entry (their identity → their `hr_file.religion`). **The whole settings block appears only when that is MUSLIM.** The product owner's words: «لو الموظف مسلم خلي عند الموظف نفسه انه يقدر يشغل 2 اوبشن».

Two switches, plus one nested:

1. **مواعيد الصلاة** — prayer times arrive as a floating notice in a corner: "it is time for <prayer>".
2. **تنبيه قبل الأذان بـ 5 دقائق** — nested: shown only while #1 is on. Says prayer is near — go make wudu and get ready.
3. **أذكار كل ساعة** — one dhikr appears, stays **14 seconds**, then disappears.

Show the computed prayer times on the page too (a small "مواقيت اليوم" list) so the employee can see what will fire. Say plainly, in the UI and in a comment, that notices fire **only while the page is open** — no service worker, no push, no background delivery. Do not imply otherwise.

Preferences persist in **localStorage keyed per employee**, following the `appearance` pattern exactly.

### B · Prayer times: computed, dependency-free, time zone aware

- Location comes from **the browser's time zone**: `Intl.DateTimeFormat().resolvedOptions().timeZone` (e.g. `Africa/Cairo`). Resolve it through a **time-zone → coordinates table** (~40 common zones, must include `Africa/Cairo`, `Asia/Riyadh`, `Asia/Dubai`, `Europe/London`, `America/New_York`, plus a sensible spread). **Fallback: Cairo (30.04 N, 31.24 E).**
- A time zone spans many places, so pick one representative city per zone and **say so in a comment and in the UI** ("computed from the X time zone, approximated to Y"). Do not claim precision the data does not have.
- Compute الفجر، الظهر، العصر، المغرب، العشاء with the **standard solar algorithm**: Julian day → solar declination and equation of time, hour angles for the Fajr/Isha twilight angles and the Asr shadow factor, solar noon for Dhuhr. Use the **Egyptian General Authority of Survey** convention (Fajr 19.5°, Isha 17.5°) and state the convention in a comment. Pure functions, no side effects.

**Settling the math — this is the part that must not be guessed.** The previous attempt wrote it, tested it against its own expectation, found a mismatch, and correctly refused to ship. Do this instead, in this order:

1. Implement it as pure functions returning minutes-from-midnight for a given date/lat/lon.
2. **Cross-check with a second, independent formulation**: compute sunset/sunrise via the simple sunrise equation (hour angle from declination and zenith 90.833°) and check that Maghrib ≈ sunset, Fajr/Isha bracket it symmetrically by the twilight angles, Dhuhr = solar transit, and Isha > Maghrib > Asr > Dhuhr > Fajr. Two different derivations agreeing is real evidence.
3. **Pin golden values from a fixed reference.** Record the intermediates (Julian day, declination, equation of time, hour angles) as a printed table for one fixed date so a reviewer can check them by hand. If — and only if — the network is reachable, fetch a published reference for Cairo on that fixed date **once**, save it as a test fixture with its source URL and fetch date in a comment, and assert against it. Do not call the network at runtime.
4. Report the numbers you got and what you checked them against. **If it still does not line up, say so and stop** — do not ship times that are merely plausible, and do not paper over a mismatch by loosening the test.

### C · A notification surface (new — none exists)

Floating notices: a `createPortal` stack pinned to a corner of the viewport.

- `aria-live="polite"`, dismissible by click / Enter / Escape, auto-dismissing, RTL-aware corner, design tokens, stacking without overlap.
- Keep it small and general — both the prayer strikes and the adhkar use it.
- It must be mounted where every authenticated screen is covered: `src/app/AppShell.tsx`.

### D · The adhkar

- A written list of ~15 authentic short adhkar in `src/mock/` — Arabic text (English optional for the content itself; the surrounding UI needs both locales).
- Fires on the hour, and **once shortly after being enabled** so the employee sees it work immediately.
- Visible for **14 seconds**, then fades out.

Timing must be **testable without waiting an hour** — trigger on a computed next-boundary so it can be driven in a test. Make the interval injectable or expose the trigger, rather than only arming a `setInterval` that nothing can reach.

## Hard constraints

- **Do not edit `src/screens/admin/AdminPeopleDetailPage.tsx`** — a separate job owns that file. Adding keys to `dict.ts` is fine; do not reorder or rewrite its existing keys.
- No new dependencies.
- Keyboard accessible, visible focus, RTL correct.
- `npm run build:demo` clean.
- Commit only the files you own, with a message that says **why**.

## Definition of done — prove it, do not describe it

The reviewer re-runs all of this. Existing CDP harnesses to read for the pattern: `/tmp/h2-name.mjs`, `/tmp/h2-part.mjs`.

1. `npm run build:demo` → report the real exit code.
2. Print the prayer-time computation for one fixed date: the intermediates, the five times, and exactly what you checked them against. Say what matched and what did not.
3. As a **MUSLIM** employee on `/profile`: the block and both switches appear. As the **CHRISTIAN** fixture employee: they do not. Print what you read.
4. Enable prayer times → the floating notice appears with a **real computed time** for the current time zone; dismiss it with the keyboard. Drive the 5-minute pre-reminder path and show its text.
5. Enable adhkar → a dhikr appears and **disappears after 14 seconds** (measure it, print the elapsed).
6. Reload `/profile` → the switches are still on (localStorage), and the notice stack does not double-mount.

Report back: files changed, exact commands run, their real output, and anything you could not verify. If the prayer math does not converge, say so and stop rather than shipping a guess.
