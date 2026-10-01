import type { Role } from "../i18n/dict";

export type DemoIdentity = Role;

export type AttendanceEventKind = "CLOCK_IN" | "CLOCK_OUT";
export type AttendanceEventSource = "WEB";
export type AttendanceDayStatus = "OPEN" | "PRESENT" | "ABSENT_CANDIDATE" | "ABSENT" | "LEAVE" | "HOLIDAY" | "REMOTE" | "INCOMPLETE";
export type AttendanceException = "LATE" | "EARLY_LEAVE" | "MISSING_CLOCK_OUT" | "NONE";
export type ScheduleScope = "ORGANIZATION" | "TEAM" | "EMPLOYEE";
export type LeaveTypeCode = "ANNUAL" | "SICK" | "UNPAID" | "EMERGENCY";

export interface AttendanceEvent {
  id: string;
  employee: string;
  occurred_at: string;
  kind: AttendanceEventKind;
  source: AttendanceEventSource;
  recorded_by: string;
  created_at: string;
  note?: string;
}

export interface AttendanceDay {
  employee: string;
  work_date: string;
  first_in_at: string | null;
  last_out_at: string | null;
  worked_minutes: number;
  break_minutes: number;
  status: AttendanceDayStatus;
  exception: AttendanceException;
  expected_minutes: number;
  justification?: string;
  resolved_by?: string;
  resolved_at?: string;
}

export interface WorkSchedule {
  id: string;
  scope: ScheduleScope;
  target?: string;
  working_weekdays: number[];
  expected_start: string;
  expected_end: string;
  expected_daily_minutes: number;
  grace_minutes: number;
  effective_from: string;
  effective_to?: string;
}

export interface LeaveType {
  code: LeaveTypeCode;
  is_paid: boolean;
  requires_attachment: boolean;
  counts_against_balance: boolean;
  allow_negative: boolean;
}

export interface LeaveAdjustment {
  id: string;
  days: number;
  reason: string;
  created_at: string;
  recorded_by: string;
}

export interface LeaveBalance {
  employee: string;
  leave_type: LeaveTypeCode;
  period: string;
  entitlement_days: number;
  carry_over_days: number;
  carry_over_cap_days: number;
  carry_over_expiry_months: number;
  used_days: number;
  pending_days: number;
  adjustments: LeaveAdjustment[];
}

export type AttendanceMutationCode = "CAPABILITY_DENIED" | "CLOCK_IN_ALREADY_OPEN" | "CLOCK_OUT_WITHOUT_OPEN_CLOCK_IN" | "MISSING_RECORD" | "INVALID_INPUT";
export type AttendanceMutationResult<T = void> =
  | { ok: true; value?: T }
  | { ok: false; code: AttendanceMutationCode };

const CAIRO_TIME_ZONE = "Africa/Cairo";
const cairoFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: CAIRO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const cairoDateTimeFormatter = new Intl.DateTimeFormat("en-US", { timeZone: CAIRO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Return the organization-local work date, never the browser/UTC date. */
export const cairoDate = (date: Date) => {
  const parts = cairoFormatter.formatToParts(date).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

function cairoDateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

/** Build a valid instant for a Cairo wall-clock time, accounting for its actual offset. */
function cairoWallClockInstant(workDate: string, timeOrHour: string | number, minute = 0): Date {
  const parsedDate = cairoDateParts(workDate);
  const dateIsValid = Number.isInteger(parsedDate.year) && Number.isInteger(parsedDate.month) && Number.isInteger(parsedDate.day)
    && parsedDate.month >= 1 && parsedDate.month <= 12 && parsedDate.day >= 1 && parsedDate.day <= 31;
  const { hour: parsedHour, minute: parsedMinute } = typeof timeOrHour === "string" && timeOrHour.includes(":")
    ? (() => { const [hour, min] = timeOrHour.split(":").map(Number); return { hour, minute: min }; })()
    : { hour: Number(timeOrHour), minute: Number(minute) };
  const validTime = Number.isFinite(parsedHour) && parsedHour >= 0 && parsedHour <= 23
    && Number.isFinite(parsedMinute) && parsedMinute >= 0 && parsedMinute <= 59;
  const year = dateIsValid ? parsedDate.year : 2000;
  const month = dateIsValid ? parsedDate.month : 1;
  const day = dateIsValid ? parsedDate.day : 1;
  const hour = validTime ? parsedHour : 12;
  const safeMinute = validTime ? parsedMinute : 0;
  const target = Date.UTC(year, month - 1, day, hour, safeMinute);
  let instant = new Date(target);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const shown = cairoDateTimeFormatter.formatToParts(instant).reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
    const shownAsUtc = Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day), Number(shown.hour), Number(shown.minute));
    instant = new Date(instant.getTime() + (target - shownAsUtc));
  }
  return Number.isFinite(instant.getTime()) ? instant : new Date(Date.UTC(2000, 0, 1, 10));
}

const dateAt = (daysAgo: number, hour: number, minute = 0) => {
  const now = new Date();
  const today = cairoDate(now);
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  const workDate = date.toISOString().slice(0, 10);
  return cairoWallClockInstant(workDate, String(hour), minute);
};

const isEgyptWorkingDay = (date: Date) => {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: CAIRO_TIME_ZONE, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(weekday);
};

export type AttendanceExceptionResult = "LATE" | "EARLY_LEAVE" | "NONE";
export function attendanceExceptionForEvent(event: AttendanceEvent | null, workDate: string, schedule: WorkSchedule | null): AttendanceExceptionResult {
  if (!event || !schedule) return "NONE";
  const expectedWallClock = event.kind === "CLOCK_IN" ? schedule.expected_start : schedule.expected_end;
  const wallClockMatch = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(expectedWallClock);
  const occurredAt = Date.parse(event.occurred_at);
  if (!wallClockMatch || !Number.isFinite(occurredAt) || !Number.isFinite(schedule.grace_minutes) || schedule.grace_minutes < 0) return "NONE";
  const expected = cairoWallClockInstant(workDate, expectedWallClock);
  if (!Number.isFinite(expected.getTime())) return "NONE";
  const grace = event.kind === "CLOCK_IN" ? schedule.grace_minutes * 60000 : 0;
  if (event.kind === "CLOCK_IN" && occurredAt > expected.getTime() + grace) return "LATE";
  if (event.kind === "CLOCK_OUT" && occurredAt < expected.getTime()) return "EARLY_LEAVE";
  return "NONE";
}

export const organizationSchedule: WorkSchedule = {
  id: "schedule-org-egypt",
  scope: "ORGANIZATION",
  working_weekdays: [0, 1, 2, 3, 4],
  expected_start: "09:00",
  expected_end: "17:00",
  expected_daily_minutes: 480,
  grace_minutes: 15,
  effective_from: "2024-01-01",
};

export const employeeScheduleOverride: WorkSchedule = {
  id: "schedule-e1-operations",
  scope: "EMPLOYEE",
  target: "e1",
  working_weekdays: [0, 1, 2, 3, 4],
  expected_start: "09:30",
  expected_end: "16:30",
  expected_daily_minutes: 420,
  grace_minutes: 10,
  effective_from: "2025-01-01",
};

export const attendanceSchedules: WorkSchedule[] = [organizationSchedule, employeeScheduleOverride];

export const leaveTypes: LeaveType[] = [
  { code: "ANNUAL", is_paid: true, requires_attachment: false, counts_against_balance: true, allow_negative: false },
  { code: "SICK", is_paid: true, requires_attachment: true, counts_against_balance: true, allow_negative: false },
  { code: "UNPAID", is_paid: false, requires_attachment: false, counts_against_balance: false, allow_negative: true },
  { code: "EMERGENCY", is_paid: true, requires_attachment: false, counts_against_balance: true, allow_negative: false },
];

const fixtureNames: Record<string, string> = { e1: "demo-employee", m1: "demo-manager", hr1: "demo-hr" };

function eventsForEmployee(employee: string, prefix: string): AttendanceEvent[] {
  const events: AttendanceEvent[] = [];
  let workingIndex = 0;
  for (let daysAgo = 1; daysAgo <= 35 && workingIndex < 20; daysAgo += 1) {
    const date = dateAt(daysAgo, 9);
    if (!isEgyptWorkingDay(date)) continue;
    const workDate = cairoDate(date);
    const created = date.toISOString();
    const add = (kind: AttendanceEventKind, hour: number, minute = 0, note?: string) => events.push({
      id: `${prefix}-${workDate}-${kind.toLowerCase()}-${events.length}`,
      employee,
      occurred_at: dateAt(daysAgo, hour, minute).toISOString(),
      kind,
      source: "WEB",
      recorded_by: employee,
      created_at: created,
      note,
    });
    const pattern = workingIndex % 8;
    if (pattern === 3) {
      // A closed scheduled day with no events becomes ABSENT_CANDIDATE.
    } else if (pattern === 4) {
      add("CLOCK_IN", 9, 40, "Late arrival");
      add("CLOCK_OUT", 17);
    } else if (pattern === 5) {
      add("CLOCK_IN", 9);
      add("CLOCK_OUT", 14, 30, "Early departure");
    } else if (pattern === 6) {
      add("CLOCK_IN", 9, 15);
      // Intentionally unmatched so the derived day is INCOMPLETE.
    } else {
      add("CLOCK_IN", pattern === 1 ? 9 : 9, pattern === 1 ? 5 : 0);
      add("CLOCK_OUT", 13);
      add("CLOCK_IN", 14);
      add("CLOCK_OUT", 17);
    }
    workingIndex += 1;
  }
  return events;
}

export const attendanceEventsByIdentity: Record<DemoIdentity, AttendanceEvent[]> = {
  employee: eventsForEmployee("e1", "att-e1"),
  manager: eventsForEmployee("m1", "att-m1"),
  hr: eventsForEmployee("hr1", "att-hr1"),
};

export const leaveBalancesByIdentity: Record<DemoIdentity, LeaveBalance[]> = {
  employee: [
    { employee: "e1", leave_type: "ANNUAL", period: "2026", entitlement_days: 21, carry_over_days: 3, carry_over_cap_days: 5, carry_over_expiry_months: 3, used_days: 4, pending_days: 2, adjustments: [{ id: "adj-e1-1", days: 1, reason: "Service recognition grant", created_at: "2026-01-03T09:00:00Z", recorded_by: "hr1" }] },
    { employee: "e1", leave_type: "SICK", period: "2026", entitlement_days: 14, carry_over_days: 0, carry_over_cap_days: 0, carry_over_expiry_months: 0, used_days: 1, pending_days: 0, adjustments: [] },
  ],
  manager: [
    { employee: "m1", leave_type: "ANNUAL", period: "2026", entitlement_days: 24, carry_over_days: 2, carry_over_cap_days: 5, carry_over_expiry_months: 3, used_days: 7, pending_days: 1, adjustments: [{ id: "adj-m1-1", days: -1, reason: "Prior-period correction", created_at: "2026-02-08T09:00:00Z", recorded_by: "hr1" }] },
  ],
  hr: [
    { employee: "hr1", leave_type: "ANNUAL", period: "2026", entitlement_days: 25, carry_over_days: 4, carry_over_cap_days: 5, carry_over_expiry_months: 3, used_days: 3, pending_days: 2, adjustments: [{ id: "adj-hr1-1", days: 2, reason: "Accrual correction", created_at: "2026-01-05T09:00:00Z", recorded_by: "hr1" }] },
  ],
};

export function resolveScheduleFixture(employee: string, date: string, schedules = attendanceSchedules): WorkSchedule | null {
  const active = schedules.filter((schedule) => schedule.effective_from <= date && (!schedule.effective_to || date <= schedule.effective_to));
  const employeeMatch = active.filter((schedule) => schedule.scope === "EMPLOYEE" && schedule.target === employee).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  if (employeeMatch) return employeeMatch;
  const teamMatch = active.filter((schedule) => schedule.scope === "TEAM").sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  if (teamMatch) return teamMatch;
  return active.filter((schedule) => schedule.scope === "ORGANIZATION").sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
}

export function deriveAttendanceDays(events: AttendanceEvent[], employee: string, schedules = attendanceSchedules): AttendanceDay[] {
  const byDate = new Map<string, AttendanceEvent[]>();
  events.filter((event) => event.employee === employee).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).forEach((event) => {
    const date = cairoDate(new Date(event.occurred_at));
    byDate.set(date, [...(byDate.get(date) ?? []), event]);
  });
  const days: AttendanceDay[] = [];
  byDate.forEach((dayEvents, workDate) => {
    const schedule = resolveScheduleFixture(employee, workDate, schedules);
    const pairs: Array<[AttendanceEvent, AttendanceEvent]> = [];
    let open: AttendanceEvent | null = null;
    dayEvents.forEach((event) => {
      if (event.kind === "CLOCK_IN") open = event;
      else if (open) { pairs.push([open, event]); open = null; }
    });
    const worked = pairs.reduce((sum, pair) => sum + Math.max(0, Math.round((Date.parse(pair[1].occurred_at) - Date.parse(pair[0].occurred_at)) / 60000)), 0);
    const breaks = pairs.slice(1).reduce((sum, pair, index) => sum + Math.max(0, Math.round((Date.parse(pair[0].occurred_at) - Date.parse(pairs[index][1].occurred_at)) / 60000)), 0);
    const first = dayEvents.find((event) => event.kind === "CLOCK_IN")?.occurred_at ?? null;
    const last = [...dayEvents].reverse().find((event) => event.kind === "CLOCK_OUT")?.occurred_at ?? null;
    const firstException = attendanceExceptionForEvent(first ? { id: "derived-first", employee, occurred_at: first, kind: "CLOCK_IN", source: "WEB", recorded_by: employee, created_at: first } : null, workDate, schedule);
    const lastException = attendanceExceptionForEvent(last ? { id: "derived-last", employee, occurred_at: last, kind: "CLOCK_OUT", source: "WEB", recorded_by: employee, created_at: last } : null, workDate, schedule);
    const isHoliday = isPublicHoliday(workDate);
    days.push({ employee, work_date: workDate, first_in_at: first, last_out_at: last, worked_minutes: worked, break_minutes: breaks, status: isHoliday && !worked ? "HOLIDAY" : open ? "INCOMPLETE" : worked ? "PRESENT" : "OPEN", exception: open ? "MISSING_CLOCK_OUT" : firstException === "LATE" ? "LATE" : lastException === "EARLY_LEAVE" ? "EARLY_LEAVE" : "NONE", expected_minutes: schedule?.expected_daily_minutes ?? 0 });
  });
  return days.sort((a, b) => b.work_date.localeCompare(a.work_date));
}

export function mergeAttendanceDays(existing: AttendanceDay[], derived: AttendanceDay[]): AttendanceDay[] {
  const derivedByDate = new Map(derived.map((day) => [day.work_date, day]));
  const merged = existing.map((day) => derivedByDate.get(day.work_date) ?? day);
  const existingDates = new Set(existing.map((day) => day.work_date));
  return [...merged, ...derived.filter((day) => !existingDates.has(day.work_date))].sort((a, b) => b.work_date.localeCompare(a.work_date));
}

export function fixtureAttendanceDays(identity: DemoIdentity): AttendanceDay[] {
  const employee = identity === "employee" ? "e1" : identity === "manager" ? "m1" : "hr1";
  const events = attendanceEventsByIdentity[identity];
  const days = deriveAttendanceDays(events, employee);
  const existing = new Set(days.map((day) => day.work_date));
  let absentAdded = false;
  for (let daysAgo = 1; daysAgo <= 35 && !absentAdded; daysAgo += 1) {
    const date = dateAt(daysAgo, 9);
    const workDate = cairoDate(date);
    if (isEgyptWorkingDay(date) && !existing.has(workDate)) {
      days.push({ employee, work_date: workDate, first_in_at: null, last_out_at: null, worked_minutes: 0, break_minutes: 0, status: "ABSENT_CANDIDATE", exception: "NONE", expected_minutes: resolveScheduleFixture(employee, workDate)?.expected_daily_minutes ?? 0 });
      absentAdded = true;
    }
  }
  return days.sort((a, b) => b.work_date.localeCompare(a.work_date));
}

export function leaveBalanceSummary(balance: LeaveBalance) {
  const adjustments = balance.adjustments.reduce((sum, adjustment) => sum + adjustment.days, 0);
  return { ...balance, adjustments_total: adjustments, remaining: balance.entitlement_days + balance.carry_over_days + adjustments - balance.used_days - balance.pending_days };
}

export function identityEmployeeId(identity: DemoIdentity): string { return identity === "employee" ? "e1" : identity === "manager" ? "m1" : "hr1"; }
export { fixtureNames };

/* ================== Public holidays register + hybrid-aware allocation ================== */

import { employeeDirectory, type EmploymentType, type EmployeeDirectoryEntry } from "./data";

export interface PublicHoliday {
  id: string;
  /** ISO calendar date (Cairo local), e.g. 2026-04-25. */
  date: string;
  name: { ar: string; en: string };
  /** Repeats every year on the same month/day while true. */
  recurring?: boolean;
}

/** ~7 plausible Egyptian public holidays across the current year (2026). */
export const publicHolidays: PublicHoliday[] = [
  { id: "hol-1", date: "2026-01-07", name: { ar: "عيد الميلاد", en: "Coptic Christmas" }, recurring: true },
  { id: "hol-2", date: "2026-04-25", name: { ar: "عيد تحرير سيناء", en: "Sinai Liberation Day" }, recurring: true },
  { id: "hol-3", date: "2026-05-01", name: { ar: "عيد العمال", en: "Labour Day" }, recurring: true },
  { id: "hol-4", date: "2026-06-30", name: { ar: "عيد 30 يونيو", en: "June 30 Revolution Day" }, recurring: true },
  { id: "hol-4b", date: "2026-07-23", name: { ar: "عيد ثورة 23 يوليو", en: "July 23 Revolution Day" }, recurring: true },
  { id: "hol-5", date: "2026-10-06", name: { ar: "عيد القوات المسلحة", en: "Armed Forces Day" }, recurring: true },
  { id: "hol-6", date: "2026-12-25", name: { ar: "عيد الميلاد الغريغوري", en: "Gregorian Christmas" }, recurring: true },
];

/**
 * Does an ISO date fall on a public holiday? Recurring entries match on
 * month/day for later years; dated entries only on their exact date.
 */
export function isPublicHoliday(date: string): boolean {
  const monthDay = date.slice(5); // "MM-DD"
  return publicHolidays.some((holiday) => holiday.recurring
    ? holiday.date.slice(5) === monthDay
    : holiday.date === date);
}

/** All holidays between two ISO dates (inclusive). */
export function publicHolidaysInRange(from: string, to: string): PublicHoliday[] {
  return publicHolidays.filter((holiday) => {
    const dates = [];
    if (holiday.recurring) {
      // Expand a recurring holiday across the range's years on its month/day.
      const fromYear = Number(from.slice(0, 4));
      const toYear = Number(to.slice(0, 4));
      const monthDay = holiday.date.slice(5);
      for (let year = Math.min(fromYear, toYear); year <= Math.max(fromYear, toYear); year += 1) {
        dates.push(`${String(year).padStart(4, "0")}-${monthDay}`);
      }
    } else {
      dates.push(holiday.date);
    }
    return dates.some((date) => date >= from && date <= to);
  });
}

/** Default per-employee-type annual entitlement used by the leave allocation. */
const entitlementByEmploymentType: Record<EmploymentType, number> = {
  FULL: 21,
  PART: 14,
  HYBRID: 21,
  REMOTE: 21,
};

/** Sick-leave default by employment type; part-timers get a prorated pool. */
const sickEntitlementByEmploymentType: Record<EmploymentType, number> = {
  FULL: 14,
  PART: 10,
  HYBRID: 14,
  REMOTE: 14,
};

/**
 * Derive the per-employee leave allocation for a directory entry. The type
 * defaults differ by employment type (a part-timer is not entitled to the
 * same annual days as a full-timer). The three role identities keep the
 * exact balances already in `leaveBalancesByIdentity` — `entryId` is one of
 * their directory ids and their values above are skipped here.
 */
export function defaultLeaveBalancesFor(entry: EmployeeDirectoryEntry, period: string): LeaveBalance[] {
  const identityForFixture = ({ e1: "employee", m1: "manager", hr1: "hr" } as const)[entry.id as "e1" | "m1" | "hr1"];
  if (identityForFixture) return leaveBalancesByIdentity[identityForFixture];
  const annualEntitlement = entitlementByEmploymentType[entry.employment_type];
  const sickEntitlement = sickEntitlementByEmploymentType[entry.employment_type];
  return [
    {
      employee: entry.id,
      leave_type: "ANNUAL",
      period,
      entitlement_days: annualEntitlement,
      carry_over_days: 0,
      carry_over_cap_days: 5,
      carry_over_expiry_months: 3,
      used_days: 0,
      pending_days: 0,
      adjustments: [],
    },
    {
      employee: entry.id,
      leave_type: "SICK",
      period,
      entitlement_days: sickEntitlement,
      carry_over_days: 0,
      carry_over_cap_days: 0,
      carry_over_expiry_months: 0,
      used_days: 0,
      pending_days: 0,
      adjustments: [],
    },
  ];
}

/** Leave balances for the whole directory; identity balances come verbatim. */
export function directoryLeaveBalances(period: string): LeaveBalance[] {
  return employeeDirectory.flatMap((entry) => defaultLeaveBalancesFor(entry, period));
}
