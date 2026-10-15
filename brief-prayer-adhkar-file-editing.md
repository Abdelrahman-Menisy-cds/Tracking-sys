# Brief — HR-editable employee file + religion field + prayer/adhkar notifications

## The project

- Repo: `/home/menisy/Desktop/Me/tracking_system_project`
- Frontend: `/home/menisy/Desktop/Me/tracking_system_project/frontend`
- React + TypeScript + Vite. **Arabic-first (RTL)**, English secondary.
- Dict (both locales, same file): `frontend/src/i18n/dict.ts` — AR block ~line 300-520, EN block ~line 840-1060. Every new string needs **both**.
- Design tokens only: `--sp-*`, `--surface-*`, `--text-*`, `--border-*`, `--radius-*`, `--font-size-*`. Full list in `frontend/src/styles/global.css`.
- Build + typecheck: `cd frontend && npm run build:demo` (runs `tsc -b && vite build --mode demo`, output `frontend/dist/`).
- The demo is served prebuilt at `http://192.168.1.19:8000` (root `/`). Sign in as **موارد بشرية (HR)** — the login page has `.role-segmented-option` buttons and `button.login-submit`.

## What to build

Three related pieces of work in the employee file. HR is the acting role throughout.

---

### 1 · Make the employee file editable (both panels)

File: `frontend/src/screens/admin/AdminPeopleDetailPage.tsx`

Two panels are currently read-only text inside `<form>` + `<dl>`:

- `SharedFileFacts` (~line 486) — «مشارك مع الموظف والمدير»: name, department, job title, direct manager, email, phone, join date, employment type.
- `HrOnlyFileFacts` (~line 504) — «بيانات الراتب والتعاقد» (HR-only): salary, national id, bank name + IBAN, contracts.

**The ask (verbatim from the product owner): «المفروض انا ك HR اقدر اعدل دول» — everything in both panels becomes editable, including the name and the national id.** No field is exempt.

Requirements:

- Turn the `<dd>` values into proper inputs. Bilingual fields (`name`, `department`, `job_title`, `manager` are `{ar, en}` in the model) need **two inputs each** — an Arabic one and an English one — or a clearly-labelled pair. Do not silently drop a language.
- `direct_manager` should be a **select** over `employeeDirectory` (id → name), not free text. Same for any other field the model already constrains (check `frontend/src/mock/data.ts` for the exact enums before inventing an input).
- `employment_type` is already editable through the segmented control above — do not duplicate it in the facts panel; just keep it consistent.
- Contracts are a list (`EmployeeContractMock[]`). **Editing the existing contract rows (type / start / end) is in scope; adding and removing contracts is out of scope** — say so in a comment rather than half-building it.
- Validation before a write is attempted: email shape, phone shape, national id exactly 14 digits, salary > 0, IBAN non-empty. Show errors with the existing `field-error` class and link them with `aria-describedby`, the way `ScheduleEditorDialog.tsx` does.
- **Persistence:** the directory fixture is read-only. Add an **in-session override map** in `frontend/src/app/AppContext.tsx`, modelled on the existing `leaveAdjustments` map (which already solves "the fixture cannot be written, so keep an overlay keyed by id"). Do **not** use localStorage for this — it is directory data, not a device preference. The override must be read wherever the directory is read, so a renamed employee shows the new name on the attendance tables and everywhere else — **verify that, do not assume it**.
- **This page's contract is "one draft, one save bar; selecting never saves"** (see the comment above `draftType`). The fact edits are draft state; the sticky Save button writes the overlay, Discard reverts. Follow it exactly.

### 2 · A religion field

- Model: add to `EmployeeHrOnlyFile` in `frontend/src/mock/data.ts`: `religion: "MUSLIM" | "CHRISTIAN" | "OTHER"` plus `religion_other?: string`.
- Values are exactly **مسلم / مسيحي / آخر** (AR) and Muslim / Christian / Other (EN).
- **When «آخر» is selected, reveal an empty free-text input** that the user fills in — do not accept «آخر» with nothing written.
- It lives in the HR-only panel with the other HR fields, and it is editable like them.
- Seed the fixture: give at least one employee **MUSLIM** so piece 3 is reachable, and at least one other value so the «آخر» path is reachable.
- The employee must be able to see **their own** religion on their own profile page (piece 3 depends on it), but it stays out of the manager-visible panel.

### 3 · Prayer times + hourly adhkar (employee's own opt-in)

File: `frontend/src/screens/ProfilePage.tsx` (route `/profile`, the employee's own page).

**These settings must only appear for a MUSLIM employee.** The product owner's words: «لو الموظف مسلم خلي عند الموظف نفسه انه يقدر يشغل 2 اوبشن».

Two options, each a switch the employee turns on themselves:

1. **مواعيد الصلاة** — prayer times appear as a **floating notification** in a corner of the page they are on: "it is prayer time". Include a nested sub-option (only shown when prayer times are on): **تنبيه قبل الأذان بـ 5 دقائق**, which says prayer is near — go make wudu and get ready.
2. **أذكار كل ساعة** — a dhikr appears **once an hour**, stays **14 seconds** (the product owner said 10–15s and left the exact number to us; 14 is the middle), then disappears.

Requirements:

- **Prayer times are computed in the browser, with no new dependencies.** Location comes from the **browser's time zone** — `Intl.DateTimeFormat().resolvedOptions().timeZone` gives e.g. `Africa/Cairo` — resolved through a **time-zone → coordinates table** (~40 of the world's common zones, definitely including `Africa/Cairo`, `Asia/Riyadh`, `Asia/Dubai`, `Europe/London`, `America/New_York`). **Fallback: Cairo (30.04 N, 31.24 E).** A time zone maps to many places, so pick one representative city per zone and say so in a comment — do not claim precision the data does not have.
- Compute the five daily times (الفجر، الظهر، العصر، المغرب، العشاء) with the standard solar calculation: declination, equation of time, hour angles for the Fajr/Isha twilight angles, and the Asr shadow factor. ~60-90 lines of pure functions, unit-testable by hand. Display in the browser's local time. Note the calculation convention you use in a comment (e.g. Egyptian General Authority of Survey: Fajr 19.5°, Isha 17.5°).
- **A notification surface does not exist yet in this project — build one.** A `createPortal`-based stack pinned to a corner of the viewport, `aria-live="polite"`, auto-dismissing, dismissible by click/Enter/Escape, RTL-aware, using the design tokens. Keep it small and general: it will be used by both the prayer strikes and the adhkar.
- The adhkar are **hourly**: fire on the hour (and once shortly after enabling, so the employee sees it work). Ship a written list of ~15 authentic short adhkar in `frontend/src/mock/` (mirror, dhikr, salawat, short du'a) with Arabic text; English is optional for the content itself but the surrounding UI strings need both locales.
- **Preferences persist in localStorage, keyed per employee**, following the existing `appearance` pattern in `AppContext.tsx` (`readStoredAppearance` / `storePreference` / `APPEARANCE_STORAGE_KEY`).
- Notifications fire **while the page is open** — no service worker, no push, no backend. This is a demo. Say so plainly in a short note in the UI and in a comment; do not imply background delivery.

## Hard constraints

- **No new dependencies.** No npm packages for prayer times, dates, or notifications.
- Everything user-visible exists in **both** Arabic and English in `dict.ts`.
- Keyboard accessible: switches reachable and operable, notifications dismissible without a mouse, visible focus.
- `npm run build:demo` must pass with **zero** TypeScript errors. `tsc -b` is not optional.
- Do not change unrelated screens. If `AppContext` gains a new exported member, wire it through the interface, the implementation, **and** the `useMemo` value object **and** its dependency array — forgetting the value object is the failure mode here (TypeScript will tell you; heed it).

## Definition of done — prove it, do not describe it

The reviewer (me) will independently re-run all of this, so make it true:

1. `npm run build:demo` — clean, and report the real exit code.
2. Drive a **real browser** (headless Chrome over CDP is fine; there are existing harnesses in `/tmp/h2-*.mjs` you may read for the pattern — they sign in as HR and read the DOM) and show, with real output:
   - `/admin/people/e1` as HR: change the phone, the job title, and something in the HR-only panel, press Save, reload the page, and show the new values survive **and** appear on another screen that reads the directory.
   - Set religion to «آخر» and show the free-text input appears; set it back to «مسلم».
   - `/profile` as a **MUSLIM** employee: the two switches appear; as a non-Muslim employee (or with religion cleared): they do not.
   - With prayer times enabled, the floating notification appears with a real computed time for the current time zone, and the 5-minute pre-reminder path works. Time travel is allowed — make the trigger testable rather than waiting an hour for it.
   - The adhkar appears and disappears after 14 seconds.
3. Commit with a message that explains **why**, not just what. Do not commit anything else that happens to be dirty in the tree.

Report back: what you changed (file by file), the exact commands you ran, their real output, and anything you could not verify. If something is impossible or you disagree with a decision here, say so instead of working around it silently.
