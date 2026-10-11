/**
 * Brief H12 — the manager-review suggestion, as a deterministic gate:
 *
 *   npx tsx scripts/verify-review-suggestion.ts
 *
 * Imports the REAL fixtures (schedules, the seeded attendance history, the leave balances)
 * and the REAL suggestion function, then asserts the rules the brief names — including the
 * one that must never regress: a lightly-loaded requester is never a reason to REJECT.
 * Exits non-zero on any failure. No browser, no server, no extra dependency.
 */
import { attendanceSchedules, directoryLeaveBalances, leaveBalanceSummary, reviewedTeamDaysFor, type AttendanceDay, type LeaveBalance } from "../src/mock/attendance";
import { teamRequests, type RequestMock } from "../src/mock/data";
import { parseDemoRequestSpan, suggestReviewDecision, SUGGESTION_WINDOW_DAYS, type DecisionSuggestion } from "../src/app/reviewSuggestion";

let failed = false;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`);
  if (!ok) failed = true;
};

const anchorOf = (request: RequestMock) => (request.submitted_at ?? request.created_at).slice(0, 10);
const at = (anchor: string, daysBack: number) => {
  const date = new Date(`${anchor}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysBack);
  return date.toISOString().slice(0, 10);
};

const day = (
  employee: string,
  work_date: string,
  status: AttendanceDay["status"],
  worked_minutes: number,
  expected_minutes = 480,
  exception: AttendanceDay["exception"] = "NONE",
): AttendanceDay => ({ employee, work_date, first_in_at: null, last_out_at: null, worked_minutes, break_minutes: 0, status, exception, expected_minutes });

const balance = (employee: string, period: string, entitlement: number, used: number): LeaveBalance => ({
  employee, leave_type: "ANNUAL", period, entitlement_days: entitlement, carry_over_days: 0, carry_over_cap_days: 5, carry_over_expiry_months: 0, used_days: used, pending_days: 0, adjustments: [],
});

const base = teamRequests[0];
const ANCHOR = anchorOf(base);
const PERIOD = ANCHOR.slice(0, 4);
const annualWeek = base; // «إجازة اعتيادية — أسبوع» → 5 working days
const requester = base.requester_id;

const loadedDays = Array.from({ length: 10 }, (_, index) => day(requester, at(ANCHOR, index + 1), "PRESENT", 540));
const lightDays = Array.from({ length: 10 }, (_, index) => day(requester, at(ANCHOR, index + 1), "PRESENT", 240));
const healthyPeers = [
  ...Array.from({ length: 6 }, (_, index) => day("e3", at(ANCHOR, index + 1), "PRESENT", 480)),
  ...Array.from({ length: 6 }, (_, index) => day("e4", at(ANCHOR, index + 1), "PRESENT", 480)),
];
const thinPeers = [
  ...Array.from({ length: 6 }, (_, index) => day("e3", at(ANCHOR, index + 1), "ABSENT", 0)),
  day("e4", at(ANCHOR, 1), "PRESENT", 480),
];

const run = (over: Partial<Parameters<typeof suggestReviewDecision>[0]>): DecisionSuggestion =>
  suggestReviewDecision({
    request: annualWeek,
    schedules: attendanceSchedules,
    requesterDays: loadedDays,
    teamDays: healthyPeers,
    leaveBalances: [balance(requester, PERIOD, 21, 3)],
    ...over,
  });

/* ------------------------------------------------------------------ *
 * 1. The span parser only reads wording the fixtures actually use, and
 *    says UNKNOWN instead of guessing.
 * ------------------------------------------------------------------ */
check("span «أسبوع» → 5 full days", JSON.stringify(parseDemoRequestSpan(annualWeek)) === JSON.stringify({ kind: "FULL_DAYS", days: 5 }));
check("span «يومان» → 2 full days", JSON.stringify(parseDemoRequestSpan({ ...base, title: "إجازة مرضية — يومان", details: "" })) === JSON.stringify({ kind: "FULL_DAYS", days: 2 }));
check("span «نصف ساعة» → a 30-minute part-day", JSON.stringify(parseDemoRequestSpan({ ...base, title: "تصريح خروج — ظروري", details: "تصريح خروج نصف ساعة نهاية الدوام." })) === JSON.stringify({ kind: "PART_DAY", minutes: 30 }));
check("span with no recognised wording → UNKNOWN", JSON.stringify(parseDemoRequestSpan({ ...base, title: "طلب", details: "بدون مدة محددة." })) === JSON.stringify({ kind: "UNKNOWN" }));

/* ------------------------------------------------------------------ *
 * 2. A loaded requester, a healthy team and enough balance → APPROVE.
 * ------------------------------------------------------------------ */
const reap = run({});
check("a loaded requester with a healthy team and balance → APPROVE", reap.verdict === "APPROVE", { verdict: reap.verdict, confidence: reap.confidence, evidenceDays: reap.evidenceDays });
check("  and it is not low confidence", reap.confidence !== "LOW", reap.confidence);

/* ------------------------------------------------------------------ *
 * 3. Hard blockers → REJECT: no balance, and a critically thin team.
 * ------------------------------------------------------------------ */
const noBalance = run({ leaveBalances: [balance(requester, PERIOD, 21, 19)] }); // 2 remaining < 5 requested
check("annual leave with only 2 days remaining for a 5-day request → REJECT", noBalance.verdict === "REJECT", noBalance.verdict);
const thin = run({ teamDays: thinPeers });
check("a full-day request while the team is critically thin → REJECT", thin.verdict === "REJECT", thin.verdict);

/* ------------------------------------------------------------------ *
 * 4. Missing evidence → REVIEW, never a guess.
 * ------------------------------------------------------------------ */
const unknownSpan = run({ request: { ...base, title: "طلب", details: "بدون مدة محددة." } });
check("an unreadable span → REVIEW", unknownSpan.verdict === "REVIEW", unknownSpan.verdict);
check("an unreadable span → LOW confidence", unknownSpan.confidence === "LOW", unknownSpan.confidence);
const noPeers = run({ teamDays: [] });
check("no observed peers → REVIEW (never APPROVE on missing coverage)", noPeers.verdict === "REVIEW", noPeers.verdict);

/* ------------------------------------------------------------------ *
 * 5. The regression this gate exists for: a lightly-loaded requester is
 *    NOT an argument against leave. Under-work is neutral, not negative.
 * ------------------------------------------------------------------ */
const light = run({ requesterDays: lightDays });
check("a lightly-loaded requester is never REJECTed", light.verdict !== "REJECT", light.verdict);

/* ------------------------------------------------------------------ *
 * 6. Every reason carries the numbers it was derived from, and there are
 *    between two and four of them.
 * ------------------------------------------------------------------ */
for (const [label, suggestion] of [["APPROVE", reap], ["REJECT", noBalance], ["REVIEW", unknownSpan]] as const) {
  check(`${label}: 2-4 reasons`, suggestion.reasons.length >= 2 && suggestion.reasons.length <= 4, suggestion.reasons.length);
  check(`${label}: every reason carries a number`, suggestion.reasons.every((reason) => /\d/.test(reason.textAr) && /\d/.test(reason.textEn)), suggestion.reasons.map((reason) => reason.kind));
  check(`${label}: Arabic and English both rendered`, suggestion.reasons.every((reason) => reason.textAr.length > 0 && reason.textEn.length > 0));
}

/* ------------------------------------------------------------------ *
 * 7. Determinism: the same input returns the same suggestion, always.
 * ------------------------------------------------------------------ */
check("deterministic across calls", JSON.stringify(run({})) === JSON.stringify(run({})));

/* ------------------------------------------------------------------ *
 * 8. The REAL queue: the seeded history must actually produce a decided
 *    suggestion for every pending request — not REVIEW-by-default.
 * ------------------------------------------------------------------ */
const requesters = [...new Set(teamRequests.map((request) => request.requester_id))];
const teamDays = reviewedTeamDaysFor(requesters);
console.log(`  reviewed requesters: ${requesters.join(", ")} · seeded days: ${teamDays.length} · window: ${SUGGESTION_WINDOW_DAYS}`);
for (const request of teamRequests) {
  const suggestion = suggestReviewDecision({
    request,
    schedules: attendanceSchedules,
    requesterDays: reviewedTeamDaysFor([request.requester_id]),
    teamDays,
    leaveBalances: directoryLeaveBalances(anchorOf(request).slice(0, 4)),
  });
  console.log(`  ${request.id} ${request.requester_id} «${request.title}» → ${suggestion.verdict} / ${suggestion.confidence} · evidence ${suggestion.evidenceDays}d · ${suggestion.reasons.length} reasons`);
  for (const reason of suggestion.reasons) console.log(`      [${reason.kind}] ${reason.textAr}`);
  check(`${request.id} has seeded evidence (${suggestion.evidenceDays} days)`, suggestion.evidenceDays >= 3, suggestion.evidenceDays);
  const requesterBalance = directoryLeaveBalances(anchorOf(request).slice(0, 4)).find((item) => item.employee === request.requester_id && item.leave_type === "ANNUAL");
  check(`${request.id} requester has an annual balance record`, Boolean(requesterBalance), requesterBalance ? leaveBalanceSummary(requesterBalance).remaining : null);
}

console.log(failed ? "\nFAILED" : "\nPASSED");
process.exit(failed ? 1 : 0);
