/**
 * Gate: the new-request form.
 *
 * The form no longer takes a typed title: the period comes from the calendar, the details
 * field is the reason, and the send button submits once. What the manager's suggestion then
 * reads must be exactly those picked dates — a prose title is only the seed fixtures' fallback.
 *
 * Run: npx tsx scripts/verify-request-period.ts
 */
import { attendanceSchedules, directoryLeaveBalances, reviewedTeamDaysFor } from "../src/mock/attendance";
import { requestTypes, team, teamRequests, type RequestMock } from "../src/mock/data";
import { allDemoTasks } from "../src/mock/tasks";
import {
  buildRequestTitle,
  draftPeriodFields,
  draftSpan,
  durationState,
  durationText,
  durationWarningText,
  periodKindOf,
  validateDraft,
  type RequestDraft,
} from "../src/app/requestDraft";
import {
  minutesBetween,
  parseDemoRequestSpan,
  requestPeriodText,
  suggestReviewDecision,
  SUGGESTION_WINDOW_DAYS,
  workingDaysBetween,
} from "../src/app/reviewSuggestion";

let failed = 0;
function check(label: string, ok: boolean, value: unknown = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${value === "" ? "" : ` — ${JSON.stringify(value)}`}`);
}

const type = (id: number) => requestTypes.find((item) => item.id === id) ?? requestTypes[0];
const annualType = type(1);
const sickType = type(2);
const correctionType = type(3);
const exitType = type(4);

/* ------------------------------------------------------------------ *
 * 1. The form asks each type for the period it actually needs.
 * ------------------------------------------------------------------ */
check("annual leave → a full-day period", periodKindOf(annualType) === "FULL_DAYS", periodKindOf(annualType));
check("sick leave → a full-day period", periodKindOf(sickType) === "FULL_DAYS", periodKindOf(sickType));
check("timesheet correction → a single date", periodKindOf(correctionType) === "SINGLE_DATE", periodKindOf(correctionType));
check("day exit permit → a clock window", periodKindOf(exitType) === "PART_DAY", periodKindOf(exitType));

/* ------------------------------------------------------------------ *
 * 2. The day and minute maths the picker feeds on.
 * ------------------------------------------------------------------ */
const today = new Date();
const isoDay = (offset: number) => {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const toSunday = (7 - today.getUTCDay()) % 7;
const toFriday = (5 - today.getUTCDay() + 7) % 7;
const sunday = isoDay(toSunday);
const wednesday = isoDay(toSunday + 3);
const friday = isoDay(toFriday);
const saturday = isoDay(toFriday + 1);

check("Sunday → Wednesday counts 4 working days", workingDaysBetween(sunday, wednesday) === 4, workingDaysBetween(sunday, wednesday));
check("a Friday → Saturday range counts 0 working days", workingDaysBetween(friday, saturday) === 0, workingDaysBetween(friday, saturday));
check("a reversed range counts 0 working days", workingDaysBetween(wednesday, sunday) === 0, workingDaysBetween(wednesday, sunday));
check("a single working day counts 1", workingDaysBetween(sunday, sunday) === 1, workingDaysBetween(sunday, sunday));
check("09:00 → 11:00 is 120 minutes", minutesBetween("09:00", "11:00") === 120, minutesBetween("09:00", "11:00"));
check("a reversed clock window is 0 minutes", minutesBetween("11:00", "09:00") === 0, minutesBetween("11:00", "09:00"));
check("an unreadable time is 0 minutes", minutesBetween("", "11:00") === 0, minutesBetween("", "11:00"));

/* ------------------------------------------------------------------ *
 * 3. What the form sends, shows, and refuses.
 * ------------------------------------------------------------------ */
const leaveDraft: RequestDraft = { requestType: annualType, startDate: sunday, endDate: wednesday, startTime: "09:00", endTime: "11:00", reason: "زيارة عائلية" };
const exitDraft: RequestDraft = { requestType: exitType, startDate: sunday, endDate: "", startTime: "10:00", endTime: "12:00", reason: "إجراء بنكي" };
const correctionDraft: RequestDraft = { requestType: correctionType, startDate: sunday, endDate: "", startTime: "09:00", endTime: "11:00", reason: "نسيان تسجيل الخروج" };

check("a leave draft spans the picked working days", JSON.stringify(draftSpan(leaveDraft)) === JSON.stringify({ kind: "FULL_DAYS", days: 4 }), draftSpan(leaveDraft));
check("an exit draft spans its clock window", JSON.stringify(draftSpan(exitDraft)) === JSON.stringify({ kind: "PART_DAY", minutes: 120 }), draftSpan(exitDraft));
check("a correction draft asks for no absence span", draftSpan(correctionDraft) === null, draftSpan(correctionDraft));
check("the leave title reads type + duration", buildRequestTitle(leaveDraft, "ar") === "إجازة اعتيادية — 4 يوم عمل", buildRequestTitle(leaveDraft, "ar"));
check("the leave title is built in the reader's locale", buildRequestTitle(leaveDraft, "en") === "Annual leave — 4 working days", buildRequestTitle(leaveDraft, "en"));
check("the exit title names the type and the window", buildRequestTitle(exitDraft, "ar") === "تصريح خروج أثناء اليوم — 120 دقيقة", buildRequestTitle(exitDraft, "ar"));
check("the correction title names its day", /[٠-٩0-9]/.test(buildRequestTitle(correctionDraft, "ar")) && buildRequestTitle(correctionDraft, "ar").includes(correctionType.name.ar), buildRequestTitle(correctionDraft, "ar"));
check("the live duration matches the span", durationText(leaveDraft, "ar") === "4 يوم عمل", durationText(leaveDraft, "ar"));

/* ------------------------------------------------------------------ *
 * 3b. H13c — the receipt reacts at PICK time (spec §3: the receipt is
 * what the manager will read first; it must speak before any submit).
 * ------------------------------------------------------------------ */
check("a start-only leave reads its single-day state live", durationState({ ...leaveDraft, endDate: "" }) === "SINGLE_DAY", durationState({ ...leaveDraft, endDate: "" }));
check("the single-day state's wording is the contract's wording", durationWarningText({ ...leaveDraft, endDate: "" }, "ar") === "يوم واحد (لم تختر بعد تاريخ نهاية)", durationWarningText({ ...leaveDraft, endDate: "" }, "ar"));
check("a weekend-only span warns of zero working days", durationState({ ...leaveDraft, startDate: friday, endDate: saturday }) === "NO_WORKING_DAY", durationState({ ...leaveDraft, startDate: friday, endDate: saturday }));
check("a reversed span has its own reversed state", durationState({ ...leaveDraft, endDate: isoDay(toSunday - 1) }) === "REVERSED", durationState({ ...leaveDraft, endDate: isoDay(toSunday - 1) }));
check("the reversed span's live warning is the submit gate's own sentence", durationWarningText({ ...leaveDraft, endDate: isoDay(toSunday - 1) }, "ar") === "تاريخ النهاية قبل تاريخ البداية.", durationWarningText({ ...leaveDraft, endDate: isoDay(toSunday - 1) }, "ar"));
check("the zero-working-day warning carries the submit gate's sentence", durationWarningText({ ...leaveDraft, startDate: friday, endDate: saturday }, "ar") === "المدة المختارة ما فيها يوم عمل.", durationWarningText({ ...leaveDraft, startDate: friday, endDate: saturday }, "ar"));
check("an empty exit clock reads its empty state live", durationState({ ...exitDraft, startTime: "", endTime: "" }) === "EMPTY_CLOCK", durationState({ ...exitDraft, startTime: "", endTime: "" }));
check("a reversed exit clock warns before any submit", durationState({ ...exitDraft, startTime: "12:00", endTime: "10:00" }) === "REVERSED_CLOCK" && durationWarningText({ ...exitDraft, startTime: "12:00", endTime: "10:00" }, "ar") === "وقت النهاية لازم يكون بعد وقت البداية.", durationWarningText({ ...exitDraft, startTime: "12:00", endTime: "10:00" }, "ar"));
check("a counted exit span reports no warning", durationWarningText(exitDraft, "ar") === null, durationWarningText(exitDraft, "ar"));
check("a complete leave reports no warning", durationWarningText(leaveDraft, "ar") === null, durationWarningText(leaveDraft, "ar"));
check("a correction reads no receipt line at all", durationState(correctionDraft) === null && durationWarningText(correctionDraft, "ar") === null, [durationState(correctionDraft), durationWarningText(correctionDraft, "ar")]);

check("a missing period is refused", validateDraft({ ...leaveDraft, startDate: "" }, "ar")?.field === "period", validateDraft({ ...leaveDraft, startDate: "" }, "ar"));
check("a reversed range is refused", validateDraft({ ...leaveDraft, endDate: isoDay(toSunday - 1) }, "ar")?.field === "period", validateDraft({ ...leaveDraft, endDate: isoDay(toSunday - 1) }, "ar"));
check("a weekend-only range is refused", validateDraft({ ...leaveDraft, startDate: friday, endDate: saturday }, "ar")?.field === "period", validateDraft({ ...leaveDraft, startDate: friday, endDate: saturday }, "ar"));
check("a reversed clock window is refused", validateDraft({ ...exitDraft, startTime: "12:00", endTime: "10:00" }, "ar")?.field === "clock", validateDraft({ ...exitDraft, startTime: "12:00", endTime: "10:00" }, "ar"));
check("a complete leave draft is accepted", validateDraft(leaveDraft, "ar") === null, validateDraft(leaveDraft, "ar"));
check("a complete exit draft is accepted", validateDraft(exitDraft, "ar") === null, validateDraft(exitDraft, "ar"));
check("a correction needs only its date", validateDraft(correctionDraft, "ar") === null, validateDraft(correctionDraft, "ar"));

const leaveFields = draftPeriodFields(leaveDraft);
check("a leave sends its dates and no clock", leaveFields.startDate === sunday && leaveFields.endDate === wednesday && leaveFields.startTime === null && leaveFields.endTime === null, leaveFields);
const exitFields = draftPeriodFields(exitDraft);
check("an exit sends its date and its clock", exitFields.startDate === sunday && exitFields.endDate === sunday && exitFields.startTime === "10:00" && exitFields.endTime === "12:00", exitFields);
check("a correction sends only the day", draftPeriodFields(correctionDraft).endDate === sunday, draftPeriodFields(correctionDraft));

/* ------------------------------------------------------------------ *
 * 4. What the manager's suggestion reads: the picked period, not the wording.
 * ------------------------------------------------------------------ */
const now = new Date().toISOString();
const base = teamRequests[0];
const datedLeave: RequestMock = {
  ...base,
  title: "إجازة اعتيادية — أسبوع",
  details: "زيارة عائلية",
  start_date: sunday,
  end_date: wednesday,
  start_time: null,
  end_time: null,
  created_at: now,
  submitted_at: now,
};
const datedExit: RequestMock = { ...datedLeave, request_type: exitType, start_time: "10:00", end_time: "12:00" };

check("the picked dates beat the title's wording", JSON.stringify(parseDemoRequestSpan(datedLeave)) === JSON.stringify({ kind: "FULL_DAYS", days: 4 }), parseDemoRequestSpan(datedLeave));
check("the picked clock beats the title's wording", JSON.stringify(parseDemoRequestSpan(datedExit)) === JSON.stringify({ kind: "PART_DAY", minutes: 120 }), parseDemoRequestSpan(datedExit));
check("an undated seed fixture still parses its wording", JSON.stringify(parseDemoRequestSpan(base)) === JSON.stringify({ kind: "FULL_DAYS", days: 5 }), parseDemoRequestSpan(base));
check("the period reads back as the picked dates", requestPeriodText(datedLeave, "ar")?.includes("/") === true, requestPeriodText(datedLeave, "ar"));
check("a part-day period reads back with its clock", requestPeriodText(datedExit, "ar")?.includes("10:00") === true, requestPeriodText(datedExit, "ar"));
check("an undated request has no period to read", requestPeriodText(base, "ar") === null, requestPeriodText(base, "ar"));

const suggest = (request: RequestMock) => suggestReviewDecision({
  request,
  schedules: attendanceSchedules,
  requesterDays: reviewedTeamDaysFor([request.requester_id]),
  teamDays: reviewedTeamDaysFor(team.map((member) => member.id)),
  leaveBalances: directoryLeaveBalances(now.slice(0, 4)),
  tasks: allDemoTasks,
  departmentIds: team.filter((member) => member.id !== request.requester_id).map((member) => member.id),
  departmentName: team.find((member) => member.id === request.requester_id)?.department ?? null,
});

const exitSuggestion = suggest(datedExit);
const coverage = exitSuggestion.reasons.find((reason) => reason.kind === "COVERAGE")?.textAr ?? "";
check("the suggestion reports the picked clock window", coverage.includes("120 دقيقة"), coverage || exitSuggestion.reasons.map((reason) => reason.textAr).join(" | "));
check("the suggestion still answers with a verdict", ["APPROVE", "REJECT", "REVIEW"].includes(exitSuggestion.verdict), exitSuggestion.verdict);
check("the suggestion windows the last 14 days", SUGGESTION_WINDOW_DAYS === 14, SUGGESTION_WINDOW_DAYS);

if (failed) {
  console.log(`\nREQUEST PERIOD GATE FAILED (${failed})`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
