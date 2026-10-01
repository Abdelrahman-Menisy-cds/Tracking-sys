import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { t as translate, type Dict } from "../i18n/dict";
import { Banner, EmptyState, StatusPill, type StatusTone } from "../components/ui";
import {
  attendanceEventsByIdentity,
  cairoDate,
  identityEmployeeId,
  type AttendanceDay,
  type AttendanceEvent,
  type DemoIdentity,
  type LeaveBalance,
  type WorkSchedule,
} from "../mock/attendance";
import { demoUser } from "../mock/data";
import PageHeader from "../components/layout/PageHeader";

type DictKey = keyof Dict;
type Feedback = { tone: "success" | "error"; text: string } | null;
const identities: DemoIdentity[] = ["employee", "manager", "hr"];
const minutesFormat = (value: number, locale: "ar" | "en"): string => {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${hours}${translate(locale, "attendanceHoursSuffix")} ${minutes}${translate(locale, "attendanceMinutesSuffix")}`;
};
const formatTimes = (value: string | null, locale: "ar" | "en"): string => value ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
const weekdayLabel = (weekday: number, locale: "ar" | "en"): string => new Intl.DateTimeFormat(locale, { weekday: "long" }).format(new Date(Date.UTC(2023, 0, 1 + weekday)));
const leaveTypeKeys: Record<LeaveBalance["leave_type"], DictKey> = { ANNUAL: "leaveAnnual", SICK: "leaveSick", UNPAID: "leaveUnpaid", EMERGENCY: "leaveEmergency" };
const leaveTypeKey = (code: LeaveBalance["leave_type"]): DictKey => leaveTypeKeys[code];
const statusKeys: Record<AttendanceDay["status"], DictKey> = {
  OPEN: "attendanceStatusOpen", PRESENT: "attendanceStatusPresent", ABSENT_CANDIDATE: "attendanceStatusAbsentCandidate", ABSENT: "attendanceStatusAbsent", LEAVE: "attendanceStatusLeave", HOLIDAY: "attendanceStatusHoliday", REMOTE: "attendanceStatusRemote", INCOMPLETE: "attendanceStatusIncomplete",
};
const exceptionKeys: Record<AttendanceDay["exception"], DictKey> = {
  LATE: "attendanceExceptionLate", EARLY_LEAVE: "attendanceExceptionEarlyLeave", MISSING_CLOCK_OUT: "attendanceExceptionMissingClockOut", NONE: "attendanceExceptionNone",
};
const statusTone = (status: AttendanceDay["status"]): StatusTone => {
  if (status === "PRESENT" || status === "REMOTE") return "success";
  if (status === "INCOMPLETE" || status === "ABSENT_CANDIDATE") return "warning";
  if (status === "ABSENT") return "danger";
  return status === "OPEN" ? "info" : "neutral";
};
const fmtDate = (value: string, locale: "ar" | "en"): string => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
const fmtDateTime = (value: string, locale: "ar" | "en"): string => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const recordedBy = (code: string, locale: "ar" | "en"): string => {
  const identity: DemoIdentity | undefined = ({ e1: "employee", m1: "manager", hr1: "hr" } as const)[code];
  return identity ? demoUser[identity].name[locale] : code;
};
/** First valid CLOCK_IN instant in an ordered event list; falls back to the supplied value. */
const firstInAt = (occurredAt: string | null, orderedEvents: AttendanceEvent[]): string | null =>
  orderedEvents.find((event) => event.kind === "CLOCK_IN" && Number.isFinite(Date.parse(event.occurred_at)))?.occurred_at ?? occurredAt;
/** Stable ordering used to interleave identities inside one date group. */
const identityOrder = (identity: DemoIdentity): number => identities.indexOf(identity);
/** Schedule currently in force for today's Cairo work date (resolvers compare ISO strings). */
function currentOrgSchedule(schedules: WorkSchedule[], today: string): WorkSchedule | null {
  return schedules
    .filter((schedule) => schedule.scope === "ORGANIZATION" && schedule.effective_from <= today && (!schedule.effective_to || today <= schedule.effective_to))
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0] ?? null;
}
/** Org-wide overview rows derived exclusively from the existing attendance fixtures. */
function orgAttendanceRows(eventsByIdentity: Record<DemoIdentity, AttendanceEvent[]>, today: string) {
  const rows = identities.flatMap((identity) => {
    const events = eventsByIdentity[identity];
    const byDate = new Map<string, AttendanceEvent[]>();
    events.forEach((event) => {
      const date = cairoDate(new Date(event.occurred_at));
      byDate.set(date, [...(byDate.get(date) ?? []), event]);
    });
    const days = [...byDate.entries()].map(([workDate, dayEvents]) => {
      const ordered = [...dayEvents].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at));
      const open = ordered.reduce<AttendanceEvent | null>((previous, event) => (event.kind === "CLOCK_IN" ? event : previous), null);
      const lastOut = [...ordered].reverse().find((event) => event.kind === "CLOCK_OUT")?.occurred_at ?? null;
      let worked = 0;
      let openPair: string | null = null;
      ordered.forEach((event) => {
        if (event.kind === "CLOCK_IN") openPair = event.occurred_at;
        else if (openPair) {
          worked += Math.max(0, Math.round((Date.parse(event.occurred_at) - Date.parse(openPair)) / 60000));
          openPair = null;
        }
      });
      const status: AttendanceDay["status"] = open ? "INCOMPLETE" : worked ? "PRESENT" : "OPEN";
      const exception: AttendanceDay["exception"] = open ? "MISSING_CLOCK_OUT" : "NONE";
      return {
        identity,
        employee: identityEmployeeId(identity),
        work_date: workDate,
        first_in_at: firstInAt(null, ordered),
        last_out_at: lastOut,
        worked_minutes: worked,
        status,
        exception,
      };
    });
    return days;
  });
  return rows.filter((row) => row.work_date <= today).sort((left, right) => right.work_date.localeCompare(left.work_date) || identityOrder(right.identity) - identityOrder(left.identity));
}

type ScheduleDraft = {
  working_weekdays: number[];
  expected_start: string;
  expected_end: string;
  expected_daily_minutes: string;
  grace_minutes: string;
  effective_from: string;
  effective_to: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const toDraft = (schedule: WorkSchedule): ScheduleDraft => ({
  working_weekdays: [...schedule.working_weekdays],
  expected_start: schedule.expected_start,
  expected_end: schedule.expected_end,
  expected_daily_minutes: String(schedule.expected_daily_minutes),
  grace_minutes: String(schedule.grace_minutes),
  effective_from: schedule.effective_from,
  effective_to: schedule.effective_to ?? "",
});
const dateIsValid = (value: string): boolean => ISO_DATE.test(value) && Number.isFinite(new Date(`${value}T12:00:00`).getTime());
const timeIsValid = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export default function AdminPage() {
  const { t, locale, capabilities, schedules, leaveBalances, setWorkSchedule, adjustLeaveBalance, leaveBalanceSummary } = useApp();
  usePageTitle(t("adminTitle"));
  const today = cairoDate(new Date());
  const orgSchedule = useMemo(() => currentOrgSchedule(schedules, today), [schedules, today]);

  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(() =>
    orgSchedule
      ? toDraft(orgSchedule)
      : { working_weekdays: [0, 1, 2, 3, 4], expected_start: "09:00", expected_end: "17:00", expected_daily_minutes: "480", grace_minutes: "15", effective_from: today, effective_to: "" },
  );
  const [scheduleFeedback, setScheduleFeedback] = useState<Feedback>(null);
  const [adjustType, setAdjustType] = useState<LeaveBalance["leave_type"]>("ANNUAL");
  const [adjustDays, setAdjustDays] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [leaveFeedback, setLeaveFeedback] = useState<Feedback>(null);

  if (!capabilities.canSetOrgSchedule && !capabilities.canManageLeaveBalance && !capabilities.canViewOrgAttendance) return <Navigate to="/" replace />;

  const toggleWeekday = (weekday: number) =>
    setScheduleDraft((draft) => ({
      ...draft,
      working_weekdays: draft.working_weekdays.includes(weekday)
        ? draft.working_weekdays.filter((day) => day !== weekday)
        : [...draft.working_weekdays, weekday].sort((left, right) => left - right),
    }));

  const saveSchedule = () => {
    const dailyMinutes = Number(scheduleDraft.expected_daily_minutes);
    const graceMinutes = Number(scheduleDraft.grace_minutes);
    const validationFailed: DictKey | null =
      !timeIsValid(scheduleDraft.expected_start) || !timeIsValid(scheduleDraft.expected_end) ? "adminErrorRequired"
        : scheduleDraft.expected_start < scheduleDraft.expected_end ? null
          : scheduleDraft.working_weekdays.length < 1 ? "adminErrorWeekdays"
            : !Number.isInteger(dailyMinutes) || dailyMinutes < 0 || !Number.isInteger(graceMinutes) || graceMinutes < 0 ? "adminErrorMinutes"
              : !dateIsValid(scheduleDraft.effective_from) || (scheduleDraft.effective_to !== "" && !dateIsValid(scheduleDraft.effective_to)) ? "adminErrorRequired"
                : scheduleDraft.effective_to !== "" && scheduleDraft.effective_to < scheduleDraft.effective_from ? "adminErrorDates"
                  : null;
    if (validationFailed) {
      setScheduleFeedback({ tone: "error", text: t(validationFailed) });
      return;
    }
    const payload: WorkSchedule = {
      id: orgSchedule?.id ?? `schedule-org-${scheduleDraft.effective_from}`,
      scope: "ORGANIZATION",
      working_weekdays: scheduleDraft.working_weekdays,
      expected_start: scheduleDraft.expected_start,
      expected_end: scheduleDraft.expected_end,
      expected_daily_minutes: dailyMinutes,
      grace_minutes: graceMinutes,
      effective_from: scheduleDraft.effective_from,
      ...(scheduleDraft.effective_to ? { effective_to: scheduleDraft.effective_to } : {}),
    };
    const result = setWorkSchedule(payload);
    setScheduleFeedback(
      result.ok
        ? { tone: "success", text: t("adminScheduleSaved") }
        : { tone: "error", text: t(result.code === "CAPABILITY_DENIED" ? "adminMutationDenied" : "adminMutationInvalid") },
    );
  };

  const adjust = () => {
    const days = Number(adjustDays);
    if (adjustDays.trim() === "" || !Number.isInteger(days) || days === 0) {
      setLeaveFeedback({ tone: "error", text: t("adminErrorDays") });
      return;
    }
    if (!adjustReason.trim()) {
      setLeaveFeedback({ tone: "error", text: t("adminErrorReason") });
      return;
    }
    const result = adjustLeaveBalance(adjustType, days, adjustReason.trim());
    if (result.ok) {
      setAdjustDays("");
      setAdjustReason("");
      setLeaveFeedback({ tone: "success", text: t("adminBalanceAdjusted") });
    } else {
      setLeaveFeedback({ tone: "error", text: t(result.code === "CAPABILITY_DENIED" ? "adminMutationDenied" : "adminMutationInvalid") });
    }
  };

  const fmtNumber = (value: number): string => new Intl.NumberFormat(locale).format(value);

  const canSchedule = capabilities.canSetOrgSchedule;
  const canLeave = capabilities.canManageLeaveBalance;
  const canAttendance = capabilities.canViewOrgAttendance;
  const rows = useMemo(() => orgAttendanceRows(attendanceEventsByIdentity, today), [today]);

  return (
    <div className="work-surface">
      <PageHeader title={t("adminTitle")} subtitle={t("adminSubtitle")} />
      <Banner tone="info">{t("adminDemoBoundary")}</Banner>

      {canSchedule ? (
        <section className="section" aria-labelledby="admin-org-schedule">
          <h2 id="admin-org-schedule">{t("adminOrgScheduleTitle")}</h2>
          {orgSchedule ? (
            <p className="page-meta">
              {t("adminCurrentSchedule")}: <strong>{t("adminWorkingWeekdays")}</strong>{" "}
              {orgSchedule.working_weekdays.map((weekday) => weekdayLabel(weekday, locale)).join("، ")} · {orgSchedule.expected_start}–{orgSchedule.expected_end} ·{" "}
              {minutesFormat(orgSchedule.expected_daily_minutes, locale)} (+{fmtNumber(orgSchedule.grace_minutes)})
            </p>
          ) : (
            <p className="page-meta">{t("adminNoCurrentSchedule")}</p>
          )}
          {scheduleFeedback ? <Banner tone={scheduleFeedback.tone}>{scheduleFeedback.text}</Banner> : null}
          <form
            className="admin-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              saveSchedule();
            }}
          >
            <fieldset className="quiet-inset field">
              <legend className="field-label">{t("adminWorkingWeekdays")}</legend>
              {[0, 1, 2, 3, 4, 5, 6].map((weekday) => (
                <label className="admin-weekday" key={weekday}>
                  <input
                    type="checkbox"
                    checked={scheduleDraft.working_weekdays.includes(weekday)}
                    onChange={() => toggleWeekday(weekday)}
                    name={`admin-weekday-${weekday}`}
                  />
                  <span>{weekdayLabel(weekday, locale)}</span>
                </label>
              ))}
            </fieldset>
            <label className="field">
              <span className="field-label">{locale === "ar" ? "بداية الدوام المتوقعة" : "Expected start"}</span>
              <input
                className="input"
                type="time"
                dir="ltr"
                name="expected-start"
                value={scheduleDraft.expected_start}
                onChange={(event) => setScheduleDraft((draft) => ({ ...draft, expected_start: event.target.value }))}
              />
            </label>
            <label className="field">
              <span className="field-label">{locale === "ar" ? "نهاية الدوام المتوقعة" : "Expected end"}</span>
              <input
                className="input"
                type="time"
                dir="ltr"
                name="expected-end"
                value={scheduleDraft.expected_end}
                onChange={(event) => setScheduleDraft((draft) => ({ ...draft, expected_end: event.target.value }))}
              />
            </label>
            <label className="field">
              <span className="field-label">{t("adminExpectedDailyMinutes")}</span>
              <input
                className="input"
                type="number"
                min={0}
                inputMode="numeric"
                dir="ltr"
                name="expected-daily-minutes"
                value={scheduleDraft.expected_daily_minutes}
                onChange={(event) => setScheduleDraft((draft) => ({ ...draft, expected_daily_minutes: event.target.value }))}
              />
            </label>
            <label className="field">
              <span className="field-label">{t("adminGraceMinutes")}</span>
              <input
                className="input"
                type="number"
                min={0}
                inputMode="numeric"
                dir="ltr"
                name="grace-minutes"
                value={scheduleDraft.grace_minutes}
                onChange={(event) => setScheduleDraft((draft) => ({ ...draft, grace_minutes: event.target.value }))}
              />
            </label>
            <label className="field">
              <span className="field-label">{t("adminEffectiveFrom")}</span>
              <input
                className="input"
                type="date"
                dir="ltr"
                name="effective-from"
                required
                value={scheduleDraft.effective_from}
                onChange={(event) => setScheduleDraft((draft) => ({ ...draft, effective_from: event.target.value }))}
              />
            </label>
            <label className="field">
              <span className="field-label">{t("adminEffectiveTo")}</span>
              <input
                className="input"
                type="date"
                dir="ltr"
                name="effective-to"
                value={scheduleDraft.effective_to}
                onChange={(event) => setScheduleDraft((draft) => ({ ...draft, effective_to: event.target.value }))}
              />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">{t("save")}</button>
            </div>
          </form>
        </section>
      ) : null}

      {canLeave ? (
        <section className="section" aria-labelledby="admin-leave-balances">
          <h2 id="admin-leave-balances">{t("adminLeaveBalancesTitle")}</h2>
          {leaveFeedback ? <Banner tone={leaveFeedback.tone} role={leaveFeedback.tone === "error" ? "alert" : "status"}>{leaveFeedback.text}</Banner> : null}
          {leaveBalances.map((balance) => {
            const summary = leaveBalanceSummary(balance);
            return (
              <div key={balance.leave_type} className="quiet-inset admin-balance">
                <h3>{t(leaveTypeKey(balance.leave_type))} · {balance.period}</h3>
                <dl className="admin-metrics">
                  {([
                    ["adminEntitlement", summary.entitlement_days],
                    ["adminCarryOver", summary.carry_over_days],
                    ["adminUsedDays", summary.used_days],
                    ["adminPendingDays", summary.pending_days],
                    ["adminAdjustmentsTotal", summary.adjustments_total],
                  ] as const).map(([key, value]) => (
                    <div key={key}>
                      <dt>{t(key)}</dt>
                      <dd>{fmtNumber(value)}</dd>
                    </div>
                  ))}
                </dl>
                <h4>{t("adminAdjustmentsHistory")}</h4>
                {balance.adjustments.length ? (
                  <ul>
                    {balance.adjustments.map((adjustment) => (
                      <li key={adjustment.id}>
                        <b dir="ltr">{new Intl.NumberFormat(locale, { signDisplay: "exceptZero" }).format(adjustment.days)}</b> — {adjustment.reason}
                        <span className="muted">
                          {" · "}{t("adminRecordedBy")}: <bdi>{recordedBy(adjustment.recorded_by, locale)}</bdi> · <bdi>{fmtDateTime(adjustment.created_at, locale)}</bdi>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState message={t("adminNoAdjustments")} />
                )}
              </div>
            );
          })}
          <form
            className="admin-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              adjust();
            }}
          >
            <label className="field">
              <span className="field-label">{t("adminLeaveType")}</span>
              <select
                className="select"
                name="adjust-type"
                value={adjustType}
                onChange={(event) => setAdjustType(event.target.value as LeaveBalance["leave_type"])}
              >
                {(["ANNUAL", "SICK", "UNPAID", "EMERGENCY"] as LeaveBalance["leave_type"][]).map((code) => (
                  <option key={code} value={code}>{t(leaveTypeKey(code))}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{t("adminDays")}</span>
              <input
                className="input"
                type="number"
                step={1}
                inputMode="numeric"
                dir="ltr"
                name="adjust-days"
                value={adjustDays}
                placeholder="+1 / -2"
                onChange={(event) => setAdjustDays(event.target.value)}
              />
              <span className="field-hint">{t("adminDaysHint")}</span>
            </label>
            <label className="field">
              <span className="field-label">{t("decisionComment")}</span>
              <input
                className="input"
                type="text"
                name="adjust-reason"
                required
                value={adjustReason}
                onChange={(event) => setAdjustReason(event.target.value)}
              />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">{t("save")}</button>
            </div>
          </form>
        </section>
      ) : null}

      {canAttendance ? (
        <section className="section" aria-labelledby="admin-org-attendance">
          <h2 id="admin-org-attendance">{t("adminOrgAttendanceTitle")}</h2>
          <div className="table-wrap">
            <table>
              <caption className="table-caption">{t("adminAllEmployees")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("attendanceDate")}</th>
                  <th scope="col">{t("employee")}</th>
                  <th scope="col">{t("attendanceFirstIn")}</th>
                  <th scope="col">{t("attendanceLastOut")}</th>
                  <th scope="col">{t("workedMinutes")}</th>
                  <th scope="col">{t("status")}</th>
                  <th scope="col">{t("attendanceException")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.identity}-${row.work_date}`}>
                    <td><bdi>{fmtDate(row.work_date, locale)}</bdi></td>
                    <td><bdi>{demoUser[row.identity].name[locale]} ({row.employee})</bdi></td>
                    <td>{formatTimes(row.first_in_at, locale)}</td>
                    <td>{formatTimes(row.last_out_at, locale)}</td>
                    <td>{minutesFormat(row.worked_minutes, locale)}</td>
                    <td><StatusPill tone={statusTone(row.status)} label={t(statusKeys[row.status])} /></td>
                    <td>{t(exceptionKeys[row.exception])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
