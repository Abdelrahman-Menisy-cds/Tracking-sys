import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { Banner, EmptyState, ErrorState, SkeletonRows, StatusPill } from "../components/ui";
import { ClockIcon, InfoIcon } from "../components/icons";
import { identityEmployeeId, type AttendanceDay, type AttendanceEvent } from "../mock/attendance";
import PageHeader from "../components/layout/PageHeader";

type Pair = { inAt: string; outAt: string | null };
type Correction = { id: string; workDate: string; inAt: string; outAt: string; reason: string; status: "SUBMITTED" };

const pad = (value: number) => String(value).padStart(2, "0");
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const formatTime = (value: string | null, locale: "ar" | "en") => value ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
const formatDate = (value: string, locale: "ar" | "en") => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
const duration = (minutes: number, locale: "ar" | "en") => { const h = Math.floor(minutes / 60); const m = minutes % 60; return locale === "ar" ? `${h} س ${m} د` : `${h}h ${m}m`; };
const minutesBetween = (start: string, end: string) => Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000));

function eventPairs(events: AttendanceEvent[], date: string): Pair[] {
  const pairs: Pair[] = [];
  let openAt: string | null = null;
  events.filter((event) => event.occurred_at.slice(0, 10) === date).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).forEach((event) => {
    if (event.kind === "CLOCK_IN") openAt = event.occurred_at;
    else if (openAt) { pairs.push({ inAt: openAt, outAt: event.occurred_at }); openAt = null; }
  });
  if (openAt) pairs.push({ inAt: openAt, outAt: null });
  return pairs;
}
function statusLabel(day: AttendanceDay, locale: "ar" | "en") {
  const ar: Record<string, string> = { OPEN: "مفتوح", PRESENT: "حاضر", ABSENT_CANDIDATE: "غياب مرشح", ABSENT: "غائب", LEAVE: "إجازة", HOLIDAY: "عطلة", REMOTE: "عن بُعد", INCOMPLETE: "غير مكتمل" };
  const en: Record<string, string> = { OPEN: "Open", PRESENT: "Present", ABSENT_CANDIDATE: "Absence candidate", ABSENT: "Absent", LEAVE: "Leave", HOLIDAY: "Holiday", REMOTE: "Remote", INCOMPLETE: "Incomplete" };
  return (locale === "ar" ? ar : en)[day.status] ?? day.status;
}
function exceptionLabel(exception: AttendanceDay["exception"], locale: "ar" | "en") {
  const ar: Record<string, string> = { LATE: "تأخر", EARLY_LEAVE: "انصراف مبكر", MISSING_CLOCK_OUT: "انصراف مفقود", NONE: "لا يوجد" };
  const en: Record<string, string> = { LATE: "Late", EARLY_LEAVE: "Early leave", MISSING_CLOCK_OUT: "Missing clock-out", NONE: "None" };
  return (locale === "ar" ? ar : en)[exception];
}
function statusTone(status: AttendanceDay["status"]): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "PRESENT" || status === "REMOTE") return "success";
  if (status === "INCOMPLETE" || status === "ABSENT_CANDIDATE") return "warning";
  if (status === "ABSENT") return "danger";
  return status === "OPEN" ? "info" : "neutral";
}
function mutationMessage(code: string, locale: "ar" | "en") {
  const messages: Record<string, [string, string]> = {
    CLOCK_IN_ALREADY_OPEN: ["لا يمكن تسجيل الحضور مرتين دون تسجيل انصراف.", "You cannot clock in twice without clocking out."],
    CLOCK_OUT_WITHOUT_OPEN_CLOCK_IN: ["لا يمكن تسجيل الانصراف دون حضور مفتوح.", "You cannot clock out without an open clock-in."],
    CAPABILITY_DENIED: ["إجراء الحضور غير متاح في هذه النسخة.", "Clock actions are unavailable in this build."],
    INVALID_INPUT: ["تحقق من الحقول المطلوبة.", "Check the required fields."],
  };
  return messages[code]?.[locale === "ar" ? 0 : 1] ?? (locale === "ar" ? "تعذر تنفيذ الإجراء." : "The action could not be completed.");
}

function AttendanceStatus({ day, locale }: { day: AttendanceDay; locale: "ar" | "en" }) {
  return <span className="attendance-status-stack"><StatusPill tone={statusTone(day.status)} label={statusLabel(day, locale)} /><span className="muted">{exceptionLabel(day.exception, locale)}</span></span>;
}

export function ClockAction({ compact = false }: { compact?: boolean }) {
  const { locale, role, attendanceEvents, clockIn, clockOut, capabilities } = useApp();
  const [message, setMessage] = useState<string | null>(null);
  const employee = identityEmployeeId(role);
  const employeeEvents = [...attendanceEvents].filter((event) => event.employee === employee).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const latestEvent = employeeEvents[employeeEvents.length - 1];
  const open = latestEvent?.kind === "CLOCK_IN";
  const act = () => { const result = open ? clockOut() : clockIn(); setMessage(result.ok ? (locale === "ar" ? "تم تسجيل الإجراء بنجاح." : "Attendance action recorded successfully.") : mutationMessage(result.code, locale)); };
  return <span className={compact ? "quick-clock" : undefined}><button type="button" className={`btn ${open ? "btn-secondary" : "btn-primary"}`} onClick={act} disabled={!capabilities.canClock} aria-label={open ? (locale === "ar" ? "تسجيل الانصراف" : "Clock out") : (locale === "ar" ? "تسجيل الحضور" : "Clock in")}><ClockIcon />{open ? (locale === "ar" ? "انصراف" : "Clock out") : (locale === "ar" ? "حضور" : "Clock in")}</button>{message ? <span className="visually-hidden" role="status">{message}</span> : null}</span>;
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
  const late = Boolean(schedule && pairs[0] && Date.parse(pairs[0].inAt) > Date.parse(`${date}T${schedule.expected_start}:00`)+schedule.grace_minutes*60000);
  const action = () => { const result = open ? clockOut() : clockIn(); setFeedback(result.ok ? { tone: "success", text: locale === "ar" ? "تم تسجيل الإجراء بنجاح." : "Attendance action recorded successfully." } : { tone: "error", text: mutationMessage(result.code, locale) }); };
  return <>
    {feedback ? <Banner tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.text}</Banner> : null}
    <section className="attendance-clock-card work-surface" aria-labelledby="today-clock-title">
      <div><p className="eyebrow">{locale === "ar" ? "اليوم" : "Today"}</p><h2 id="today-clock-title">{open ? (locale === "ar" ? `مسجل حضور منذ ${formatTime(pairs.at(-1)!.inAt, locale)}` : `Clocked in since ${formatTime(pairs.at(-1)!.inAt, locale)}`) : (locale === "ar" ? "لم تسجل حضورك بعد" : "Not clocked in")}</h2><p className="muted">{locale === "ar" ? "إجمالي العمل الجاري" : "Running worked total"}: <strong>{duration(running, locale)}</strong></p></div>
      <button type="button" className={`btn ${open ? "btn-secondary" : "btn-primary"} clock-primary-action`} onClick={action} disabled={!capabilities.canClock}>{open ? (locale === "ar" ? "تسجيل الانصراف" : "Clock out") : (locale === "ar" ? "تسجيل الحضور" : "Clock in")}</button>
    </section>
    <section className="attendance-grid section">
      <div className="work-surface"><div className="section-heading"><h2>{locale === "ar" ? "فترات اليوم" : "Today's intervals"}</h2><strong>{duration(running, locale)}</strong></div>{pairs.length ? <div className="interval-list">{pairs.map((pair, index) => <div className="interval-row" key={`${pair.inAt}-${index}`}><span>{formatTime(pair.inAt, locale)} → {formatTime(pair.outAt, locale)}</span><span className="muted">{pair.outAt ? duration(minutesBetween(pair.inAt, pair.outAt), locale) : (locale === "ar" ? "جارٍ" : "Running")}</span></div>)}<p className="muted">{locale === "ar" ? "إجمالي فترات الراحة" : "Derived break total"}: <strong>{duration(today?.break_minutes ?? 0, locale)}</strong></p></div> : <EmptyState message={locale === "ar" ? "لم تسجل أي فترة اليوم." : "No interval recorded today."} />}</div>
      <div className="work-surface"><div className="section-heading"><h2>{locale === "ar" ? "الجدول الساري اليوم" : "Schedule in force today"}</h2><InfoIcon /></div>{schedule ? <dl className="decision-facts"><div><dt>{locale === "ar" ? "المتوقع" : "Expected"}</dt><dd><bdi>{schedule.expected_start}</bdi> — <bdi>{schedule.expected_end}</bdi></dd></div><div><dt>{locale === "ar" ? "الحالة" : "Status"}</dt><dd>{late ? <StatusPill tone="warning" label={locale === "ar" ? "متأخر" : "Late"} /> : <StatusPill tone="success" label={locale === "ar" ? "في الموعد" : "On time"} />}</dd></div></dl> : <p className="muted">{locale === "ar" ? "لا يوجد جدول." : "No schedule found."}</p>}</div>
    </section>
  </>;
}

export default function AttendancePage() {
  const { t, locale, attendanceDays } = useApp(); usePageTitle(t("attendanceTitle"));
  return <main className="page"><PageHeader title={t("attendanceTitle")} subtitle={t("attendanceDemoBoundary")} primaryAction={<Link className="btn btn-secondary" to="/attendance/history">{t("attendanceHistoryTitle")}</Link>} /><TodayPanel /><section className="work-surface section"><div className="section-heading"><h2>{locale === "ar" ? "الأيام الأخيرة" : "Recent days"}</h2><Link to="/attendance/history">{locale === "ar" ? "عرض السجل الكامل" : "View full history"}</Link></div><AttendanceTable days={attendanceDays.slice(0, 8)} locale={locale} /></section></main>;
}

function AttendanceTable({ days, locale, detail = false }: { days: AttendanceDay[]; locale: "ar" | "en"; detail?: boolean }) {
  return <div className="table-wrap"><table aria-label={locale === "ar" ? "سجل الحضور" : "Attendance records"}><thead><tr><th>{locale === "ar" ? "التاريخ" : "Date"}</th><th>{locale === "ar" ? "أول دخول" : "First in"}</th><th>{locale === "ar" ? "آخر انصراف" : "Last out"}</th><th>{locale === "ar" ? "العمل" : "Worked"}</th><th>{locale === "ar" ? "الراحة" : "Break"}</th><th>{locale === "ar" ? "الحالة / الاستثناء" : "Status / exception"}</th>{detail ? <th>{locale === "ar" ? "الإجراء" : "Action"}</th> : null}</tr></thead><tbody>{days.map((day) => <tr key={day.work_date}><th scope="row"><bdi>{formatDate(day.work_date, locale)}</bdi></th><td><bdi>{formatTime(day.first_in_at, locale)}</bdi></td><td><bdi>{formatTime(day.last_out_at, locale)}</bdi></td><td>{duration(day.worked_minutes, locale)}</td><td>{duration(day.break_minutes, locale)}</td><td><AttendanceStatus day={day} locale={locale} /></td>{detail ? <td>{day.status === "INCOMPLETE" || day.status === "ABSENT_CANDIDATE" ? <Link className="btn btn-ghost btn-compact" to="/attendance/corrections">{locale === "ar" ? "طلب تصحيح" : "Request correction"}</Link> : null}</td> : null}</tr>)}</tbody></table><div className="mobile-record-list">{days.map((day) => <article className="record-block" key={`mobile-${day.work_date}`}><strong><bdi>{formatDate(day.work_date, locale)}</bdi></strong><AttendanceStatus day={day} locale={locale} /><span>{locale === "ar" ? "العمل" : "Worked"}: {duration(day.worked_minutes, locale)} · {locale === "ar" ? "الراحة" : "Break"}: {duration(day.break_minutes, locale)}</span>{day.status === "INCOMPLETE" || day.status === "ABSENT_CANDIDATE" ? <Link className="btn btn-secondary" to="/attendance/corrections">{locale === "ar" ? "طلب تصحيح" : "Request correction"}</Link> : null}</article>)}</div></div>;
}

export function AttendanceHistoryPage() {
  const { locale, attendanceDays } = useApp();
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [filter, setFilter] = useState("ALL"); const [state, setState] = useState<"ready" | "loading" | "error">("ready");
  const filtered = useMemo(() => attendanceDays.filter((day) => (!from || day.work_date >= from) && (!to || day.work_date <= to) && (filter === "ALL" || day.status === filter || day.exception === filter)), [attendanceDays, filter, from, to]);
  return <main className="page"><PageHeader title={locale === "ar" ? "سجل الحضور" : "Attendance history"} subtitle={locale === "ar" ? "سجل حضورك المشتق من الأحداث المسجلة." : "Your attendance derived from captured events."} /><Banner tone="info"><strong>{locale === "ar" ? "ما معنى الحالات؟" : "What do the states mean?"}</strong> {locale === "ar" ? "غياب مرشح يعني يومًا مجدولًا بلا أحداث ويحتاج مراجعة؛ غير مكتمل يعني وجود حضور بلا انصراف. يمكنك طلب تصحيح لإضافة أحداث جديدة." : "Absence candidate means a scheduled day with no events awaiting review; incomplete means an open clock-in without a clock-out. Request a correction to append new events."}</Banner><section className="work-surface"><div className="filter-toolbar"><label className="field"><span className="field-label">{locale === "ar" ? "من" : "From"}</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="field"><span className="field-label">{locale === "ar" ? "إلى" : "To"}</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label><label className="field"><span className="field-label">{locale === "ar" ? "الحالة أو الاستثناء" : "Status or exception"}</span><select className="select" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="ALL">{locale === "ar" ? "الكل" : "All"}</option><option value="PRESENT">{locale === "ar" ? "حاضر" : "Present"}</option><option value="INCOMPLETE">{locale === "ar" ? "غير مكتمل" : "Incomplete"}</option><option value="ABSENT_CANDIDATE">{locale === "ar" ? "غياب مرشح" : "Absence candidate"}</option><option value="LATE">{locale === "ar" ? "تأخر" : "Late"}</option><option value="EARLY_LEAVE">{locale === "ar" ? "انصراف مبكر" : "Early leave"}</option><option value="MISSING_CLOCK_OUT">{locale === "ar" ? "انصراف مفقود" : "Missing clock-out"}</option></select></label><button className="btn btn-secondary" type="button" onClick={() => setState("error")}>{locale === "ar" ? "اختبار الخطأ" : "Preview error"}</button></div><p className="table-caption" aria-live="polite">{filtered.length} {locale === "ar" ? "سجل" : "records"}</p>{state === "loading" ? <SkeletonRows /> : state === "error" ? <ErrorState onRetry={() => setState("ready")} /> : filtered.length ? <AttendanceTable days={filtered} locale={locale} detail /> : <EmptyState message={locale === "ar" ? "لا توجد سجلات بهذه الفلاتر." : "No attendance records match these filters."} />}</section></main>;
}

export function AttendanceCorrectionsPage() {
  const { locale, submitAttendanceCorrection } = useApp();
  const [corrections, setCorrections] = useState<Correction[]>([]); const [workDate, setWorkDate] = useState(todayIso()); const [inAt, setInAt] = useState("09:00"); const [outAt, setOutAt] = useState("17:00"); const [reason, setReason] = useState(""); const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const submit = (event: React.FormEvent) => { event.preventDefault(); const result = submitAttendanceCorrection({ workDate, inAt: new Date(`${workDate}T${inAt}`).toISOString(), outAt: outAt ? new Date(`${workDate}T${outAt}`).toISOString() : undefined, reason }); if (!result.ok) { setFeedback({ tone: "error", text: mutationMessage(result.code, locale) }); return; } setCorrections((items) => [{ id: `correction-${Date.now()}`, workDate, inAt, outAt, reason, status: "SUBMITTED" }, ...items]); setReason(""); setFeedback({ tone: "success", text: locale === "ar" ? "تم إرسال التصحيح للمراجعة." : "Correction submitted for review." }); };
  return <main className="page"><PageHeader title={locale === "ar" ? "تصحيحات الحضور" : "Attendance corrections"} subtitle={locale === "ar" ? "الموافقة تضيف أحداثًا جديدة ولا تعيد كتابة السجل الأصلي." : "Approval appends new events and never rewrites the original record."} /><Banner tone="warning"><strong>{locale === "ar" ? "سجل تدقيقي محفوظ" : "Append-only audit"}</strong> {locale === "ar" ? "عند الموافقة ستُضاف أحداث جديدة، وتبقى الأحداث الأصلية محفوظة." : "When approved, new events are appended while original events remain preserved."}</Banner>{feedback ? <Banner tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.text}</Banner> : null}<section className="work-surface"><h2>{locale === "ar" ? "إرسال تصحيح" : "Submit a correction"}</h2><form onSubmit={submit}><div className="form-grid"><label className="field"><span className="field-label">{locale === "ar" ? "اليوم" : "Day"}</span><input className="input" required type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></label><label className="field"><span className="field-label">{locale === "ar" ? "وقت الحضور" : "Proposed in"}</span><input className="input" required type="time" value={inAt} onChange={(e) => setInAt(e.target.value)} /></label><label className="field"><span className="field-label">{locale === "ar" ? "وقت الانصراف" : "Proposed out"}</span><input className="input" type="time" value={outAt} onChange={(e) => setOutAt(e.target.value)} /></label></div><label className="field"><span className="field-label">{locale === "ar" ? "السبب (إلزامي)" : "Reason (required)"}</span><textarea className="textarea" required value={reason} onChange={(e) => setReason(e.target.value)} /></label><button type="submit" className="btn btn-primary">{locale === "ar" ? "إرسال للمراجعة" : "Submit for review"}</button></form></section><section className="work-surface section"><h2>{locale === "ar" ? "تصحيحاتي المرسلة" : "My submitted corrections"}</h2>{corrections.length ? <div className="record-list">{corrections.map((correction) => <article className="record-block" key={correction.id}><div className="record-header-main"><strong><bdi>{formatDate(correction.workDate, locale)}</bdi></strong><StatusPill tone="info" label={locale === "ar" ? "مُرسل للمراجعة" : "Submitted for review"} /></div><p>{formatTime(new Date(`${correction.workDate}T${correction.inAt}`).toISOString(), locale)} → {correction.outAt || "—"}</p><p className="muted">{correction.reason}</p></article>)}</div> : <EmptyState message={locale === "ar" ? "لم ترسل أي تصحيحات بعد." : "You have not submitted any corrections yet."} />}</section></main>;
}
