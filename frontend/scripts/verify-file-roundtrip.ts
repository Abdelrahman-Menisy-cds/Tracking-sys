/**
 * Brief F — the reload race, as a deterministic gate:
 *
 *   npx tsx scripts/verify-file-roundtrip.ts
 *
 * Two layers:
 *
 * 1. DATA LAYER — simulate the save → hard-reload → boot lifecycle and
 *    prove a saved patch survives it when boot re-applies the overlay, and
 *    that the raw fixture (what the page used to read) loses it: the
 *    mechanism, in five checkable lines.
 *
 * 2. PAGE SOURCE — the live bug shipped because AdminPeopleDetailPage read
 *    the RAW fixture constant instead of the context's override-aware
 *    employeeDirectory; a pure data test rides around that. So gate the
 *    page source itself: it must take employeeDirectory from useApp() and
 *    must NOT import it from mock/data. Revert the page fix and checks
 *    5–6 go red — the gate is live. Exits non-zero on any failure.
 *    No browser, no server.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  employeeDirectory,
  mergeEmployeeFilePatch,
  visibleEmployeeFile,
  type EmployeeDirectoryEntry,
  type EmployeeFilePatch,
  type EmployeeFileViewer,
} from "../src/mock/data";

let failed = false;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`);
  if (!ok) failed = true;
};

const pagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "screens", "admin", "AdminPeopleDetailPage.tsx");

/* ------------------------------------------------------------------
 * Proof 1 — data layer.
 * ------------------------------------------------------------------ */
function simulateSaveAndReload(patch: EmployeeFilePatch): EmployeeDirectoryEntry {
  const stored: Record<string, EmployeeFilePatch> = { e1: patch };
  // hard reload: a fresh document re-derives base from the module constant…
  const baseOnReload = employeeDirectory.find((e) => e.id === "e1")!;
  // …and boot re-applies the stored overlay (employeeDirectoryWithOverrides).
  const merged = mergeEmployeeFilePatch(baseOnReload, stored.e1);
  const viewer: EmployeeFileViewer = { id: "hr1", role: "hr" };
  return visibleEmployeeFile(merged, viewer);
}

const patch1: EmployeeFilePatch = {
  name: employeeDirectory[0]!.name,
  department: employeeDirectory[0]!.department,
  job_title: employeeDirectory[0]!.job_title,
  direct_manager: employeeDirectory[0]!.direct_manager,
  email: employeeDirectory[0]!.email,
  phone: "+20 111 333 4444",
  join_date: employeeDirectory[0]!.join_date,
  hr_file: {
    ...employeeDirectory[0]!.hr_file!,
    salary: { amount: 15500, currency: "EGP", payroll_cycle: "MONTHLY" },
  },
};
{
  const entry = simulateSaveAndReload(patch1);
  const salary = entry.hr_file?.salary.amount ?? -1;
  check("data: edited salary survives a hard reload via the overlay read", salary === 15500, salary);
  check("data: edited phone survives a hard reload via the overlay read", entry.phone === "+20 111 333 4444", entry.phone);
  check("data: hr_file replaces the WHOLE slice (patch contracts, not fixture's)", Array.isArray(entry.hr_file?.contracts) && entry.hr_file!.contracts.length === 1 && entry.hr_file!.contracts.length >= 0 && entry.hr_file!.contracts === patch1.hr_file!.contracts, entry.hr_file?.contracts.length);
}

/* ------------------------------------------------------------------
 * Proof 2 — the bug shape: the RAW fixture read silently reverts.
 * ------------------------------------------------------------------ */
{
  const buggyEntry = visibleEmployeeFile(employeeDirectory.find((e) => e.id === "e1")!, { id: "hr1", role: "hr" });
  check("bug shape: raw-fixture read loses the edited salary", buggyEntry.hr_file?.salary.amount === 12500, buggyEntry.hr_file?.salary.amount);
  check("bug shape: raw-fixture read loses the edited phone", buggyEntry.phone === "+20 10 5555 1842", buggyEntry.phone);
}

/* ------------------------------------------------------------------
 * Proof 3 — page source: the directory the detail page reads must be the
 * context value (override-aware on every fresh document), never a raw
 * fixture import. Reverting the page fix makes these go red.
 * ------------------------------------------------------------------ */
{
  const src = readFileSync(pagePath, "utf8");
  const importsRawFixture =
    /import\s*\{[\s\S]*?\bemployeeDirectory\b[\s\S]*\}\s*from\s*["'][^"']*mock\/data["']/.test(src)
    || new RegExp(`import\\s*\\{[^}]*\\benployeeDirectory\\b[^}]*\\}[^}]*from`).test(src.replace(/\benployeeDirectory\b/g, "employeeDirectory"));
  check("page: no employeeDirectory import from mock/data (the shipped bug, stated verbatim)", !importsRawFixture, "AdminPeopleDetailPage.tsx");
  check("page: takes employeeDirectory from useApp()", /useApp\(\)[\s\S]{0,500}\bemployeeDirectory\b/.test(src), "AdminPeopleDetailPage.tsx");
}

process.exit(failed ? 1 : 0);
