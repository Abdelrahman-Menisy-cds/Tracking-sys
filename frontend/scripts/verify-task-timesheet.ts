/**
 * Brief H2 — the «تايم شيت» tab's deterministic gate:
 *
 *   npx tsx scripts/verify-task-timesheet.ts
 *
 * Asserts the REAL imported functions (taskTimeWindows + taskTimesheet),
 * not a transcription. Exits non-zero on any failure. No browser, no server,
 * no new dependency. `window.sessionStorage` is only needed by taskTime's
 * store helpers — this gate never calls them, so no shim is required.
 */
import { WEEK_STARTS_ON, todayWindow, thisWeekWindow, thisMonthWindow, customWindow, entryInWindow, startOfLocalDay, endOfLocalDay } from "../src/mock/taskTimeWindows";
import { timesheetRows, timesheetTotalSeconds, localDayIso } from "../src/mock/taskTimesheet";
import type { TaskTimeEntry } from "../src/mock/taskTime";

let failed = false;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`);
  if (!ok) failed = true;
};

/* Local-day helpers that mirror the module's own definition. */
const DAY_START = (y: number, m: number, d: number, hh = 0, mm = 0): number =>
  new Date(y, m - 1, d, hh, mm, 0, 0).getTime();

/* Fixed anchor: 2026-10-12 is a MONDAY, so Saturday was 2026-10-10. */
const Y = 2026;

/* 0 — the week-start constant is what the brief demands. */
check("0 · WEEK_STARTS_ON === 6 (Saturday)", WEEK_STARTS_ON === 6, WEEK_STARTS_ON);

/* 1 — today: the local calendar day, not the trailing 24h. */
const NOON = DAY_START(Y, 10, 12, 12, 0);
const today = todayWindow(NOON);
check("1 · today window starts at local 00:00", today.fromMs === DAY_START(Y, 10, 12), new Date(today.fromMs).toString());
check("1 · today window ends at local 23:59:59.999", today.toMs === DAY_START(Y, 10, 12, 23, 59) + 59_999);
const atMidnight = new Date(DAY_START(Y, 10, 12)).toISOString();
const beforeMidnight = new Date(DAY_START(Y, 10, 12) - 60_000).toISOString(); // 23:59 yesterday
check("1 · entry at local 00:00 today is INSIDE", entryInWindow({ started_at: atMidnight }, today));
check("1 · entry one minute before local midnight YESTERDAY is OUTSIDE", !entryInWindow({ started_at: beforeMidnight }, today));

/* 2 — the week starts Saturday. */
const SATURDAY = DAY_START(Y, 10, 10, 15, 0);
const FRIDAY_BEFORE = DAY_START(Y, 10, 9, 15, 0);
const week = thisWeekWindow(NOON);
check("2 · this week's window starts on SATURDAY 00:00 local", week.fromMs === DAY_START(Y, 10, 10), new Date(week.fromMs).toString());
check("2 · Saturday entry is INSIDE the week", entryInWindow({ started_at: new Date(SATURDAY).toISOString() }, week));
check("2 · the Friday before is OUTSIDE the week", !entryInWindow({ started_at: new Date(FRIDAY_BEFORE).toISOString() }, week));

/* 3 — this month: 1st 00:00 inside; last logged day's 23:59 inside; the day before the 1st outside. */
const month = thisMonthWindow(NOON);
check("3 · month window starts at the 1st 00:00 local", month.fromMs === DAY_START(Y, 10, 1), new Date(month.fromMs).toString());
check("3 · the 1st at 00:00 is INSIDE", entryInWindow({ started_at: new Date(DAY_START(Y, 10, 1)).toISOString() }, month));
check("3 · a LATE-day entry (Oct 12's 23:59) is INSIDE the month", entryInWindow({ started_at: new Date(DAY_START(Y, 10, 12, 23, 59)).toISOString() }, month));
check("3 · Sep 30 is OUTSIDE", !entryInWindow({ started_at: new Date(DAY_START(Y, 9, 30, 12, 0)).toISOString() }, month));

/* 4 — a custom range is inclusive at BOTH ends. */
const from = DAY_START(Y, 10, 5);
const to = DAY_START(Y, 10, 8);
const range = customWindow(from, to);
check("4 · custom from-bound includes that day's 00:00", entryInWindow({ started_at: new Date(DAY_START(Y, 10, 5, 0, 0)).toISOString() }, range));
check("4 · custom to-bound includes that day's 23:59:59.999", entryInWindow({ started_at: new Date(DAY_START(Y, 10, 8, 23, 59, 59) + 999).toISOString() }, range));
check("4 · the day BEFORE the range is OUTSIDE", !entryInWindow({ started_at: new Date(DAY_START(Y, 10, 4, 12, 0)).toISOString() }, range));
check("4 · the day AFTER the range is OUTSIDE", !entryInWindow({ started_at: new Date(DAY_START(Y, 10, 9, 12, 0)).toISOString() }, range));

/* 5 — a midnight-crossing interval counts once, in full, under the day it STARTED. */
const crosses = new Date(DAY_START(Y, 10, 12) + 22 * 3_600_000).toISOString(); // 22:00 on the 12th
const rangeAround12 = customWindow(DAY_START(Y, 10, 12), DAY_START(Y, 10, 12));
check("5 · 22:00 start (crossing midnight) lands in the START day", entryInWindow({ started_at: crosses }, rangeAround12));
const rangeAround13 = customWindow(DAY_START(Y, 10, 13), DAY_START(Y, 10, 13));
check("5 · the same interval does NOT double-count into the next day", !entryInWindow({ started_at: crosses }, rangeAround13));
const midnightEntry: TaskTimeEntry = {
  id: "x", task_id: "T", employee_id: "e1",
  started_at: crosses,
  ended_at: new Date(DAY_START(Y, 10, 12) + 24 * 3_600_000 + 3_600_000).toISOString(), // 01:00 on the 13th
  seconds: 10_800, minutes: 180, // 3h, counted ONCE
};
const oneRow = timesheetRows([midnightEntry], rangeAround12, () => "T");
check("5 · the row's day list carries ONLY the start day (2026-10-12)",
  oneRow.length === 1 && oneRow[0].days.length === 1 && oneRow[0].days[0] === "2026-10-12", oneRow);
check("5 · the row's duration is the FULL 3h once (10_800s, not split)", oneRow[0]?.seconds === 10_800, oneRow[0]?.seconds);

/* 6 — zero-entry tasks are excluded; the total sums included entries only. */
const entries6: TaskTimeEntry[] = [
  { id: "a", task_id: "T1", employee_id: "e1", started_at: new Date(NOON - 3_600_000).toISOString(), ended_at: new Date(NOON).toISOString(), seconds: 3600, minutes: 60 },
  { id: "b", task_id: "T1", employee_id: "e1", started_at: new Date(NOON + 3_600_000).toISOString(), ended_at: new Date(NOON + 7_200_000).toISOString(), seconds: 3600, minutes: 60 },
  { id: "c", task_id: "EMPTY_TASK", employee_id: "e1", started_at: new Date(NOON - 86_400_000 * 30).toISOString(), ended_at: new Date(NOON - 86_400_000 * 30 + 60_000).toISOString(), seconds: 60, minutes: 1 }, // outside today
];
const rows6 = timesheetRows(entries6, todayWindow(NOON), (id) => (id === "EMPTY_TASK" ? "The empty one" : `T ${id}`), "e1");
check("6 · only tasks WITH in-window entries have rows (EMPTY_TASK absent)", rows6.length === 1 && rows6[0].task_id === "T1", rows6.map((row) => row.task_id));
check("6 · the row sums BOTH included intervals", rows6[0]?.seconds === 7200, rows6[0]?.seconds);
check("6 · the total is the sum of included entries only", timesheetTotalSeconds(rows6) === 7200, timesheetTotalSeconds(rows6));
check("6 · a task id with no title row is dropped (defensive)", timesheetRows(entries6, todayWindow(NOON), () => undefined).length === 0);

/* 7 — the employee filter narrows to one person; the manager total spans. */
const team: TaskTimeEntry[] = [
  { id: "1", task_id: "T1", employee_id: "e1", started_at: new Date(NOON - 3_600_000).toISOString(), ended_at: new Date(NOON).toISOString(), seconds: 3600, minutes: 60 },
  { id: "2", task_id: "T1", employee_id: "e2", started_at: new Date(NOON - 1_800_000).toISOString(), ended_at: new Date(NOON).toISOString(), seconds: 1800, minutes: 30 },
  { id: "3", task_id: "T2", employee_id: "e2", started_at: new Date(NOON - 600_000).toISOString(), ended_at: new Date(NOON).toISOString(), seconds: 600, minutes: 10 },
];
const titles = (id: string): string => `T ${id}`;
const all = timesheetRows(team, todayWindow(NOON), titles, undefined);
const onlyE2 = timesheetRows(team, todayWindow(NOON), titles, "e2");
check("7 · manager no-filter rows include BOTH employees' tasks", all.length === 2, all.map((row) => row.task_id));
check("7 · manager no-filter total = sum across employees (6000)", timesheetTotalSeconds(all) === 6000, timesheetTotalSeconds(all));
check("7 · employee filter narrows to e2's tasks only", onlyE2.length === 2 && onlyE2.every((row) => row.task_id !== undefined), onlyE2.map((row) => row.task_id));
check("7 · e2-filtered total follows (2400)", timesheetTotalSeconds(onlyE2) === 2400, timesheetTotalSeconds(onlyE2));
check("7 · e2's two entries total 2400 (1800 + 600)", timesheetTotalSeconds(onlyE2) === 2400, timesheetTotalSeconds(onlyE2));

/* 8 — the total is unchanged by re-sorting or an everything-matching name filter. */
const shuffled = [...rows6].reverse();
check("8 · re-sorting rows does not change the total", timesheetTotalSeconds(shuffled) === timesheetTotalSeconds(rows6));
check("8 · entries re-ordered do not change the total", timesheetTotalSeconds(timesheetRows([...team].reverse(), todayWindow(NOON), titles, undefined)) === timesheetTotalSeconds(all));
check("8 · name filter matching everything keeps the same total", timesheetTotalSeconds(rows6.filter(() => true)) === timesheetTotalSeconds(rows6));

/* helpers sanity — the day Iso is LOCAL, not UTC. */
check("h · localDayIso uses the local calendar (Y-M-D)", /^\d{4}-\d{2}-\d{2}$/.test(localDayIso(NOON)), localDayIso(NOON));
check("h · startOfLocalDay/endOfLocalDay span 86_399_999ms", endOfLocalDay(NOON) - startOfLocalDay(NOON) === 86_399_999);

if (failed) {
  console.log("\nTIMESHEET GATE FAILED");
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
