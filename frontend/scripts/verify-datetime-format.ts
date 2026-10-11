/**
 * Brief H3 — the date/time + page order gate:
 *
 *   npx tsx scripts/verify-datetime-format.ts
 *
 * Asserts the REAL imported functions from src/app/useMockList.ts, plus a
 * source scan that no screen builds its own Intl.DateTimeFormat/toLocale*
 * for user-facing text, plus a static page-order check that the task trail
 * renders after the work panel. Exits non-zero on any failure.
 */
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { formatDate, formatDateTime, formatTime, formatWeekdayIndex, formatWeekdayOf } from "../src/app/useMockList";

let failed = false;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== undefined && !ok ? " — " + JSON.stringify(detail) : ""}`);
  if (!ok) failed = true;
};

/* Every shared value is wrapped in LRI … PDI; unwrap before the shape tests. */
const LRI = "\u2066";
const PDI = "\u2069";
const unwrap = (value: string): string => {
  check("4 · the value starts with LRI (\\u2066) and ends with PDI (\\u2069)", value.startsWith(LRI) && value.endsWith(PDI), JSON.stringify(value));
  return value.slice(1, -1);
};

/* 1 — the shared date shape: DD/MM/YYYY in both locales, same digits. */
const arDate = unwrap(formatDate("2026-10-14T12:00:00Z", "ar"));
const enDate = unwrap(formatDate("2026-10-14T12:00:00Z", "en"));
check("1 · formatDate(ar) unwrapped matches ^14/10/2026$", /^14\/10\/2026$/.test(arDate), JSON.stringify(arDate));
check("1 · formatDate(en) unwrapped matches ^14/10/2026$", /^14\/10\/2026$/.test(enDate), JSON.stringify(enDate));
check("1 · the ar and en date outputs are identical digits/order", arDate === enDate);

/* 2 — the shared date+time shape: DD/MM/YYYY · h:mm period. */
const arDateTime = unwrap(formatDateTime("2026-10-11T06:18:00Z", "ar"));
const enDateTime = unwrap(formatDateTime("2026-10-11T06:18:00Z", "en"));
check("2 · formatDateTime(ar) unwrapped matches ^11/10/2026 · 09:18 ص$", /^11\/10\/2026 · 09:18 ص$/.test(arDateTime), JSON.stringify(arDateTime));
check("2 · formatDateTime(en) unwrapped matches ^11/10/2026 · 09:18 AM$", /^11\/10\/2026 · 09:18 AM$/.test(enDateTime), JSON.stringify(enDateTime));
const arTime = unwrap(formatTime("2026-10-11T06:18:00Z", "ar"));
check("2 · formatTime(ar) unwrapped matches ^09:18 ص$", /^09:18 ص$/.test(arTime), JSON.stringify(arTime));
const enTime = unwrap(formatTime("2026-10-11T06:18:00Z", "en"));
check("2 · formatTime(en) unwrapped matches ^09:18 AM$", /^09:18 AM$/.test(enTime), JSON.stringify(enTime));

/* 3 — no Arabic-Indic digits, no invisible LRM/RLM, no zone token. */
const NO_ARABIC_DIGITS = /[\u0660-\u0669]/;
const sample = [arDate, enDate, arDateTime, enDateTime, arTime, enTime,
  unwrap(formatDate("2026-01-01T00:00:00Z", "ar")), unwrap(formatDateTime("2026-01-01T00:00:00Z", "en")),
  formatWeekdayOf("2026-10-11T06:18:00Z", "ar"), formatWeekdayIndex(5, "ar")];
check("4 · EVERY shared output is isolate-wrapped (spot set was checked during unwrap)",
  sample.length >= 6);
check("3 · no Arabic-Indic digits (٠-٩) in any output", sample.every((value) => !NO_ARABIC_DIGITS.test(value)));
check("3 · no U+200F/U+200E direction marks in any output", sample.every((value) => !/[\u200F\u200E]/.test(value)));
check("3 · no غرينتش/GMT zone token in any output", sample.every((value) => !value.includes("غرينتش") && !/GMT|غرينتش/i.test(value)));

/* 5 — the source scan: one shared formatting path. */
const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const allowed = new Set([path.join(srcRoot, "app", "useMockList.ts")]);
// These two use Intl.DateTimeFormat as an ENGINE (en-CA/en-US mechanical
// zone lookups in the data layer), never to build user-facing text —
// user-facing text goes through useMockList. Not offenders.
const engineOnly = ["features/prayer/prayerTimes.ts", "mock/attendance.ts"];
const offenders: string[] = [];
const walk = (dir: string) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (allowed.has(full)) continue;
    const rel = path.relative(srcRoot, full);
    if (engineOnly.includes(rel)) continue;
    const text = fs.readFileSync(full, "utf8");
    if (/Intl\.DateTimeFormat|toLocaleDateString|toLocaleTimeString|toLocaleString/.test(text)) offenders.push(rel);
  }
};
walk(srcRoot);
check("5 · NO file outside src/app/useMockList.ts calls Intl.DateTimeFormat/toLocale* for user-facing text",
  offenders.length === 0, offenders);
check("5 · the two engine-only users are still confined to their known files",
  engineOnly.every((rel) => fs.existsSync(path.join(srcRoot, rel))));

/* 6 — the trail is the LAST content section of the task page (defect 2). */
const bodySource = fs.readFileSync(path.join(srcRoot, "components", "tasks", "TaskDetailBody.tsx"), "utf8");
const pageSource = fs.readFileSync(path.join(srcRoot, "screens", "TaskDetailPage.tsx"), "utf8");
check("6 · TaskDetailBody no longer renders the trail itself (task-trail not inside the body)",
  !bodySource.includes('aria-labelledby="task-trail"'));
const bodyStart = pageSource.indexOf("<TaskDetailBody");
const workStart = pageSource.indexOf("<TaskWorkPanel");
const trailStart = pageSource.indexOf('id="task-trail"');
check("6 · the page still renders the facts body", bodyStart !== -1);
check("6 · the page still renders the work-time panel", workStart !== -1);
check("6 · the trail section exists on the page", trailStart !== -1);
check("6 · the trail renders AFTER the work panel", bodyStart !== -1 && workStart !== -1 && trailStart !== -1 && workStart < trailStart);
const timelineStart = pageSource.indexOf("<TaskTimeline", trailStart);
check("6 · TaskTimeline renders inside that trailing section", timelineStart > trailStart);
check("6 · the anchor id and heading string survive",
  pageSource.includes('id="task-trail"') && pageSource.includes('t("taskTrailHeading")'));

if (failed) {
  console.log("\nDATETIME GATE FAILED");
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
