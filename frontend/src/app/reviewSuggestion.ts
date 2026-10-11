import { dict } from "../i18n/dict";
import { leaveBalanceSummary, type AttendanceDay, type LeaveBalance, type WorkSchedule } from "../mock/attendance";
import type { RequestMock } from "../mock/data";
import { formatDate } from "./useMockList";
import type { TaskMock, TaskStatus } from "../mock/tasks";

export type SuggestionVerdict = "APPROVE" | "REJECT" | "REVIEW";
export type SuggestionConfidence = "HIGH" | "MEDIUM" | "LOW";
export type SuggestionReasonKind = "SCHEDULE" | "WORKLOAD" | "COVERAGE" | "BALANCE" | "TASKS" | "DEPARTMENT";
export interface SuggestionReason {
  kind: SuggestionReasonKind;
  textAr: string;
  textEn: string;
}
export interface DecisionSuggestion {
  verdict: SuggestionVerdict;
  confidence: SuggestionConfidence;
  reasons: SuggestionReason[];
  /** How many days of evidence the workload signal actually saw. */
  evidenceDays: number;
}
export interface ReviewSuggestionInput {
  request: RequestMock;
  schedules: WorkSchedule[];
  requesterDays: AttendanceDay[];
  teamDays: AttendanceDay[];
  leaveBalances: LeaveBalance[];
  /** Open work, so the request can be weighed against real deadlines. */
  tasks: TaskMock[];
  /** Directory ids of the rest of the requester's department. */
  departmentIds: string[];
  /** The requester's department, named in the reason. */
  departmentName: { ar: string; en: string } | null;
}

export type RequestedSpan =
  | { kind: "FULL_DAYS"; days: number }
  | { kind: "PART_DAY"; minutes: number }
  | { kind: "UNKNOWN" };

/** The trailing window the workload and coverage signals look at, in days. */
export const SUGGESTION_WINDOW_DAYS = 14;

/**
 * The demo's seed requests carry their span in prose, never in structured fields, so this is
 * an explicit pattern table over the wording the fixtures actually use. It is the fallback
 * only: a request raised from the dated form states its own period, and that period wins.
 */
const SPAN_PATTERNS: { pattern: RegExp; span: RequestedSpan }[] = [
  { pattern: /أسبوع|اسبوع/, span: { kind: "FULL_DAYS", days: 5 } },
  { pattern: /3 أيام|ثلاثة أيام/, span: { kind: "FULL_DAYS", days: 3 } },
  { pattern: /يومان|يومين/, span: { kind: "FULL_DAYS", days: 2 } },
  { pattern: /يوم واحد/, span: { kind: "FULL_DAYS", days: 1 } },
  { pattern: /نصف ساعة/, span: { kind: "PART_DAY", minutes: 30 } },
  { pattern: /ساعة واحدة/, span: { kind: "PART_DAY", minutes: 60 } },
];

/** The working week the demo falls back to when no schedule is in hand (Egypt: Sun–Thu). */
export const DEFAULT_WORKING_WEEKDAYS = [0, 1, 2, 3, 4];

/**
 * Working days between two ISO dates, inclusive, honouring the employee's working weekdays.
 * A range that covers no working day (a weekend, a reversed range) counts as 0 days.
 */
export function workingDaysBetween(start: string, end: string, workingWeekdays: number[] = DEFAULT_WORKING_WEEKDAYS): number {
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from) return 0;
  let days = 0;
  for (const cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (workingWeekdays.includes(cursor.getUTCDay())) days += 1;
  }
  return days;
}

/** Minutes between two wall-clock times on the same day; 0 when either is unusable. */
export function minutesBetween(startTime: string, endTime: string): number {
  const parse = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  };
  const from = parse(startTime);
  const to = parse(endTime);
  if (from === null || to === null || to <= from) return 0;
  return to - from;
}

/**
 * A request's span: the dates it was raised with when it has them, the fixture prose otherwise.
 * An unrecognised request yields UNKNOWN — and the caller must show that, not guess a span.
 */
export function parseDemoRequestSpan(request: RequestMock, workingWeekdays: number[] = DEFAULT_WORKING_WEEKDAYS): RequestedSpan {
  if (request.start_date) {
    const minutes = request.start_time && request.end_time ? minutesBetween(request.start_time, request.end_time) : 0;
    if (minutes > 0) return { kind: "PART_DAY", minutes };
    const days = workingDaysBetween(request.start_date, request.end_date ?? request.start_date, workingWeekdays);
    if (days > 0) return { kind: "FULL_DAYS", days };
  }
  const wording = `${request.title} ${request.details}`;
  return SPAN_PATTERNS.find(({ pattern }) => pattern.test(wording))?.span ?? { kind: "UNKNOWN" };
}

/** The picked period, written for a reader: the dates, plus the clock window of a part-day. */
export function requestPeriodText(request: RequestMock, locale: "ar" | "en"): string | null {
  if (!request.start_date) return null;
  const day = formatDate(request.start_date, locale);
  if (request.start_time && request.end_time) {
    return locale === "ar"
      ? `${day} · من ${request.start_time} إلى ${request.end_time}`
      : `${day} · ${request.start_time}–${request.end_time}`;
  }
  const lastDay = request.end_date && request.end_date !== request.start_date ? formatDate(request.end_date, locale) : null;
  return lastDay ? `${day} – ${lastDay}` : day;
}

/** The demo's annual-leave type, matched on its Arabic name first (the fixture's source of truth). */
function isAnnualLeave(request: RequestMock): boolean {
  const name = request.request_type.name;
  return name.ar.includes("اعتيادية") || /annual/i.test(name.en);
}

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}`;

function fill(template: string, values: (string | number)[]) {
  return values.reduce<string>((text, value) => (text.includes("%s") ? text.replace("%s", String(value)) : text), template);
}

/** Keys whose value is a literal string — the dictionary also holds a couple of helpers. */
type StringKey = { [K in keyof typeof dict.ar]: (typeof dict.ar)[K] extends string ? K : never }[keyof typeof dict.ar];

function reason(kind: SuggestionReasonKind, key: StringKey, values: (string | number)[], valuesEn: (string | number)[] = values): SuggestionReason {
  return { kind, textAr: fill(dict.ar[key], values), textEn: fill(dict.en[key], valuesEn) };
}

export function suggestReviewDecision({ request, schedules, requesterDays, teamDays, leaveBalances, tasks, departmentIds, departmentName }: ReviewSuggestionInput): DecisionSuggestion {
  const anchor = (request.submitted_at ?? request.created_at).slice(0, 10);
  const start = new Date(`${anchor}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (SUGGESTION_WINDOW_DAYS - 1));
  const from = start.toISOString().slice(0, 10);
  const inWindow = (day: AttendanceDay) => day.work_date >= from && day.work_date <= anchor;

  const ownDays = requesterDays.filter(inWindow);
  const peerDays = teamDays.filter((day) => day.employee !== request.requester_id && inWindow(day));
  const spanText = (locale: "ar" | "en") =>
    span.kind === "FULL_DAYS"
      ? locale === "ar" ? `${span.days} أيام عمل` : `${span.days} working days`
      : span.kind === "PART_DAY"
        ? locale === "ar" ? `${span.minutes} دقيقة` : `${span.minutes} minutes`
        : dict[locale].reviewSuggestionUnknownSpan;

  // ---- Schedule: the requester's own schedule against the organisation's ----
  const active = schedules.filter((schedule) => schedule.effective_from <= anchor && (!schedule.effective_to || schedule.effective_to >= anchor));
  const organization = active.find((schedule) => schedule.scope === "ORGANIZATION");
  const own = active.find((schedule) => schedule.scope === "EMPLOYEE" && schedule.target === request.requester_id);
  const differs = Boolean(
    own && organization &&
      (own.expected_start !== organization.expected_start ||
        own.expected_end !== organization.expected_end ||
        own.expected_daily_minutes !== organization.expected_daily_minutes ||
        [...own.working_weekdays].sort().join() !== [...organization.working_weekdays].sort().join()),
  );
  const effective = own ?? organization;
  // The span: the dates the request was raised with, or the seed fixture's own wording.
  const span = parseDemoRequestSpan(request, effective?.working_weekdays);

  // ---- Workload: what the requester actually worked against what was expected ----
  const measured = ownDays.filter((day) => day.status !== "LEAVE" && day.status !== "HOLIDAY" && day.expected_minutes > 0);
  const worked = measured.reduce((sum, day) => sum + day.worked_minutes, 0);
  const expected = measured.reduce((sum, day) => sum + day.expected_minutes, 0);
  const exceptions = measured.filter(
    (day) => day.status === "INCOMPLETE" || day.exception === "LATE" || day.exception === "EARLY_LEAVE" || day.exception === "MISSING_CLOCK_OUT",
  ).length;

  // ---- Coverage: how the rest of the team actually turned up in the same window ----
  // Someone who clocked in turned up, even if the day was never closed — an unclosed day is
  // a data gap to report, not an absence. A "short" day means a material shortfall beyond the
  // scheduled unpaid break, not the difference between 09:00–17:00 and 09:00–13:00 + 14:00–17:00.
  const completeDays = peerDays.filter((day) => day.status === "PRESENT" || day.status === "REMOTE");
  const unclosed = peerDays.filter((day) => day.status === "INCOMPLETE");
  const short = completeDays.filter((day) => day.expected_minutes > 0 && day.worked_minutes <= day.expected_minutes - 90);
  const full = completeDays.length - short.length;
  const away = peerDays.filter((day) => day.status === "ABSENT" || day.status === "LEAVE" || day.status === "ABSENT_CANDIDATE").length;
  const turnedUp = completeDays.length + unclosed.length;
  const observed = turnedUp + away;
  const presenceRatio = observed === 0 ? null : turnedUp / observed;

  // ---- Balance: only annual leave draws on a tracked entitlement ----
  const annual = isAnnualLeave(request);
  const balance = leaveBalances.find((item) => item.employee === request.requester_id && item.leave_type === "ANNUAL" && item.period === anchor.slice(0, 4));
  const remaining = balance ? leaveBalanceSummary(balance).remaining : null;
  const fullDays = span.kind === "FULL_DAYS" ? span.days : null;
  const shortOfBalance = annual && fullDays !== null && (remaining === null || remaining < fullDays);

  // ---- Tasks: what the request collides with, and whether the department can absorb it ----
  // The demo's requests carry no dates, so the request is read as starting at its own anchor:
  // a full-day span covers that many days, a part-day is that same day.
  const openStatuses: TaskStatus[] = ["OPEN", "IN_PROGRESS"];
  const spanEnd = (() => {
    const end = new Date(`${anchor}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + (span.kind === "FULL_DAYS" ? span.days : 0));
    return end.toISOString().slice(0, 10);
  })();
  const isOpen = (task: TaskMock) => openStatuses.includes(task.status);
  const dueInSpan = (task: TaskMock) => Boolean(task.due_date && task.due_date >= anchor && task.due_date <= spanEnd);
  const isOverdue = (task: TaskMock) => Boolean(task.due_date && task.due_date < anchor);

  const mine = tasks.filter((task) => task.assignee === request.requester_id && isOpen(task));
  const mineDue = mine.filter(dueInSpan);
  const mineOverdue = mine.filter(isOverdue);
  const mineHigh = mineDue.filter((task) => task.priority === "HIGH").length;

  // The department's pool is the rest of the team's open work plus whatever is routed to the
  // manager and still unassigned — work that exists and has nobody on it.
  const departmentPool = tasks.filter(
    (task) =>
      isOpen(task) &&
      task.assignee !== request.requester_id &&
      (task.assignee === null ? task.routed_to_manager !== null : departmentIds.includes(task.assignee)),
  );
  const departmentDue = departmentPool.filter(dueInSpan);
  const departmentUnassigned = departmentPool.filter((task) => task.assignee === null).length;

  // ---- Reasons (the decision-bearing signals first, each carrying its numbers) ----
  const reasons: SuggestionReason[] = [];
  if (annual) {
    reasons.push(
      remaining === null
        ? reason("BALANCE", "reviewSuggestionBalanceMissing", [fullDays ?? 0])
        : reason("BALANCE", "reviewSuggestionBalance", [remaining, fullDays ?? 0]),
    );
  }
  // The requester's own deadlines come first: this is the signal a manager acts on.
  reasons.push(
    mine.length === 0
      ? reason("TASKS", "reviewSuggestionRequesterTasksNone", [0])
      : reason("TASKS", "reviewSuggestionRequesterTasks", [mine.length, mineDue.length, mineOverdue.length, mineHigh]),
  );
  reasons.push(
    reason(
      "DEPARTMENT",
      "reviewSuggestionDepartmentTasks",
      [departmentName?.ar ?? dict.ar.reviewSuggestionDepartmentFallback, departmentPool.length, departmentDue.length, departmentUnassigned],
      [departmentName?.en ?? dict.en.reviewSuggestionDepartmentFallback, departmentPool.length, departmentDue.length, departmentUnassigned],
    ),
  );
  if (differs && own && organization) {
    reasons.push(
      reason("SCHEDULE", "reviewSuggestionScheduleDifference", [
        own.expected_start, own.expected_end, own.expected_daily_minutes,
        organization.expected_start, organization.expected_end, organization.expected_daily_minutes,
        own.working_weekdays.length, organization.working_weekdays.length,
      ]),
    );
  } else if (effective) {
    reasons.push(
      reason("SCHEDULE", "reviewSuggestionScheduleSame", [
        effective.expected_start, effective.expected_end, effective.expected_daily_minutes, organization?.expected_daily_minutes ?? effective.expected_daily_minutes,
      ]),
    );
  }
  reasons.push(reason("WORKLOAD", "reviewSuggestionWorkload", [SUGGESTION_WINDOW_DAYS, hours(worked), hours(expected), measured.length, exceptions]));
  reasons.push(
    reason(
      "COVERAGE",
      "reviewSuggestionCoverage",
      [spanText("ar"), SUGGESTION_WINDOW_DAYS, full, away, short.length + unclosed.length, observed],
      [spanText("en"), SUGGESTION_WINDOW_DAYS, full, away, short.length + unclosed.length, observed],
    ),
  );

  // Every signal the engine used is shown, in a declared order: a decision dialog that hides
  // evidence is worse than a longer one, and the order is declared here, not by push order.
  const SHOWN_KINDS: SuggestionReasonKind[] = ["BALANCE", "TASKS", "DEPARTMENT", "WORKLOAD", "COVERAGE", "SCHEDULE"];
  const shown = SHOWN_KINDS.flatMap((kind) => reasons.filter((item) => item.kind === kind));

  // ---- Verdict: named rules, no hidden weighting ----
  // Positive: the requester is carrying a real load, or the team is in good shape.
  const loaded = expected > 0 && worked >= expected * 1.1;
  const teamHealthy = presenceRatio !== null && presenceRatio >= 0.75;
  const teamThin = presenceRatio !== null && presenceRatio <= 0.25;
  const enoughEvidence = measured.length >= 3 || observed >= 3;
  // A deadline inside the requested span is what a manager actually acts on: a high-priority
  // one always needs a human, and any collision on planned annual leave does too. A sick day
  // cannot be rescheduled around a deadline, so there the collision stays a reported fact.
  const severeCollision = mineHigh > 0 || (mineDue.length > 0 && annual);

  let verdict: SuggestionVerdict;
  if (shortOfBalance) {
    verdict = "REJECT";
  } else if (span.kind === "FULL_DAYS" && teamThin) {
    verdict = "REJECT";
  } else if (span.kind === "UNKNOWN" || observed === 0) {
    verdict = "REVIEW";
  } else if (severeCollision) {
    verdict = "REVIEW";
  } else if (teamHealthy && (loaded || measured.length >= 3)) {
    verdict = "APPROVE";
  } else if (loaded && !teamHealthy) {
    // Carrying a load, but the team is neither healthy nor critical: a human should look.
    verdict = "REVIEW";
  } else {
    verdict = "REVIEW";
  }

  const conflict = loaded && presenceRatio !== null && presenceRatio < 0.75;
  if (conflict && verdict !== "REJECT") {
    const index = Math.max(0, shown.findIndex((item) => item.kind === "COVERAGE"));
    shown[index] = { ...shown[index], textAr: `${shown[index].textAr} ${dict.ar.reviewSuggestionConflict}`, textEn: `${shown[index].textEn} ${dict.en.reviewSuggestionConflict}` };
  }

  const confidence: SuggestionConfidence =
    verdict === "REVIEW" || span.kind === "UNKNOWN" || !enoughEvidence ? "LOW" : measured.length >= 5 && observed >= 5 ? "HIGH" : "MEDIUM";

  return { verdict, confidence, reasons: shown, evidenceDays: measured.length };
}
