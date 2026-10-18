import { useEffect, useState } from "react";
import {
  fetchAttendanceHistory,
  fetchAttendanceToday,
  recordAttendanceEvent,
  type AttendanceDay,
  type AttendanceHistoryDay,
} from "../app/attendanceApi";
import { ApiError } from "../app/api";
import { t as translate } from "../i18n/dict";
import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { Banner, EmptyState } from "../components/ui";
import { ClockIcon, CloseIcon } from "../components/icons";
import PageHeader from "../components/layout/PageHeader";

/**
 * Brief H33 made the attendance record honest about having no server endpoint;
 * H41 is that endpoint. The day is derived on the server (active work schedule
 * + recorded events), so the history table and the recent-days list now render
 * real rows, and the only empty states left are the ones that are true: no
 * punches today, no schedule in force, or no rows matching the chosen filters.
 */

const noAttendanceCopy = (locale: "ar" | "en") => ({
  banner: locale === "ar"
    ? "الحضور بيتسجّل على الخادم: بصمة الدخول والخروج بتحصل من الزرار، واليوم بيتحسب من جدول الدوام النشط."
    : "Attendance is recorded on the server: the button punches in and out, and the day is derived from the active work schedule.",
  waiting: locale === "ar" ? "مفيش إجراء حضور متاح دلوقتي" : "No attendance action is available right now",
  emptyIntervals: locale === "ar" ? "لا توجد بصمات حضور مسجّلة في هذا اليوم." : "No attendance punches recorded for this day.",
  emptySchedule: locale === "ar" ? "لا يوجد جدول مؤكد من الخادم بعد." : "No confirmed schedule from the server yet.",
  emptyCorrections: locale === "ar" ? "لا توجد طلبات تصحيح مؤكدة من الخادم بعد." : "No confirmed correction requests from the server yet.",
  emptyHistory: locale === "ar" ? "لا توجد أيام مطابقة للفلاتر المختارة." : "No days match the selected filters.",
  failed: locale === "ar" ? "تعذّر تحميل سجل الحضور من الخادم. أعد المحاولة." : "Could not load the attendance history from the server. Retry.",
  invalidRange: locale === "ar" ? "تحقّق من نطاق التاريخ: «من» يجب ألا تكون بعد «إلى»." : "Check the date range: “From” must not be after “To”.",
});

/** The five states a derived day may carry, as the server names them. */
const historyStateLabels = (locale: "ar" | "en"): Record<string, string> => ({
  PRESENT: translate(locale, "attendanceStatusPresent"),
  ABSENT: translate(locale, "attendanceStatusAbsent"),
  REST_DAY: translate(locale, "attendanceStatusRestDay"),
  INCOMPLETE: translate(locale, "attendanceStatusIncomplete"),
  NO_SCHEDULE: translate(locale, "attendanceStatusNoSchedule"),
});

/** HH:MM from the server's ISO timestamp, or an honest dash when there is none. */
function clockTime(iso: string | null): string {
  return iso ? iso.slice(11, 16) : "—";
}

function formatWorked(minutes: number | null, locale: "ar" | "en"): string {
  if (minutes === null) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const suffixH = translate(locale, "attendanceHoursSuffix");
  const suffixM = translate(locale, "attendanceMinutesSuffix");
  return hours > 0 ? `${hours}${suffixH} ${rest}${suffixM}` : `${rest}${suffixM}`;
}

function formatBreak(minutes: number | null, locale: "ar" | "en"): string {
  return minutes === null ? "—" : `${minutes} ${translate(locale, "attendanceBreakShort")}`;
}

export function ClockAction({ compact = false }: { compact?: boolean }) {
  const { locale } = useApp();
  const copy = noAttendanceCopy(locale);
  const [day, setDay] = useState<AttendanceDay | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchAttendanceToday(locale)
      .then((next) => { if (alive) setDay(next); })
      .catch(() => { /* the button stays disabled; the reason is read again on mount */ });
    return () => { alive = false; };
  }, [locale]);

  /* One control for both directions: what it does follows the day the server
     derived, so the button can never offer an action the day refuses. */
  const kind = day?.can_clock_in ? "clock-in" : day?.can_clock_out ? "clock-out" : null;

  const record = async () => {
    if (kind === null) return;
    setBusy(true);
    try {
      await recordAttendanceEvent(kind, locale);
      setDay(await fetchAttendanceToday(locale));
    } catch {
      /* Leave the day as it was: a failed write is not a state change. */
    } finally {
      setBusy(false);
    }
  };

  return <span className={compact ? "quick-clock" : undefined}><button type="button" className="btn btn-secondary" disabled={kind === null || busy} title={kind === null ? (day?.state === "NO_SCHEDULE" ? copy.emptySchedule : copy.waiting) : undefined} onClick={record} aria-label={translate(locale, "attendanceClockInAria")}><ClockIcon />{translate(locale, kind === "clock-out" ? "attendanceClockOut" : "attendanceClockInShort")}</button></span>;
}

function TodayPanel() {
  const { locale } = useApp();
  const copy = noAttendanceCopy(locale);
  const [day, setDay] = useState<AttendanceDay | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchAttendanceToday(locale)
      .then((next) => { if (alive) setDay(next); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [locale]);

  /* A failed read is not «no schedule»: the two say different things. */
  if (failed) return <section className="attendance-grid section"><div className="work-surface"><Banner tone="error" role="alert">{copy.banner}</Banner></div></section>;
  if (day === null) return <section className="attendance-grid section"><div className="work-surface"><EmptyState message={translate(locale, "loading")} /></div></section>;

  const window = day.schedule?.window ?? null;
  return <section className="attendance-grid section">
    <div className="work-surface"><div className="section-heading"><h2>{translate(locale, "attendanceTodayIntervals")}</h2></div>
      {day.events.length === 0
        ? <EmptyState message={copy.emptyIntervals} />
        : <ul className="compact-list">{day.events.map((event) => (
            <li className="compact-row" key={event.id}><div><strong>{translate(locale, event.kind === "CLOCK_OUT" ? "attendanceClockOut" : "attendanceClockInShort")}</strong><div className="page-meta"><bdi dir="ltr">{event.occurred_at.slice(11, 16)}</bdi></div></div></li>
          ))}</ul>}
    </div>
    <div className="work-surface"><div className="section-heading"><h2>{translate(locale, "attendanceScheduleToday")}</h2></div>
      {window === null
        ? <EmptyState message={copy.emptySchedule} />
        : <><p className="page-meta">{day.schedule?.name}</p><ul className="compact-list"><li className="compact-row"><div><bdi dir="ltr">{String(window.start_time).slice(0, 5)} – {String(window.end_time).slice(0, 5)}</bdi>{window.break_minutes > 0 ? <div className="page-meta">{window.break_minutes} · {translate(locale, "attendanceBreakShort")}</div> : null}</div></li></ul></>}
    </div>
  </section>;
}

/** The derived days, as the server returns them: one table, shared by the
 *  recent-days card and the full history screen. */
function AttendanceTable({ locale, rows, emptyMessage }: { locale: "ar" | "en"; rows: AttendanceHistoryDay[]; emptyMessage: string }) {
  const labels = historyStateLabels(locale);
  return <div className="table-wrap">
    <table aria-label={translate(locale, "attendanceTable")}>
      <thead>
        <tr>
          <th>{translate(locale, "attendanceDateLabel")}</th>
          <th>{translate(locale, "attendanceFirstInLabel")}</th>
          <th>{translate(locale, "attendanceLastOutLabel")}</th>
          <th>{translate(locale, "attendanceWorkedLabel")}</th>
          <th>{translate(locale, "attendanceBreakLabel")}</th>
          <th>{translate(locale, "attendanceStatusExceptionLabel")}</th>
          <th>{translate(locale, "attendanceActionLabel")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0
          ? <tr><td colSpan={7}><EmptyState message={emptyMessage} /></td></tr>
          : rows.map((row) => (
            <tr key={row.date}>
              <td><bdi dir="ltr">{locale === "ar" ? formatArabicDigits(row.date) : row.date}</bdi></td>
              <td><bdi dir="ltr">{clockTime(row.first_clock_in)}</bdi></td>
              <td><bdi dir="ltr">{clockTime(row.last_clock_out)}</bdi></td>
              <td>{formatWorked(row.worked_minutes, locale)}</td>
              <td>{formatBreak(row.break_minutes, locale)}</td>
              <td>{labels[row.state] ?? row.state}</td>
              <td><Link to="/attendance/corrections">{translate(locale, "attendanceRequestCorrection")}</Link></td>
            </tr>
          ))}
      </tbody>
    </table>
  </div>;
}

/** The last few derived days, read from the same history endpoint. */
function RecentDaysPanel() {
  const { locale } = useApp();
  const copy = noAttendanceCopy(locale);
  const [rows, setRows] = useState<AttendanceHistoryDay[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchAttendanceHistory({}, locale)
      .then(({ rows: next }) => { if (alive) setRows(next.slice(0, 7)); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [locale]);

  return <section className="work-surface section">
    <div className="section-heading"><h2>{translate(locale, "attendanceRecentDays")}</h2><Link to="/attendance/history">{translate(locale, "attendanceViewFullHistory")}</Link></div>
    {rows === null
      ? <EmptyState message={translate(locale, "loading")} />
      : <AttendanceTable locale={locale} rows={rows} emptyMessage={copy.emptyIntervals} />}
  </section>;
}

export default function AttendancePage() {
  const { t, locale } = useApp(); usePageTitle(t("attendanceTitle"));
  const copy = noAttendanceCopy(locale);
  return <main className="page">
    <PageHeader title={t("attendanceTitle")} subtitle={translate(locale, "attendanceDemoBoundary")} primaryAction={<Link className="btn btn-secondary" to="/attendance/history">{t("attendanceHistoryTitle")}</Link>} />
    <Banner tone="warning" role="alert">{copy.banner}</Banner>
    <TodayPanel />
    <RecentDaysPanel />
  </main>;
}

function formatArabicDigits(value: string): string {
  const westernDigits = "0123456789";
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return value.replace(/[0-9]/g, (digit) => arabicDigits[westernDigits.indexOf(digit)]);
}

export function AttendanceHistoryPage() {
  const { locale } = useApp();
  const copy = noAttendanceCopy(locale);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [rows, setRows] = useState<AttendanceHistoryDay[] | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /* The range/status filter is the query: every change re-derives on the
     server, so the table can never disagree with the filters above it. */
  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    fetchAttendanceHistory({ from, to, status: filter }, locale)
      .then(({ rows: next, meta }) => {
        if (!alive) return;
        setRows(next);
        setCount(meta.count);
      })
      .catch((failure) => {
        if (!alive) return;
        setRows([]);
        setError(failure instanceof ApiError && failure.status === 422 ? copy.invalidRange : copy.failed);
      });
    return () => { alive = false; };
  }, [from, to, filter, locale, copy.invalidRange, copy.failed]);

  const filterLabels: Record<string, string> = historyStateLabels(locale);
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
      {error ? <Banner tone="error" role="alert">{error}</Banner> : null}
      <section className="section">
        <section className="filter-panel" aria-labelledby="attendance-history-filters-heading">
          <div className="filter-panel-heading">
            <h2 id="attendance-history-filters-heading">{translate(locale, "attendanceHistoryFilters")}</h2>
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
              {/* ds-allow-native-select: dynamic-option picker; listbox rewrite is deferred */}
              <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="ALL">{translate(locale, "attendanceAll")}</option>
                <option value="PRESENT">{translate(locale, "attendanceStatusPresent")}</option>
                <option value="ABSENT">{translate(locale, "attendanceStatusAbsent")}</option>
                <option value="INCOMPLETE">{translate(locale, "attendanceStatusIncomplete")}</option>
                <option value="REST_DAY">{translate(locale, "attendanceStatusRestDay")}</option>
                <option value="NO_SCHEDULE">{translate(locale, "attendanceStatusNoSchedule")}</option>
              </select>
            </label>
          </div>
          {activeFilters.length > 0 ? (
            <div className="applied-filters" aria-live="polite">
              <span>{translate(locale, "taskFiltersApplied")}</span>
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
              <button className="btn btn-secondary" type="button" onClick={clearAllFilters}>{translate(locale, "taskFiltersClearAll")}</button>
            </div>
          ) : null}
        </section>
        <div className="filter-count-line">
          <p className="table-caption" aria-live="polite">
            {translate(locale, "taskFiltersShowing")
              .replace("%s", locale === "ar" ? formatArabicDigits(String(rows?.length ?? 0)) : String(rows?.length ?? 0))
              .replace("%s", locale === "ar" ? formatArabicDigits(String(count)) : String(count))}
          </p>
        </div>
        {rows === null
          ? <EmptyState message={translate(locale, "loading")} />
          : <AttendanceTable locale={locale} rows={rows} emptyMessage={copy.emptyHistory} />}
      </section>
    </main>
  );
}

export function AttendanceCorrectionsPage() {
  const { locale } = useApp();
  const copy = noAttendanceCopy(locale);
  /* Correction submission is append-only on the server once it exists; until
     then the form renders disabled and nothing fabricated is listed below. */
  return <main className="page">
    <PageHeader title={translate(locale, "attendanceCorrectionsTitle")} subtitle={translate(locale, "attendanceCorrectionsSubtitle")} />
    <Banner tone="warning" role="alert">{copy.banner}</Banner>
    <Banner tone="warning"><strong>{translate(locale, "attendanceAppendOnlyTitle")}</strong> {translate(locale, "attendanceAppendOnlyHelp")}</Banner>
    <section className="work-surface">
      <h2>{translate(locale, "attendanceSubmitCorrectionTitle")}</h2>
      <form onSubmit={(event) => event.preventDefault()}>
        <div className="form-grid">
          <label className="field"><span className="field-label">{translate(locale, "attendanceCorrectionDay")}</span><input className="input" required type="date" disabled title={copy.waiting} onChange={() => undefined} /></label>
          <label className="field"><span className="field-label">{translate(locale, "attendanceProposedIn")}</span><input className="input" required type="time" disabled title={copy.waiting} onChange={() => undefined} /></label>
          <label className="field"><span className="field-label">{translate(locale, "attendanceProposedOut")}</span><input className="input" type="time" disabled title={copy.waiting} onChange={() => undefined} /></label>
        </div>
        <label className="field"><span className="field-label">{translate(locale, "attendanceReasonRequired")}</span><textarea className="textarea" required disabled title={copy.waiting} onChange={() => undefined} /></label>
        <button type="submit" className="btn btn-primary" disabled title={copy.waiting}>{translate(locale, "attendanceSubmitForReview")}</button>
      </form>
    </section>
    <section className="work-surface section">
      <h2>{translate(locale, "attendanceSubmittedCorrections")}</h2>
      <EmptyState message={copy.emptyCorrections} />
    </section>
  </main>;
}
