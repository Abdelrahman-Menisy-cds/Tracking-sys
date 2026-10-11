/**
 * Brief H5 — the task OPEN status is named «جديدة» / "New":
 *
 *   npx tsx scripts/verify-st-open-label.ts
 *
 * Fails loudly if any of the four assertions regresses — in particular if
 * a future blanket find-and-replace over «مفتوحة» corrupts the unrelated
 * prayer sentence, or if the attendance labels join the rename.
 */
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

let failed = false;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== undefined && !ok ? " — " + JSON.stringify(detail) : ""}`);
  if (!ok) failed = true;
};

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const dict = fs.readFileSync(path.join(srcRoot, "i18n", "dict.ts"), "utf8");

/* 1 — the label itself, in both blocks. */
const arBlock = dict.slice(dict.indexOf("/* ===== Brief C — the tasks cycle"), dict.indexOf('locale: "en"') === -1 ? dict.length : dict.indexOf("  en: {"));
const enBlock = dict.slice(dict.indexOf("  en: {"));
const arStOpen = arBlock.match(/stOpen: "([^"]+)"/);
const enStOpen = enBlock.match(/stOpen: "([^"]+)"/);
check("1 · ar stOpen is exactly «جديدة»", arStOpen?.[1] === "جديدة", arStOpen?.[1]);
check("1 · en stOpen is exactly \"New\"", enStOpen?.[1] === "New", enStOpen?.[1]);

/* 2 — the unrelated «مفتوحة» sentence survives, inside prayerSettingsScopeLine. */
const prayer = dict.match(/prayerSettingsScopeLine: "([^"]*)"/);
check("2 · prayerSettingsScopeLine still contains «مفتوحة»", prayer?.[1]?.includes("مفتوحة") === true, prayer?.[1]);
check("2 · the prayer sentence's «مفتوحة» still reads 'while this page is open'",
  prayer?.[1]?.includes("بينما هذه الصفحة مفتوحة") === true, prayer?.[1]);
check("2 · no other «مفتوحة» remains in the tasks section",
  dict.slice(dict.indexOf("Brief C — the tasks cycle")).split("/* =====")[0].includes("stOpen: \"جديدة\""));

/* 3 — no task surface hardcodes the OLD label for this status. The one
   allowed "Open" is MyTimesheetsPage's row ACTION verb for attendance
   sheets («فتح» / "Open") — an unrelated domain by design, same as the
   attendance status labels. */
let hardcoded = 0;
const walk = (dir: string) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) { walk(full); continue; }
    if (!/\.(tsx)$/.test(name)) continue;
    const text = fs.readFileSync(full, "utf8").replace(/locale === "ar" \? "فتح" : "Open"/g, "");
    if (text.includes("مفتوحة") || /['"]Open['"]/.test(text)) hardcoded += 1;
  }
};
walk(path.join(srcRoot, "components"));
walk(path.join(srcRoot, "screens"));
check("3 · no component/screen hardcodes «مفتوحة» or \"Open\" (the attendance 'Open sheet' action excluded by name)",
  hardcoded === 0, `${hardcoded} file(s)`);
check("3 · the status renders through t(\"stOpen\") — TaskPills.taskStatusKey intact",
  fs.readFileSync(path.join(srcRoot, "components", "tasks", "TaskPills.tsx"), "utf8").includes('OPEN: "stOpen"'));
check("3 · TasksPage filter routes OPEN through stOpen",
  fs.readFileSync(path.join(srcRoot, "screens", "TasksPage.tsx"), "utf8").includes('? "stOpen"'));

/* 4 — attendance and the record Timeline are untouched domains. */
const attPage = fs.readFileSync(path.join(srcRoot, "screens", "AttendancePage.tsx"), "utf8");
check("4 · AttendancePage does NOT render stOpen", !attPage.includes("stOpen"));
check("4 · attendanceStatusOpen stays \"Open\" in the dict", /attendanceStatusOpen: "Open"/.test(dict));
const timeline = fs.readFileSync(path.join(srcRoot, "components", "record", "Timeline.tsx"), "utf8");
check("4 · record Timeline has no OPEN mapping (different domain, untouched)", !/\bOPEN\b/.test(timeline));

/* 5 — identifiers and testids unchanged. */
const bar = fs.readFileSync(path.join(srcRoot, "components", "tasks", "TaskStatusBar.tsx"), "utf8");
check("5 · TaskStatusBar options still literal ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']",
  bar.includes('["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]'));
check("5 · the option testids still derive as task-status-${status.toLowerCase()}", bar.includes('task-status-${status.toLowerCase()}'));
check("5 · the mock data / type side keeps \"OPEN\"",
  fs.readFileSync(path.join(srcRoot, "mock", "tasks.ts"), "utf8").includes('"OPEN"'));

if (failed) {
  console.log("\nST-OPEN LABEL GATE FAILED");
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
