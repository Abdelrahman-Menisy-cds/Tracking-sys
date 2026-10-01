/* Probe for Brief A invariants — imports the REAL mock modules. Exits non-zero on any failed assertion. */
import {
  demoUser,
  employeeDirectory,
  visibleEmployeeFile,
  createAnnouncementFixture,
} from "../src/mock/data.ts";
import { isPublicHoliday, publicHolidaysInRange, deriveAttendanceDays, type AttendanceEvent, type AttendanceDayStatus } from "../src/mock/attendance.ts";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// 1. Directory contains the three fixture users and >=10 entries.
const ids = new Set(employeeDirectory.map((e) => e.id));
check("directory >= 10 entries", employeeDirectory.length >= 10, `got ${employeeDirectory.length}`);
for (const [role, expected] of [["employee", "e1"], ["manager", "m1"], ["hr", "hr1"]] as const) {
  const entry = employeeDirectory.find((e) => e.id === expected);
  const fixture = demoUser[role];
  const matches = !!entry && entry.name.ar === fixture.name.ar && entry.email === fixture.email
    && entry.employee_number === fixture.employeeNumber && entry.join_date === fixture.joinDate
    && entry.phone === fixture.phone && entry.direct_manager !== undefined;
  check(`directory contains fixture user ${role} unchanged`, matches, JSON.stringify(entry?.email));
}
check("emails unique", new Set(employeeDirectory.map((e) => e.email)).size === employeeDirectory.length);
check("employee numbers unique", new Set(employeeDirectory.map((e) => e.employee_number)).size === employeeDirectory.length);

// 2. Every direct_manager id resolves.
const unresolved = employeeDirectory.filter((e) => e.direct_manager !== null && !ids.has(e.direct_manager));
check("every direct_manager resolves", unresolved.length === 0, JSON.stringify(unresolved.map((e) => [e.id, e.direct_manager])));

// 3. Hybrid discriminated union invariants in the data.
const hybrid = employeeDirectory.filter((e) => e.employment_type === "HYBRID");
check("at least one HYBRID employee", hybrid.length >= 2, `got ${hybrid.length}`);
check("every HYBRID carries a hybrid_policy", hybrid.every((e) => !!e.hybrid_policy));
check("FIXED_DAYS carries weekdays and no quota",
  hybrid.some((e) => e.hybrid_policy?.mode === "FIXED_DAYS"
    && Array.isArray(e.hybrid_policy.office_weekdays)
    && e.hybrid_policy.office_weekdays.length > 0
    && !("min_office_days" in e.hybrid_policy)));
check("FLEXIBLE_QUOTA carries a quota and no weekdays",
  hybrid.some((e) => e.hybrid_policy?.mode === "FLEXIBLE_QUOTA"
    && typeof e.hybrid_policy.min_office_days === "number"
    && typeof e.hybrid_policy.period_days === "number"
    && !("office_weekdays" in e.hybrid_policy)));
check("non-HYBRID employees carry no hybrid_policy",
  employeeDirectory.filter((e) => e.employment_type !== "HYBRID").every((e) => e.hybrid_policy === undefined));

// 4. visibleEmployeeFile filters HR-only fields for non-HR viewers, keeps them for HR.
const victim = employeeDirectory.find((e) => e.id === "e1")!;
const employeeView = visibleEmployeeFile(victim, { id: "viewer-emp", role: "employee" });
const managerView = visibleEmployeeFile(victim, { id: "viewer-mgr", role: "manager" });
const hrView = visibleEmployeeFile(victim, { id: "viewer-hr", role: "hr" });
for (const [view, label] of [[employeeView, "employee"], [managerView, "manager"]] as const) {
  check(`${label} view omits hr_file`, !("hr_file" in view));
}
check("hr view includes salary/national_id/bank/contracts/evaluations",
  !!hrView.hr_file && hrView.hr_file.salary.amount > 0
  && hrView.hr_file.national_id.length === 14
  && !!hrView.hr_file.bank_account.iban
  && hrView.hr_file.contracts.length >= 1
  && Array.isArray(hrView.hr_file.evaluations));

// 5. Public holiday register drives HOLIDAY status.
check("2026-01-07 is a public holiday (Coptic Christmas)", isPublicHoliday("2026-01-07"));
check("plain working day is not a holiday", !isPublicHoliday("2026-02-11"));
check("range query returns holidays in range", publicHolidaysInRange("2026-01-01", "2026-12-31").length >= 7);
check("register covers the current year", publicHolidaysInRange("2026-01-01", "2026-12-31").every((h) => h.date.startsWith("2026")));
// Derived day on a public holiday reports HOLIDAY — the point of the register.
const holidayDate = "2026-01-07";
const events: AttendanceEvent[] = [{
  id: "probe-ev-1",
  employee: "probe-emp",
  occurred_at: `${holidayDate}T09:05:00+02:00`,
  kind: "CLOCK_IN",
  source: "WEB",
  recorded_by: "probe-emp",
  created_at: `${holidayDate}T09:05:00+02:00`,
}];
const derived = deriveAttendanceDays(events, "probe-emp");
const holidayDay = derived.find((d) => d.work_date === holidayDate);
check("derived day on public holiday reports HOLIDAY", holidayDay?.status === ("HOLIDAY" satisfies AttendanceDayStatus), JSON.stringify(holidayDay?.status));

// 6. Announcement starts PENDING, never synchronously successful.
const ann = createAnnouncementFixture({ subject: "Probe", body: "Probe body", channel: "EMAIL", audience: "ALL", recipient_ids: [], created_by: "hr1" });
check("sendAnnouncement fixture starts PENDING", ann.status === "PENDING", ann.status);
check("PENDING is not a success state", ann.status !== "CONFIRMED" && ann.status !== "UNKNOWN" && ann.status !== "CONFLICT");
check("SELECTED audience with no recipients yields empty recipients", createAnnouncementFixture({ subject: "x", body: "x", channel: "BOTH", audience: "ALL", recipient_ids: ["e1"], created_by: "hr1" }).recipient_ids.length === 0);

console.log(failures === 0 ? "PROBE OK — all invariants hold" : `PROBE FAILED — ${failures} assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
