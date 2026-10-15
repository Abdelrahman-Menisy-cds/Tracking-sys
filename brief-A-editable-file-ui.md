# Brief A — wire the editable employee file UI (pieces 1 and 2)

**Read this first: the plumbing is already built and committed. Your job is the UI only. Start writing code within your first 15 minutes — do not spend the budget re-deriving what is written below.**

## Project

- Repo `/home/menisy/Desktop/Me/tracking_system_project`, frontend `frontend/`.
- React + TS + Vite. Arabic-first RTL, English secondary. Dict: `src/i18n/dict.ts` (AR ~300-520, EN ~840-1060). **Both locales for every new string.**
- Tokens only (`--sp-*`, `--surface-*`, `--text-*`, `--border-*`, `--radius-*`, `--font-size-*`).
- Build: `cd frontend && npm run build:demo` (tsc -b + vite). Must be zero errors.
- Demo served prebuilt at `http://192.168.1.19:8000`; sign in as **موارد بشرية** (HR) via `.role-segmented-option` + `button.login-submit`.

## What already exists (commit e66bd88 — read the code, it is real)

In `src/mock/data.ts`:

```ts
export type ReligionCode = "MUSLIM" | "CHRISTIAN" | "OTHER";

export interface EmployeeHrOnlyFile {
  salary: { amount: number; currency: "EGP"; payroll_cycle: "MONTHLY" };
  national_id: string;
  bank_account: { bank_name: { ar: string; en: string }; iban: string };
  contracts: EmployeeContractMock[];
  religion: ReligionCode;
  religion_other?: string;   // non-empty exactly when religion is OTHER
}

export interface EmployeeFilePatch
  extends Pick<EmployeeDirectoryEntry, "name" | "department" | "job_title" | "direct_manager" | "email" | "phone" | "join_date"> {
  hr_file?: EmployeeHrOnlyFile;
}

export function mergeEmployeeFilePatch(entry, patch) // replaces provided fields; `hr_file` replaces the WHOLE slice
```

In `src/app/AppContext.tsx`:

```ts
saveEmployeeFile: (employeeId: string, patch: EmployeeFilePatch) => AttendanceMutationResult<EmployeeDirectoryEntry>
```

- Gated on `capabilities.canManageDirectory`; returns `{ ok: false, code: "CAPABILITY_DENIED" | "MISSING_RECORD" }`.
- Persists an overlay keyed by employee id, mirrored to sessionStorage (`tracking-sys.file-overrides`).
- **`employeeDirectoryWithOverrides` is already exposed as `employeeDirectory` in the context value**, so anything reading the directory sees a save immediately — including the attendance tables. You do not need to wire propagation; it is done. Verify it anyway.
- Because `hr_file` replaces the whole slice, **build the complete `EmployeeHrOnlyFile` from your draft** — a partial object will silently blank fields.

## Piece 1 — the two panels become editable

`src/screens/admin/AdminPeopleDetailPage.tsx`: `SharedFileFacts` (~486) and `HrOnlyFileFacts` (~504) render `<dd>` text inside a `<form>`+`<dl>`. Everything in both panels becomes editable for HR — the product owner was explicit: **including the name and the national id.**

- Bilingual fields (`name`, `department`, `job_title`) are `{ar, en}` → **two labelled inputs each**. Never drop a language.
- `direct_manager` → a **select** over `employeeDirectory` (id → `name[locale]`, with a null/"—" option), not free text.
- `join_date` → `type="date"`. `salary.amount` → number. `bank_account.bank_name` is `{ar, en}` → two inputs. `contracts` → edit the existing rows' type/start/end; **adding/removing contracts is out of scope** (comment it, do not half-build it).
- `employment_type` is already editable in the segmented control above — do not duplicate it.
- **Religion (piece 2), in the HR-only panel:** a select of exactly مسلم / مسيحي / آخر (Muslim / Christian / Other). **When «آخر» is chosen reveal a text input in place**; a save with OTHER and an empty detail is invalid — block it and show the error.
- Validation before calling save: email shape, phone shape, national id **exactly 14 digits**, salary > 0, IBAN non-empty, religion OTHER requires non-empty `religion_other`. Use the existing `field-error` class, `role="alert"`, and link with `aria-describedby` exactly as `ScheduleEditorDialog.tsx` does.
- **Respect this page's existing contract** (comment above `draftType`): *one draft, one save bar; selecting never saves.* The fact fields are draft state; the sticky Save calls `saveEmployeeFile(employeeId, patch)`; Discard reverts to the values in force. Do not add a second save button.
- On save success/failure show feedback through the page's existing `feedback`/`Banner` mechanism, surfacing `CAPABILITY_DENIED` / `MISSING_RECORD` honestly rather than pretending success.
- Seeding the draft: from `entry` as it is now (which already includes any override, since `visibleEmployeeFile`/the overlay are in effect).

## Hard constraints

- **No new dependencies.**
- Do not touch `ProfilePage.tsx`, the notification surface, or anything prayer-related — a separate job owns those.
- Keyboard accessible, visible focus, RTL correct (use logical properties; a numeric field may want `dir="ltr"`).
- `npm run build:demo` clean after your change.
- Commit only the files you own, with a message that says **why**.

## Definition of done — prove it, do not describe it

The reviewer re-runs all of this, so make it true. Headless Chrome over CDP is fine; existing harnesses to read for the pattern: `/tmp/h2-name.mjs`, `/tmp/h2-part.mjs`.

1. `npm run build:demo` → report the real exit code.
2. As HR on `/admin/people/e1`: edit the phone, the job title (Arabic **and** English), and in the HR-only panel the salary and the bank IBAN; press **Save**; **reload**; show every new value survived.
3. Show a save **propagates**: the new name/title appears on a screen that reads the directory (e.g. the people list `/admin/people` or an attendance table). Print the text you read.
4. Set religion to «آخر» → show the free-text input appears; try to save it empty → show it is **refused** with the error; fill it and save → show it persisted; switch back to «مسلم» → show the OTHER detail is **gone**.
5. Press **Discard** after an edit → show values revert.
6. Show an invalid national id (13 digits) is refused.

Report back: files changed, exact commands run, their real output, and anything you could not verify. If you disagree with a decision, say so instead of silently working around it.
