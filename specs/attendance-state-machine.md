---
title: "Heya Fawda? — Attendance State Machine"
status: approved
user_approval_date: 2026-09-11
traceability: [docs/design/attendance-design.md, specs/permission-matrix.md, specs/timesheet-state-machine.md, prd.md, _bmad-output/planning-artifacts/product/product-policy-decisions.md, specs/constitution.md]
---

States

AttendanceDay states: OPEN, PRESENT, ABSENT_CANDIDATE, ABSENT, LEAVE, HOLIDAY, REMOTE, INCOMPLETE.

Transitions

AttendanceDay transitions:
- No attendance record -> OPEN on the first valid CLOCK_IN for an employee's organization-local day.
- OPEN -> PRESENT when an open CLOCK_IN exists or a valid CLOCK_OUT closes a pair and the day has attendance.
- OPEN -> INCOMPLETE when the local day closes with an unmatched CLOCK_IN.
- PRESENT -> INCOMPLETE when the local day closes with an unmatched CLOCK_IN or otherwise incomplete pair.
- ABSENT_CANDIDATE is raised for an unclocked scheduled working day after the day closes; it requires manager/HR confirmation to become ABSENT.
- ABSENT_CANDIDATE -> ABSENT by manager/HR confirmation with a reason and audit.
- ABSENT_CANDIDATE -> LEAVE through an approved leave decision.
- ABSENT_CANDIDATE -> PRESENT through an approved attendance correction that appends the missing event(s).
- A scheduled day with approved leave -> LEAVE; approved leave overrides absence detection and excludes the day from lateness.
- A scheduled holiday -> HOLIDAY.
- A schedule-designated remote day with attendance or approved remote status -> REMOTE.
- Attendance corrections recompute the derived AttendanceDay while preserving its original events and audit history.

CLOCK_IN and CLOCK_OUT

- A day may contain multiple CLOCK_IN/CLOCK_OUT pairs; gaps between consecutive closed pairs represent breaks.
- No two CLOCK_IN events are allowed without an intervening CLOCK_OUT.
- No CLOCK_OUT event is allowed without an open CLOCK_IN.
- Each clock request is idempotent per request id; repeating the same request does not append a second event.
- AttendanceEvent records are immutable and append-only. On-behalf clocking requires the authorized actor, a mandatory reason, and an audit record.

AttendanceCorrection

AttendanceCorrection transitions: SUBMITTED -> APPROVED | REJECTED.

- The employee submits proposed event times and a mandatory reason in SUBMITTED.
- An authorized manager/HR reviewer may approve or reject with an audited actor, timestamp, and reason where required.
- Approval APPENDS new AttendanceEvents; original events are never edited or deleted. The AttendanceDay is then recomputed from the complete event history.
- A correction cannot approve an employee's own attendance, leave, or correction.

LeaveBalance ledger

The LeaveBalance ledger records entitlement, capped and expiring carry-over, pending reservations, usage, adjustments, and forfeiture. The derived remaining balance is entitlement + carried-over days + audited adjustments − used days − pending days.

Transitions and ledger rules:
- Entitlement -> available entitlement at the start of the applicable accrual period.
- Carry-over -> available carried-over entitlement only up to the configured cap; carry-over expires at its configured expiry and the remainder is forfeited with an audited ledger entry.
- Leave request submission -> pending reservation, subject to the applicable balance policy.
- Pending reservation -> used on leave approval; approved leave marks the covered AttendanceDay records LEAVE.
- Pending reservation -> released on rejection or return for correction/resubmission.
- HR-only balance adjustments may grant, correct, carry over, or forfeit days, always with a mandatory reason, actor, timestamp, and audit record. Managers may propose adjustments but do not apply them.
- Forfeiture is explicit and audited; it is never a silent mutation.

Exception resolution

For a finalized exception (LATE, EARLY_LEAVE, MISSING_CLOCK_OUT, or ABSENT_CANDIDATE), an authorized manager/HR actor may resolve it by:
- accept — retain the attendance outcome;
- convert to LEAVE — apply the approved leave outcome and balance rules;
- mark UNPAID — record the unpaid outcome without silently changing the source events; or
- dismiss — close the exception with no attendance-event mutation.

Every resolution records the actor, reason, and timestamp and is audited. The server derives scope and enforces the no-self-approval rule.

All attendance events, derived-day transitions, corrections, leave-ledger entries, reservations, forfeitures, and exception resolutions are transactional, version-checked, idempotent, and audited. Writes use locking to prevent conflicting clock, correction, and balance operations. Organization-timezone local dates determine day boundaries; UTC instants remain authoritative for event times. All lists, details, counts, dashboards, and exports use server-derived scope, and inaccessible objects disclose no existence under the 404 policy.
