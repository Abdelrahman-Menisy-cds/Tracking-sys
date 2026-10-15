# Brief H3 — one correct date/time rendering everywhere, and the task log last on the page

Two user-reported defects, both in `frontend/`. Read `AGENTS.md` and the surrounding code first.

## Defect 1 — dates and times render scrambled in the RTL UI, on every page

The user's words: «ظبط طريقه عرض الوقت والتاريخ لانه مش مظبوط ف كل الصفحات».

Measured on the live demo (screenshot of `/tasks/t-6001`), reading the **glyphs strictly
left-to-right as they appear**:

| field | what the user sees | what it must read |
|---|---|---|
| due date | `142026/10/` | `14/10/2026` |
| creation date | `3+ 09:00 2026` | `9/10/2026 · 09:00 ص` |
| trail event | `11 3+ 09:18 2026` | `11/10/2026 · 09:18 ص` |

`غرينتش+3` renders as `3+`, the year jumps to the wrong end, and the day number floats.

### Root cause — per-site formatting, not one shared path

- `src/app/useMockList.ts` already exports `formatDate` / `formatDateTime` and a `localeTag`
  helper that pins **Latin digits** (`ar-EG-u-nu-latn`). That is the correct primitive.
- `src/components/tasks/TaskDetailBody.tsx:50` **bypasses it**: it calls
  `new Intl.DateTimeFormat(locale, { dateStyle: "medium" })` with the **raw** locale, so it gets
  Arabic-Indic digits, Arabic field order and bidi marks.
- `useMockList.ts:68` `formatDateTime` passes `timeZoneName: "short"`, which emits the Arabic
  short zone name `غرينتش+3` — a token that reorders inside RTL text and reads as `3+`.
- Screens carry their **own** copies instead of using the shared helpers (at least:
  `NotificationsPage`, `MyTimesheetsPage`, `ProfilePage`, `AttendancePage`, `TasksPage`,
  `MyRequestsPage`, and `admin/ScheduleEditorDialog`, `admin/AdminSettingsPage`,
  `admin/AdminPeopleDetailPage`, `admin/AdminPeoplePage`, `admin/AdminOverviewPage`,
  `admin/AdminAnnouncementsPage`). This is why the bug is everywhere.

### Required outcome

1. **One shared formatting path.** Every date and time in the app goes through helpers in
   `src/app/useMockList.ts` (extend it — do not create a second module). No screen may build its
   own `Intl.DateTimeFormat` / `toLocale*` for user-facing text.
2. **Latin digits always**, via `localeTag` (`ar-EG-u-nu-latn` for `ar`, `en-GB` for `en`).
   No Arabic-Indic digits anywhere.
3. **A stable, readable shape in both locales**, with zero-padding:
   - date → `DD/MM/YYYY` (e.g. `14/10/2026`)
   - date+time → `DD/MM/YYYY · h:mm ص` / `DD/MM/YYYY · h:mm AM` (e.g. `11/10/2026 · 09:18 ص`)
   - time only → `h:mm ص` / `h:mm AM`
   - Drop `timeZoneName` entirely — the zone is stated once on the page, not per row.
4. **Return bidi-safe strings.** Wrap the formatted value in Unicode isolates
   (`\u2066` … `\u2069`, LRI/PDI) so the value renders in the same correct order whether it lands
   in a plain text node, inside `<bdi>`, or inside an RTL paragraph. Do **not** rely on per-number
   right-to-left marks (`\u200F`) — that pattern is what is broken now. Keep any existing
   `<bdi dir="ltr">` wrappers; they are harmless once the string is isolated.
5. Applies to **every** date/time surface: task detail, trail, tasks list, timesheets, attendance,
   notifications, requests, profile, and all admin screens.

## Defect 2 — the task log must be the LAST section on the task page

The user's words: «وخلي سجل المهمه اخر حاجه في الصفحه».

Today `TaskDetailPage` renders `TaskDetailBody` (facts → **trail**) and then `TaskWorkPanel`
(work time). Move the trail («سجل المهمة» + `<TaskTimeline>`, `src/components/tasks/TaskDetailBody.tsx`
lines ~60-63) so it is the **final** section on the page, after the work-time panel. The status
control keeps its current place; only the trail moves to the end. Keep the `id="task-trail"`
anchor and the `taskTrailHeading` string.

## Acceptance — a deterministic gate you must write and run

Add `frontend/scripts/verify-datetime-format.ts` (same style as the existing
`scripts/verify-*.ts` gates) and make it fail loudly:

1. `formatDate("2026-10-14T12:00:00Z", "ar")` → matches `^14/10/2026$`, and
   `formatDate(..., "en")` → the same digits/order.
2. `formatDateTime("2026-10-11T06:18:00Z", "ar")` → matches `^11/10/2026 · 09:18 ص$`; the `en`
   variant → `^11/10/2026 · 09:18 AM$`.
3. The output contains **no** Arabic-Indic digit (`\u0660-\u0669`), **no** `\u200F`/`\u200E`, and
   **no** `غرينتش` / `GMT`.
4. Every formatted value starts with `\u2066` and ends with `\u2069`.
5. A **source scan**: no file under `src/` outside `src/app/useMockList.ts` calls
   `Intl.DateTimeFormat`, `toLocaleDateString`, `toLocaleTimeString` or `toLocaleString` for
   user-facing text. Report every offending file. This is the check that makes the fix hold across
   pages — do not weaken it to pass.
6. The page order: assert (statically, from the source) that the trail section is rendered after
   the work panel in the task page tree.

Then run, and paste the real output:
- `npx tsc -b` (or the project's typecheck script)
- your gate script
- `npm run build:demo`
- any existing gates you can run (`scripts/verify-*.ts`) so nothing regressed

## Constraints

- Stay inside `frontend/`. Do not touch `backend/`, the demo fixtures' meaning, or any file the
  user added (images, `*.pdf`, `docs/`, `.claude/`, `.agents/`).
- Do not weaken or delete an existing gate to make yours pass.
- Keep the change minimal and in the existing style; no drive-by refactors.
- Commit only the files this brief produces, with a clear message. If you cannot finish, commit the
  verified part and state plainly what is left.

## Report

State, with the real command output: what you changed, the gate results, `tsc`, the build, and any
place you deliberately did **not** change and why. If a screen's date could not be routed through
the shared helper, name it and say why rather than leaving it silently broken.
