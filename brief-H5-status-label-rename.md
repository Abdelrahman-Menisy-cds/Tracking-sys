# Brief H5 — rename the task's first status label («مفتوحة» → «جديدة»)

Small, surgical change. Read `frontend/src/i18n/dict.ts` around the keys named below before editing.

## The ask

The user, looking at the task status bar:

> «بلاش كلمه مفتوحه دي»

Asked what to use instead, they chose **«جديدة»**. The English counterpart changes too: **"Open" → "New"**.

## Exactly what to change

`frontend/src/i18n/dict.ts`:

- line ~595, the `ar` block: `stOpen: "مفتوحة"` → `stOpen: "جديدة"`
- line ~1270, the `en` block: `stOpen: "Open"` → `stOpen: "New"`

That is the whole edit to the dictionary. `stOpen` lives in the **tasks** section of the dict
(marked `/* ===== Brief C — the tasks cycle … */`), so this correctly renames the label on every
**task** surface at once: the status bar (`TaskStatusBar`), the status pill in the task list
(`TaskPills.taskStatusKey`), the status filter dropdown (`TasksPage`), and the create-task dialog.

**Do this deliberately.** One status must have one name: if the bar said «جديدة» while the list
pill still said «مفتوحة», the same status would have two names. The lead has decided the task-wide
scope for that reason — do not introduce a second key to narrow it back to the bar.

## Do NOT touch (these are traps — verify them)

1. **`prayerSettingsScopeLine`** (~line 578, `ar`) contains «مفتوحة» inside an unrelated sentence:
   «هذه التنبيهات تعمل فقط بينما هذه الصفحة مفتوحة …». **Leave it exactly as is.** A blind
   find-and-replace over the word would corrupt it.
2. **`attendanceStatusOpen`** (`en`, ~line 778) and any attendance status label — a different
   domain. Check that `AttendancePage`'s `statusLabel` does not render `stOpen`; if it does, stop
   and report it rather than silently changing attendance wording.
3. **Status identifiers stay as they are**: the value `"OPEN"` / `open` in the mock data, the type
   `TaskStatus`, and every `data-testid` (`task-status-open`, `task-status-control`, …). Only the
   human-readable label changes.
4. Do not touch `src/components/record/Timeline.tsx`'s `statusLabels` map unless it actually renders
   this status — check first; if it does, say so in your report.

## Acceptance

Extend or add a `frontend/scripts/verify-*.ts` gate that fails loudly if this regresses:

1. The `ar` dict's `stOpen` is exactly `"جديدة"` and the `en` dict's `stOpen` is exactly `"New"`.
2. The unrelated sentence still contains «مفتوحة» (assert it, so a future blanket replace cannot
   silently corrupt it) — and it is still inside `prayerSettingsScopeLine`, not a status label.
3. No task surface renders a hardcoded «مفتوحة» / `"Open"` for this status — it must come from
   `stOpen`.
4. All existing testids are unchanged.

Then run and paste real output:
- your gate
- **every** existing gate: `for g in scripts/verify-*.ts; do npx tsx "$g"; done` — all must still pass
- `npx tsc -b`
- `npm run build:demo`

## Constraints

- Stay inside `frontend/`. Nothing else.
- Commit only what this brief produces, with a clear message.

## Report

Real command output: the two dict lines before/after, the gate results, `tsc`, the build, and
explicit confirmation that the unrelated «مفتوحة» sentence and the attendance labels are untouched.
