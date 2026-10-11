import { dict } from "../i18n/dict";
import { leaveBalanceSummary, type AttendanceDay, type LeaveBalance, type WorkSchedule } from "../mock/attendance";
import type { RequestMock } from "../mock/data";

export type SuggestionVerdict = "APPROVE" | "REJECT" | "REVIEW";
export type SuggestionConfidence = "HIGH" | "MEDIUM" | "LOW";
export type SuggestionReasonKind = "SCHEDULE" | "WORKLOAD" | "COVERAGE" | "BALANCE";
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
}

export type RequestedSpan =
  | { kind: "FULL_DAYS"; days: number }
  | { kind: "PART_DAY"; minutes: number }
  | { kind: "UNKNOWN" };

/** The trailing window the workload and coverage signals look at, in days. */
export const SUGGESTION_WINDOW_DAYS = 14;

/**
 * The demo's requests carry their span in prose, never in structured fields, so this is
 * an explicit pattern table over the wording the fixtures actually use. An unrecognised
 * request yields UNKNOWN — and the caller must show that, not guess a span.
 */
const SPAN_PATTERNS: { pattern: RegExp; span: RequestedSpan }[] = [
  { pattern: /أسبوع|اسبوع/, span: { kind: "FULL_DAYS", days: 5 } },
  { pattern: /3 أيام|ثلاثة أيام/, span: { kind: "FULL_DAYS", days: 3 } },
  { pattern: /يومان|يومين/, span: { kind: "FULL_DAYS", days: 2 } },
  { pattern: /يوم واحد/, span: { kind: "FULL_DAYS", days: 1 } },
  { pattern: /نصف ساعة/, span: { kind: "PART_DAY", minutes: 30 } },
  { pattern: /ساعة واحدة/, span: { kind: "PART_DAY", minutes: 60 } },
];

export function parseDemoRequestSpan(request: RequestMock): RequestedSpan {
  const wording = `${request.title} ${request.details}`;
  return SPAN_PATTERNS.find(({ pattern }) => pattern.test(wording))?.span ?? { kind: "UNKNOWN" };
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

export function suggestReviewDecision({ request, schedules, requesterDays, teamDays, leaveBalances }: ReviewSuggestionInput): DecisionSuggestion {
  const anchor = (request.submitted_at ?? request.created_at).slice(0, 10);
  const start = new Date(`${anchor}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (SUGGESTION_WINDOW_DAYS - 1));
  const from = start.toISOString().slice(0, 10);
  const inWindow = (day: AttendanceDay) => day.work_date >= from && day.work_date <= anchor;

  const ownDays = requesterDays.filter(inWindow);
  const peerDays = teamDays.filter((day) => day.employee !== request.requester_id && inWindow(day));
  const span = parseDemoRequestSpan(request);
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

  // ---- Reasons (2-3, each carrying the numbers it was derived from) ----
  const reasons: SuggestionReason[] = [];
  if (annual) {
    reasons.push(
      remaining === null
        ? reason("BALANCE", "reviewSuggestionBalanceMissing", [fullDays ?? 0])
        : reason("BALANCE", "reviewSuggestionBalance", [remaining, fullDays ?? 0]),
    );
  }
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

  // ---- Verdict: named rules, no hidden weighting ----
  // Positive: the requester is carrying a real load, or the team is in good shape.
  const loaded = expected > 0 && worked >= expected * 1.1;
  const teamHealthy = presenceRatio !== null && presenceRatio >= 0.75;
  const teamThin = presenceRatio !== null && presenceRatio <= 0.25;
  const enoughEvidence = measured.length >= 3 || observed >= 3;

  let verdict: SuggestionVerdict;
  if (shortOfBalance) {
    verdict = "REJECT";
  } else if (span.kind === "FULL_DAYS" && teamThin) {
    verdict = "REJECT";
  } else if (span.kind === "UNKNOWN" || observed === 0) {
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
    const last = reasons[reasons.length - 1];
    reasons[reasons.length - 1] = { ...last, textAr: `${last.textAr} ${dict.ar.reviewSuggestionConflict}`, textEn: `${last.textEn} ${dict.en.reviewSuggestionConflict}` };
  }

  const confidence: SuggestionConfidence =
    verdict === "REVIEW" || span.kind === "UNKNOWN" || !enoughEvidence ? "LOW" : measured.length >= 5 && observed >= 5 ? "HIGH" : "MEDIUM";

  return { verdict, confidence, reasons, evidenceDays: measured.length };
}
