# Attendance, Work Schedule & Leave Balance — Design

Status: **draft — awaiting approval**
Supersedes/amends: `specs/permission-matrix.md`, `specs/timesheet-state-machine.md` (amendments listed in §7)

---

## 1. Scope

Add an attendance domain that records **when an employee arrives and leaves**, so the system knows
**which days they attended and for how long**, kept as immutable history. HR/Manager configure
**which days are working days** and **how much leave each employee is allowed**. Attendance then
**feeds the existing timesheet**, replacing hand-typed durations.

Explicitly out of scope for this change: payroll, biometric/geo device integration, shift swapping,
multi-location, overtime pay rates.

---

## 2. Domain model

### 2.1 `AttendanceEvent` (immutable, append-only)
The raw capture. One row per clock action.

| field | notes |
|---|---|
| `id` | |
| `employee` | FK |
| `occurred_at` | **UTC instant** — the authoritative time |
| `kind` | `CLOCK_IN` \| `CLOCK_OUT` |
| `source` | `WEB` (later: `MOBILE`, `KIOSK`, `IMPORT`) |
| `recorded_by` | who performed it (self, or HR on behalf) |
| `created_at` | audit |
| `note` | optional |

Never updated, never deleted. Corrections are **new events**, never edits (§3.5).

### 2.2 `AttendanceDay` (derived, one per employee per local date)
A projection computed from events, materialised so lists are cheap.

| field | notes |
|---|---|
| `employee`, `work_date` | local date in **organization timezone** |
| `first_in_at`, `last_out_at` | UTC instants, nullable |
| `worked_minutes` | Σ (out − in) across pairs, minus nothing (break modelled as pairs) |
| `break_minutes` | Σ gaps between consecutive pairs **inside** the day |
| `status` | `PRESENT` \| `ABSENT` \| `LEAVE` \| `HOLIDAY` \| `REMOTE` \| `INCOMPLETE` |
| `exception` | `LATE` \| `EARLY_LEAVE` \| `MISSING_CLOCK_OUT` \| `NONE` |
| `expected_minutes` | from the schedule in force on that date (§2.3) |
| `justification` | employee-supplied, optional |
| `resolved_by` / `resolved_at` | manager/HR decision, optional |

`INCOMPLETE` = clocked in but never out (or vice versa) and the day has closed.
Recomputed idempotently from events; a version counter guards concurrent writes.

### 2.3 `WorkSchedule` (effective-dated, scoped)
| field | notes |
|---|---|
| `scope` | `ORGANIZATION` \| `TEAM` \| `EMPLOYEE` |
| `target` | FK when scope is TEAM/EMPLOYEE |
| `working_weekdays` | set of 1–7 (e.g. Sun–Thu for Egypt) |
| `expected_start` / `expected_end` | local wall-clock times |
| `expected_daily_minutes` | derived or explicit |
| `grace_minutes` | lateness tolerance before `LATE` is raised |
| `effective_from` / `effective_to` | **effective-dated** — history is never rewritten |

**Resolution precedence:** `EMPLOYEE` > `TEAM` > `ORGANIZATION`, then most-recent `effective_from`.

### 2.4 `LeaveType` and `LeaveBalance`
`LeaveType`: `ANNUAL`, `SICK`, `UNPAID`, `EMERGENCY` — each with `is_paid`, `requires_attachment`,
`counts_against_balance`, `allow_negative`.

`LeaveBalance` per employee per leave type per **accrual period** (year):
`entitlement_days`, `carried_over_days`, `used_days`, `pending_days` (reserved), `adjustments`
(each an audited ± with reason). `remaining = entitlement + carried_over + adjustments − used − pending`.

Balance is **derived**, never stored as a single mutable number — the ledger is the source of truth.

### 2.5 `AttendanceCorrection` and `LeaveAdjustment`
Both are audited, version-checked, reason-mandatory records (§3.5, §3.6).

---

## 3. The cycles

### 3.1 Daily attendance cycle
```
employee CLOCK_IN ──▶ open AttendanceDay (status PRESENT, no out yet)
        │
        ├─ CLOCK_OUT ──▶ close pair, compute worked_minutes
        │
        └─ (another CLOCK_IN) ──▶ second pair — supports real breaks
                                    │
                        end of local day ──▶ finalise AttendanceDay
                                    │
                    no CLOCK_OUT? ──▶ exception = MISSING_CLOCK_OUT, status INCOMPLETE
```
Rules: cannot `CLOCK_IN` twice without an intervening `CLOCK_OUT`; cannot `CLOCK_OUT` without an
open `CLOCK_IN`; both are idempotent per (employee, kind, request id).

### 3.2 Schedule cycle
```
HR/Manager defines WorkSchedule (org-wide, per team, or per employee, effective-dated)
        │
        ▼
system expands the schedule over a period ──▶ expected working days + expected minutes/day
        │
        ▼
drives: ABSENT detection, expected_minutes, lateness, weekly target (replaces the hardcoded 40h)
```
Changing a schedule is **effective-dated**, so a change today does not retroactively relabel last
month's attendance as absent.

### 3.3 Leave cycle (wired into the EXISTING request flow)
```
employee requests leave (existing request type: ANNUAL / SICK)
        │
        ▼
allowance check ──▶ insufficient balance? ──▶ block or flag (policy)
        │
        ▼
PENDING  ──▶ reserves `pending_days` in the balance
        │
        ├─ APPROVED ──▶ pending → used; attendance days in range become status LEAVE
        ├─ REJECTED ──▶ release pending
        └─ RETURNED ──▶ release pending, employee corrects and resubmits
```
Approved leave **overrides** attendance for those dates: the day is `LEAVE`, not `ABSENT`, and is
excluded from absence and lateness.

### 3.4 Exception cycle
```
day finalised ──▶ compare actual vs schedule
        │
        ├─ LATE / EARLY_LEAVE / MISSING_CLOCK_OUT / ABSENT raised
        │
        ▼
employee adds justification (optional)
        │
        ▼
manager/HR resolves: accept · convert to LEAVE · mark UNPAID · dismiss
        │
        ▼
resolution recorded with actor, reason, timestamp (audited)
```

### 3.5 Correction cycle (forgot to clock out — the common real case)
```
employee submits AttendanceCorrection (proposed in/out times + reason)
        │
        ▼
manager/HR approves ──▶ NEW AttendanceEvent(s) appended (never an edit)
        │
        ▼
AttendanceDay recomputed; original events retained; correction linked to the day
```
Mirrors the established `RETURNED → SUBMITTED` correction pattern.

### 3.6 Leave-balance adjustment cycle
```
HR adjusts a balance (grant, carry-over, correction, forfeit) with mandatory reason
        │
        ▼
audited ledger entry ──▶ remaining recalculated
```
Only HR. Managers may *propose*; HR applies. No self-approval by anyone (matrix line 26).

### 3.7 Timesheet derivation cycle  ← the key improvement
```
AttendanceDay records for Mon–Sun
        │
        ▼
weekly timesheet entries PRE-FILLED: duration = worked_minutes, break = break_minutes
        │
        ▼
employee reviews / adds days with no attendance (flagged as manual)
        │
        ▼
SUBMITTED ──▶ existing timesheet state machine, unchanged
```
This replaces hand-typed durations with **captured** ones, and closes the gap where every downstream
number was only as true as what someone typed. Manual entries remain possible but are **flagged**
so a reviewer can see they were not attendance-derived.

### 3.8 Reporting cycle
- Employee: my attendance history, my balance statement, my exceptions
- Manager: team attendance, team exceptions, who is in today, balance per report
- HR: org attendance, org balance ledger, schedule administration, CSV export
  (matrix already grants team CSV to Manager and org CSV to HR)

---

## 4. Permissions — proposed additions to the approved matrix

| Capability | Employee | Manager | HR |
|---|---:|---:|---:|
| Clock self in/out | Yes | Yes | Yes |
| View own attendance history | Yes | Yes | Yes |
| Submit own attendance correction | Yes | Yes | Yes |
| Submit own justification | Yes | Yes | Yes |
| View team attendance/exceptions | No | Direct reports | Yes |
| Resolve team exceptions | No | Direct reports | Yes |
| Approve attendance corrections | No | Direct reports | Yes |
| Set work schedule — own reports | No | Yes | Yes |
| Set work schedule — organization | No | No | Yes |
| Set leave entitlement / adjust balance | No | Propose only | Yes |
| View org attendance + export | No | No | Yes |
| Clock in/out on behalf of an employee | No | No | Yes, reason + audit |
| Approve own attendance/leave/correction | No | No | No |

Consistent with the existing matrix: server-derived scope, 404 for inaccessible objects, HR is not a
superuser, no self-approval anywhere.

---

## 5. Screens & routes (frontend)

| Route | Who | Purpose |
|---|---|---|
| `/attendance` | all | Today's clock-in/out panel + my recent days |
| `/attendance/history` | all | My history, filter by range/status/exception |
| `/attendance/team` | manager, HR | Team board: who's in, exceptions to resolve |
| `/attendance/schedule` | manager, HR | Work days & expected hours (scope-aware) |
| `/attendance/leave-balance` | all (own), HR (all) | Balance statement + ledger |
| `/attendance/corrections` | all (own), manager/HR (queue) | Correction submissions and approvals |

Plus: a **clock-in/out control in the app header** (fastest path, available on every screen),
nav entries under a new group, and i18n for both `ar` and `en`.

---

## 6. Demo boundary

The frontend currently runs on fixtures. Attendance follows the same rules already established:

- clock actions are **session-only, non-persistent**, and labelled as such
- role-based UI gates are **demo affordances, not authorization** — the copy must not imply otherwise
- no real time is captured in demo mode unless explicitly stored in session state
- the identity guard (`activeIdentityRef`) pattern is used for every mutator so a mutation cannot
  land on the wrong identity after a switch

---

## 7. Amendments required to approved specs

1. **`timesheet-state-machine.md`** — add that durations may be **attendance-derived**, and that
   manual entries are flagged. The "daily duration minutes plus unpaid break minutes" input model
   becomes *one of two* sources.
2. **`permission-matrix.md`** — add the §4 rows.
3. **New spec:** `specs/attendance-state-machine.md` — states and transitions for `AttendanceDay`,
   `AttendanceCorrection`, and `LeaveBalance`.

These are `status: approved` documents, so the amendments need explicit sign-off before code.

---

## 8. Resolved decisions

| # | Decision | Resolution |
|---|---|---|
| 1 | Clock granularity | **Multiple in/out pairs** — breaks are real intervals between pairs |
| 2 | Timesheet source | **Attendance replaces manual entry.** Manual duration is permitted only for days with no attendance record, and is **flagged** so a reviewer can see it was not captured |
| 3 | Pending leave | **Reserve on submission** — a PENDING request holds its days; over-balance is blocked |
| 4 | Schedule administration | **HR sets organization-wide; Managers may also set for their direct reports.** Effective-dated; most specific scope wins |
| 5 | Carry-over | **Capped and expiring** — `carry_over_cap_days` per leave type, expiring `carry_over_expiry_months` after period start; the remainder forfeits (audited) |
| 6 | Absence policy | **Candidate absence, not automatic.** An unclocked scheduled day raises `ABSENT_CANDIDATE` + an exception for resolution; it becomes `ABSENT` only on manager/HR confirmation, or `LEAVE`/`PRESENT` via correction. *(Lead decision — reverse it if you prefer auto-absent.)* |

Consequences folded into the model:
- §2.2 already models multiple pairs, so `break_minutes` is derived from the gaps — no separate
  typed break number on attendance-derived days.
- §2.4 `LeaveBalance` gains `carry_over_cap_days` and `carry_over_expiry_months`; forfeiture is an
  audited ledger entry, never a silent mutation.
- §3.2 gains `ABSENT_CANDIDATE` as a pre-confirmation state.
- §3.7 manual entry becomes the **exception path**, always flagged for the reviewer.
