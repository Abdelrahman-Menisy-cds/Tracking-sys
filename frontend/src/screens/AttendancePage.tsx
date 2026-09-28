import { useMemo, useState } from "react";
import { t as translate } from "../i18n/dict";
import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { Banner, EmptyState, ErrorState, SkeletonRows, StatusPill } from "../components/ui";
import { ClockIcon, CloseIcon, InfoIcon } from "../components/icons";
import { attendanceExceptionForEvent, cairoDate, identityEmployeeId, type AttendanceDay, type AttendanceEvent } from "../mock/attendance";
import PageHeader from "../components/layout/PageHeader";

type Pair = { inAt: string; outAt: string | null };
type Correction = { id: string; workDate: string; inAt: string; outAt: string; reason: string; status: "SUBMITTED" };

const todayIso = () => cairoDate(new Date());
const formatTime = (value: string | null, locale: "ar" | "en") => value ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
const formatDate = (value: string, locale: "ar" | "en") => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
const duration = (minutes: number, locale: "ar" | "en") => { const h = Math.floor(minutes / 60); const m = minutes % 60; return `${h}${translate(locale, "attendanceHoursSuffix")} ${m}${translate(locale, "attendanceMinutesSuffix")}`; };
const minutesBetween = (start: string, end: string) => Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000));

function eventPairs(events: AttendanceEvent[], date: string): Pair[] {
  const pairs: Pair[] = [];
  let openAt: string | null = null;
  events.filter((event) => cairoDate(new Date(event.occurred_at)) === date).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).forEach((event) => {
    if (event.kind === "CLOCK_IN") openAt = event.occurred_at;
    else if (openAt) { pairs.push({ inAt: openAt, outAt: event.occurred_at }); openAt = null; }
  });
  if (openAt) pairs.push({ inAt: openAt, outAt: null });
  return pairs;
}
const statusKeys: Record<AttendanceDay["status"], "attendanceStatusOpen" | "attendanceStatusPresent" | "attendanceStatusAbsentCandidate" | "attendanceStatusAbsent" | "attendanceStatusLeave" | "attendanceStatusHoliday" | "attendanceStatusRemote" | "attendanceStatusIncomplete"> = {
  OPEN: "attendanceStatusOpen", PRESENT: "attendanceStatusPresent", ABSENT_CANDIDATE: "attendanceStatusAbsentCandidate", ABSENT: "attendanceStatusAbsent", LEAVE: "attendanceStatusLeave", HOLIDAY: "attendanceStatusHoliday", REMOTE: "attendanceStatusRemote", INCOMPLETE: "attendanceStatusIncomplete",
};
const exceptionKeys: Record<AttendanceDay["exception"], "attendanceExceptionLate" | "attendanceExceptionEarlyLeave" | "attendanceExceptionMissingClockOut" | "attendanceExceptionNone"> = { LATE: "attendanceExceptionLate", EARLY_LEAVE: "attendanceExceptionEarlyLeave", MISSING_CLOCK_OUT: "attendanceExceptionMissingClockOut", NONE: "attendanceExceptionNone" };
function statusLabel(day: AttendanceDay, t: (key: keyof import("../i18n/dict").Dict) => string) { return t(statusKeys[day.status]); }
function exceptionLabel(exception: AttendanceDay["exception"], t: (key: keyof import("../i18n/dict").Dict) => string) { return t(exceptionKeys[exception]); }
function statusTone(status: AttendanceDay["status"]): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "PRESENT" || status === "REMOTE") return "success";
  if (status === "INCOMPLETE" || status === "ABSENT_CANDIDATE") return "warning";
  if (status === "ABSENT") return "danger";
  return status === "OPEN" ? "info" : "neutral";
}
function mutationMessage(code: string, locale: "ar" | "en") {
  const keys: Record<string, keyof import("../i18n/dict").Dict> = {
    CLOCK_IN_ALREADY_OPEN: "attendanceClockInAlreadyOpen",
    CLOCK_OUT_WITHOUT_OPEN_CLOCK_IN: "attendanceClockOutWithoutOpen",
    CAPABILITY_DENIED: "attendanceCapabilityDenied",
    INVALID_INPUT: "attendanceInvalidInput",
  };
  return translate(locale, keys[code] ?? "attendanceMutationFallback");
}

function AttendanceStatus({ day }: { day: AttendanceDay }) {
  const { t } = useApp();
  return <span className="attendance-status-stack"><StatusPill tone={statusTone(day.status)} label={statusLabel(day, t)} /><span className="muted">{exceptionLabel(day.exception, t)}</span></span>;
}

export function ClockAction({ compact = false }: { compact?: boolean }) {
  const { locale, role, attendanceEvents, clockIn, clockOut, capabilities } = useApp();
  const [message, setMessage] = useState<string | null>(null);
  const employee = identityEmployeeId(role);
  const employeeEvents = [...attendanceEvents].filter((event) => event.employee === employee).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const latestEvent = employeeEvents[employeeEvents.length - 1];
  const open = latestEvent?.kind === "CLOCK_IN";
  const act = () => { const result = open ? clockOut() : clockIn(); setMessage(result.ok ? (translate(locale, "attendanceSubmitSuccess")) : mutationMessage(result.code, locale)); };
  return <span className={compact ? "quick-clock" : undefined}><button type="button" className={`btn ${open ? "btn-secondary" : "btn-primary"}`} onClick={act} disabled={!capabilities.canClock} aria-label={open ? (translate(locale, "attendanceClockOutAria")) : (translate(locale, "attendanceClockInAria"))}><ClockIcon />{open ? (translate(locale, "attendanceClockOutShort")) : (translate(locale, "attendanceClockInShort"))}</button>{message ? <span className="visually-hidden" role="status">{message}</span> : null}</span>;
}

function TodayPanel() {
  const { locale, role, attendanceEvents, attendanceDays, schedules, resolveScheduleFor, clockIn, clockOut, capabilities } = useApp();
  const date = todayIso();
  const employee = identityEmployeeId(role);
  const pairs = eventPairs(attendanceEvents, date);
  const open = pairs.at(-1)?.outAt === null;
  const today = attendanceDays.find((day) => day.work_date === date);
  const schedule = resolveScheduleFor(employee, date) ?? schedules[0];
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const closedWorked = pairs.reduce((sum, pair) => sum + (pair.outAt ? minutesBetween(pair.inAt, pair.outAt) : 0), 0);
  const running = open ? closedWorked + minutesBetween(pairs.at(-1)!.inAt, new Date().toISOString()) : closedWorked;
  const late = attendanceExceptionForEvent(pairs[0] ? { id: "panel-first", employee, occurred_at: pairs[0].inAt, kind: "CLOCK_IN", source: "WEB", recorded_by: employee, created_at: pairs[0].inAt } : null, date, schedule) === "LATE";
  const action = () => { const result = open ? clockOut() : clockIn(); setFeedback(result.ok ? { tone: "success", text: translate(locale, "attendanceSubmitSuccess") } : { tone: "error", text: mutationMessage(result.code, locale) }); };
  return <>
    {feedback ? <Banner tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.text}</Banner> : null}
    <section className="attendance-clock-card work-surface" aria-labelledby="today-clock-title">
      <div><p className="eyebrow">{translate(locale, "attendanceToday")}</p><h2 id="today-clock-title">{open ? (`${translate(locale, "attendanceClockedInSince")} ${formatTime(pairs.at(-1)!.inAt, locale)}`) : (translate(locale, "attendanceNotClockedIn"))}</h2><p className="muted">{translate(locale, "attendanceWorkedRunning")}: <strong>{duration(running, locale)}</strong></p></div>
      <button type="button" className={`btn ${open ? "btn-secondary" : "btn-primary"} clock-primary-action`} onClick={action} disabled={!capabilities.canClock}>{open ? (translate(locale, "attendanceClockOutAria")) : (translate(locale, "attendanceClockInAria"))}</button>
    </section>
    <section className="attendance-grid section">
      <div className="work-surface"><div className="section-heading"><h2>{translate(locale, "attendanceTodayIntervals")}</h2><strong>{duration(running, locale)}</strong></div>{pairs.length ? <div className="interval-list">{pairs.map((pair, index) => <div className="interval-row" key={`${pair.inAt}-${index}`}><span>{formatTime(pair.inAt, locale)} → {formatTime(pair.outAt, locale)}</span><span className="muted">{pair.outAt ? duration(minutesBetween(pair.inAt, pair.outAt), locale) : (translate(locale, "attendanceRunning"))}</span></div>)}<p className="muted">{translate(locale, "attendanceBreakTotal")}: <strong>{duration(today?.break_minutes ?? 0, locale)}</strong></p></div> : <EmptyState message={translate(locale, "attendanceNoInterval")} />}</div>
      <div className="work-surface"><div className="section-heading"><h2>{translate(locale, "attendanceScheduleToday")}</h2><InfoIcon /></div>{schedule ? <dl className="decision-facts"><div><dt>{translate(locale, "attendanceExpected")}</dt><dd><bdi>{schedule.expected_start}</bdi> — <bdi>{schedule.expected_end}</bdi></dd></div><div><dt>{translate(locale, "status")}</dt><dd>{late ? <StatusPill tone="warning" label={translate(locale, "attendanceExceptionLate")} /> : <StatusPill tone="success" label={translate(locale, "attendanceOnTime")} />}</dd></div></dl> : <p className="muted">{translate(locale, "attendanceNoSchedule")}</p>}</div>
    </section>
  </>;
}

export default function AttendancePage() {
  const { t, locale, attendanceDays } = useApp(); usePageTitle(t("attendanceTitle"));
  return <main className="page"><PageHeader title={t("attendanceTitle")} subtitle={t("attendanceDemoBoundary")} primaryAction={<Link className="btn btn-secondary" to="/attendance/history">{t("attendanceHistoryTitle")}</Link>} /><TodayPanel /><section className="work-surface section"><div className="section-heading"><h2>{translate(locale, "attendanceRecentDays")}</h2><Link to="/attendance/history">{translate(locale, "attendanceViewFullHistory")}</Link></div><AttendanceTable days={attendanceDays.slice(0, 8)} locale={locale} /></section></main>;
}

function AttendanceTable({ days, locale, detail = false }: { days: AttendanceDay[]; locale: "ar" | "en"; detail?: boolean }) {
  return <div className="table-wrap"><table aria-label={translate(locale, "attendanceTable")}><thead><tr><th>{translate(locale, "attendanceDateLabel")}</th><th>{translate(locale, "attendanceFirstInLabel")}</th><th>{translate(locale, "attendanceLastOutLabel")}</th><th>{translate(locale, "attendanceWorkedLabel")}</th><th>{translate(locale, "attendanceBreakLabel")}</th><th>{translate(locale, "attendanceStatusExceptionLabel")}</th>{detail ? <th>{translate(locale, "attendanceActionLabel")}</th> : null}</tr></thead><tbody>{days.map((day) => <tr key={day.work_date}><th scope="row"><bdi>{formatDate(day.work_date, locale)}</bdi></th><td><bdi>{formatTime(day.first_in_at, locale)}</bdi></td><td><bdi>{formatTime(day.last_out_at, locale)}</bdi></td><td>{duration(day.worked_minutes, locale)}</td><td>{duration(day.break_minutes, locale)}</td><td><AttendanceStatus day={day} /></td>{detail ? <td>{day.status === "INCOMPLETE" || day.status === "ABSENT_CANDIDATE" ? <Link className="btn btn-ghost btn-compact" to="/attendance/corrections">{translate(locale, "attendanceRequestCorrection")}</Link> : null}</td> : null}</tr>)}</tbody></table><div className="mobile-record-list">{days.map((day) => <article className="record-block" key={`mobile-${day.work_date}`}><strong><bdi>{formatDate(day.work_date, locale)}</bdi></strong><AttendanceStatus day={day} /><span>{translate(locale, "attendanceWorkedLabel")}: {duration(day.worked_minutes, locale)} · {translate(locale, "attendanceBreakLabel")}: {duration(day.break_minutes, locale)}</span>{day.status === "INCOMPLETE" || day.status === "ABSENT_CANDIDATE" ? <Link className="btn btn-secondary" to="/attendance/corrections">{translate(locale, "attendanceRequestCorrection")}</Link> : null}</article>)}</div></div>;
}

export function AttendanceHistoryPage() {
  const { locale, attendanceDays } = useApp();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [state, setState] = useState<"ready" | "loading" | "error">("ready");
  const filtered = useMemo(() => attendanceDays.filter((day) => (!from || day.work_date >= from) && (!to || day.work_date <= to) && (filter === "ALL" || day.status === filter || day.exception === filter)), [attendanceDays, filter, from, to]);
  const filterLabels: Record<string, string> = {
    PRESENT: translate(locale, "attendanceStatusPresent"),
    INCOMPLETE: translate(locale, "attendanceStatusIncomplete"),
    ABSENT_CANDIDATE: translate(locale, "attendanceStatusAbsentCandidate"),
    LATE: translate(locale, "attendanceExceptionLate"),
    EARLY_LEAVE: translate(locale, "attendanceExceptionEarlyLeave"),
    MISSING_CLOCK_OUT: translate(locale, "attendanceExceptionMissingClockOut"),
  };
  const activeFilters = [
    from ? { key: "from", label: `${translate(locale, "attendanceFrom")} ${locale === "ar" ? formatArabicDigits(from) : from}` } : null,
    to ? { key: "to", label: `${translate(locale, "attendanceTo")} ${locale === "ar" ? formatArabicDigits(to) : to}` } : null,
    filter !== "ALL" ? { key: "filter", label: filterLabels[filter] ?? filter } : null,
  ].filter(Boolean) as { key: string; label: string }[];
  const clearFilter = (key: string) => { if (key === "from") setFrom(""); if (key === "to") setTo(""); if (key === "filter") setFilter("ALL"); };
  const clearAllFilters = () => { setFrom(""); setTo(""); setFilter("ALL"); };
  return (
    <main className="page">
      <PageHeader title={translate(locale, "attendanceHistoryTitle")} subtitle={translate(locale, "attendanceHistorySubtitle")} />
      <Banner tone="info">
        <strong>{translate(locale, "attendanceWhatStatesMean")}</strong> {translate(locale, "attendanceStatesHelp")}
      </Banner>
      <section className="work-surface">
        <section className="filter-panel" aria-labelledby="attendance-history-filters-heading">
          <div className="filter-panel-heading">
            <h2 id="attendance-history-filters-heading">{translate(locale, "attendanceHistoryFilters")}</h2>
            {activeFilters.length > 0 ? (
              <button className="btn btn-ghost btn-compact" type="button" onClick={clearAllFilters}>{translate(locale, "attendanceClearAllFilters")}</button>
            ) : null}
          </div>
          <div className="filter-toolbar">
            <label className="field">
              <span className="field-label">{translate(locale, "attendanceFrom")}</span>
              <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">{translate(locale, "attendanceTo")}</span>
              <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">{translate(locale, "attendanceStatusOrException")}</span>
              <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="ALL">{translate(locale, "attendanceAll")}</option>
                <option value="PRESENT">{translate(locale, "attendanceStatusPresent")}</option>
                <option value="INCOMPLETE">{translate(locale, "attendanceStatusIncomplete")}</option>
                <option value="ABSENT_CANDIDATE">{translate(locale, "attendanceStatusAbsentCandidate")}</option>
                <option value="LATE">{translate(locale, "attendanceExceptionLate")}</option>
                <option value="EARLY_LEAVE">{translate(locale, "attendanceExceptionEarlyLeave")}</option>
                <option value="MISSING_CLOCK_OUT">{translate(locale, "attendanceExceptionMissingClockOut")}</option>
              </select>
            </label>
          </div>
          {activeFilters.length > 0 ? (
            <div className="applied-filters" aria-live="polite">
              <span>{translate(locale, "attendanceAppliedFilters")}</span>
              {activeFilters.map((activeFilter) => (
                <span className="filter-chip" key={activeFilter.key}>
                  {activeFilter.label}
                  <button
                    className="btn btn-ghost btn-compact chip-clear"
                    type="button"
                    aria-label={translate(locale, "attendanceClearFilterAriaTemplate").replace("%s", activeFilter.label)}
                    onClick={() => clearFilter(activeFilter.key)}
                  >
                    <CloseIcon />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </section>
        <div className="filter-count-line">
          <p className="table-caption" aria-live="polite">{filtered.length} {translate(locale, "attendanceRecordsCount")}</p>
        </div>
        {state === "loading" ? (
            <SkeletonRows />
          ) : state === "error" ? (
            <ErrorState onRetry={() => setState("ready")} />
          ) : filtered.length ? (
            <AttendanceTable days={filtered} locale={locale} detail />
          ) : (
            <EmptyState message={translate(locale, "attendanceNoFilteredRecords")} action={<button className="btn btn-secondary" type="button" onClick={clearAllFilters}>{translate(locale, "attendanceClearAllFilters")}</button>} />
          )}
      </section>
    </main>
  );
}

function formatArabicDigits(value: string): string {
  const westernDigits = "0123456789";
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return value.replace(/[0-9]/g, (digit) => arabicDigits[westernDigits.indexOf(digit)]);
}

export function AttendanceCorrectionsPage() {
  const { locale, submitAttendanceCorrection } = useApp();
  const [corrections, setCorrections] = useState<Correction[]>([]); const [workDate, setWorkDate] = useState(todayIso()); const [inAt, setInAt] = useState("09:00"); const [outAt, setOutAt] = useState("17:00"); const [reason, setReason] = useState(""); const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const submit = (event: React.FormEvent) => { event.preventDefault(); const result = submitAttendanceCorrection({ workDate, inAt: new Date(`${workDate}T${inAt}`).toISOString(), outAt: outAt ? new Date(`${workDate}T${outAt}`).toISOString() : undefined, reason }); if (!result.ok) { setFeedback({ tone: "error", text: mutationMessage(result.code, locale) }); return; } setCorrections((items) => [{ id: `correction-${Date.now()}`, workDate, inAt, outAt, reason, status: "SUBMITTED" }, ...items]); setReason(""); setFeedback({ tone: "success", text: translate(locale, "attendanceCorrectionSubmitted") }); };
  return <main className="page"><PageHeader title={translate(locale, "attendanceCorrectionsTitle")} subtitle={translate(locale, "attendanceCorrectionsSubtitle")} /><Banner tone="warning"><strong>{translate(locale, "attendanceAppendOnlyTitle")}</strong> {translate(locale, "attendanceAppendOnlyHelp")}</Banner>{feedback ? <Banner tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.text}</Banner> : null}<section className="work-surface"><h2>{translate(locale, "attendanceSubmitCorrectionTitle")}</h2><form onSubmit={submit}><div className="form-grid"><label className="field"><span className="field-label">{translate(locale, "attendanceCorrectionDay")}</span><input className="input" required type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></label><label className="field"><span className="field-label">{translate(locale, "attendanceProposedIn")}</span><input className="input" required type="time" value={inAt} onChange={(e) => setInAt(e.target.value)} /></label><label className="field"><span className="field-label">{translate(locale, "attendanceProposedOut")}</span><input className="input" type="time" value={outAt} onChange={(e) => setOutAt(e.target.value)} /></label></div><label className="field"><span className="field-label">{translate(locale, "attendanceReasonRequired")}</span><textarea className="textarea" required value={reason} onChange={(e) => setReason(e.target.value)} /></label><button type="submit" className="btn btn-primary">{translate(locale, "attendanceSubmitForReview")}</button></form></section><section className="work-surface section"><h2>{translate(locale, "attendanceSubmittedCorrections")}</h2>{corrections.length ? <div className="record-list">{corrections.map((correction) => <article className="record-block" key={correction.id}><div className="record-header-main"><strong><bdi>{formatDate(correction.workDate, locale)}</bdi></strong><StatusPill tone="info" label={translate(locale, "stSubmitted")} /></div><p>{formatTime(new Date(`${correction.workDate}T${correction.inAt}`).toISOString(), locale)} → {correction.outAt || "—"}</p><p className="muted">{correction.reason}</p></article>)}</div> : <EmptyState message={translate(locale, "attendanceNoCorrections")} />}</section></main>;
}
