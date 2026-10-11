/**
 * Brief H2 — the «تايم شيت» tab's period maths, as a pure module on purpose:
 * the gate script (scripts/verify-task-timesheet.ts) imports exactly these
 * functions, so the browser's rows and the deterministic gate share one truth.
 * No DOM, no React, no `new Date()` inline anywhere in the component.
 *
 * Rules the owner must be able to disagree with (stated in the UI as well):
 *  - The week starts SATURDAY (the Egyptian working week) — one named constant.
 *  - A window's boundaries are LOCAL-time calendar boundaries; "today" means
 *    the local calendar day, not the trailing 24 hours.
 *  - A custom range is INCLUSIVE of both ends.
 *  - An interval that crosses midnight is counted ONCE, in full, and lands in
 *    the day it STARTED — splitting a worked interval across two days would
 *    inflate the total the owner reads first.
 */

/** The week's first day, 0 = Sunday … 6 = Saturday (Egyptian working week). */
export const WEEK_STARTS_ON = 6;

/** One clock window, local-time inclusive of both ends (epoch millis). */
export interface ClockWindow {
  fromMs: number;
  toMs: number;
}

/** The start of the LOCAL calendar day holding `now`. */
export function startOfLocalDay(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The end of the LOCAL calendar day holding `now` (23:59:59.999). */
export function endOfLocalDay(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
}

/** This week's window: back FROM today to THE WEEK'S START (Saturday), local. */
export function thisWeekWindow(now: number): ClockWindow {
  const date = new Date(now);
  const dayIndex = date.getDay(); // 0 = Sunday … 6 = Saturday
  const daysSinceWeekStart = (dayIndex - WEEK_STARTS_ON + 7) % 7;
  const weekStart = startOfLocalDay(now - daysSinceWeekStart * 86_400_000);
  return { fromMs: weekStart, toMs: endOfLocalDay(now) };
}

/** This month's window: the 1st at 00:00 through today's end, local. */
export function thisMonthWindow(now: number): ClockWindow {
  const date = new Date(now);
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  return { fromMs: monthStart, toMs: endOfLocalDay(now) };
}

/** Today's window: the local calendar day, not the trailing 24 hours. */
export function todayWindow(now: number): ClockWindow {
  return { fromMs: startOfLocalDay(now), toMs: endOfLocalDay(now) };
}

/** A custom range, INCLUSIVE of the to-day's whole day. `toMs` may be a bare
 *  calendar-day value; it is widened to that day's very end. */
export function customWindow(fromMs: number, toMs: number): ClockWindow {
  return { fromMs: startOfLocalDay(fromMs), toMs: endOfLocalDay(toMs) };
}

/**
 * Is an entry inside the window? Rule: a multi-day interval counts ONCE, in
 * full, under the day it STARTED — so only `started_at` is tested against the
 * window, never `ended_at`. Half of a 3am interval landing in yesterday would
 * otherwise double-count the work.
 */
export function entryInWindow(
  entry: Pick<import("./taskTime").TaskTimeEntry, "started_at">,
  window: ClockWindow,
): boolean {
  const started = Date.parse(entry.started_at);
  if (Number.isNaN(started)) return false;
  return started >= window.fromMs && started <= window.toMs;
}
