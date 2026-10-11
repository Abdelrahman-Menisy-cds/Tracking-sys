/**
 * Brief H2 — the «تايم شيت» rows: the pure aggregation the tab renders.
 * Sits on the brief-H1 store (`task_time` entries) and the window module; the
 * gate script imports THESE functions, so browser and gate share one truth.
 * No DOM, no React.
 */
import type { TaskTimeEntry } from "./taskTime";
import { entryInWindow, type ClockWindow } from "./taskTimeWindows";

/** One row: only tasks WITH logged time appear (the owner's explicit word). */
export interface TimesheetRow {
  task_id: string;
  /** Seconds summed across every included interval. */
  seconds: number;
  /** The local calendar days (yyyy-mm-dd) the work started on, ascending. */
  days: string[];
}

/** Local calendar day of a timestamp, yyyy-mm-dd — the row's "worked on". */
export function localDayIso(timestamp: number): string {
  const date = new Date(timestamp);
  const two = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * The rows for a window + employee scope. An ENDED interval counts once, in
 * full, under the day it STARTED (see entryInWindow). Tasks with no included
 * entries produce no row — «بس التاسكات بالوقت الي قضيته فيها».
 * Sorted by seconds descending (biggest first) with the id as the stable tiebreak.
 */
export function timesheetRows(
  entries: TaskTimeEntry[],
  window: ClockWindow,
  taskTitle: (taskId: string) => string | undefined,
  employeeId?: string,
): TimesheetRow[] {
  const byTask = new Map<string, { seconds: number; daySet: Set<string> }>();
  for (const entry of entries) {
    if (!entry.ended_at) continue; // a running interval is not logged time yet
    if (employeeId !== undefined && entry.employee_id !== employeeId) continue;
    if (!entryInWindow(entry, window)) continue; // not in the worked window
    const bucket = byTask.get(entry.task_id) ?? { seconds: 0, daySet: new Set<string>() };
    bucket.seconds += entry.seconds ?? Math.round(entry.minutes * 60);
    bucket.daySet.add(localDayIso(Date.parse(entry.started_at)));
    byTask.set(entry.task_id, bucket);
  }
  return Array.from(byTask.entries())
    .map(([task_id, bucket]) => ({
      task_id,
      seconds: bucket.seconds,
      days: Array.from(bucket.daySet).sort(),
      taskIdRef: task_id,
    }))
    .filter((row) => taskTitle(row.task_id) !== undefined)
    .map(({ task_id, seconds, days }) => ({ task_id, seconds, days }))
    .sort((a, b) => b.seconds - a.seconds || (a.task_id < b.task_id ? -1 : 1));
}

/** The total for the CURRENT filter — the number the owner reads first. */
export function timesheetTotalSeconds(rows: TimesheetRow[]): number {
  return rows.reduce((sum, row) => sum + row.seconds, 0);
}
