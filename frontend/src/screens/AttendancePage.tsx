import { useEffect, useState } from "react";
import { fetchAttendanceToday, recordAttendanceEvent, type AttendanceDay } from "../app/attendanceApi";
import { t as translate } from "../i18n/dict";
import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { Banner, EmptyState } from "../components/ui";
import { ClockIcon, CloseIcon } from "../components/icons";
import PageHeader from "../components/layout/PageHeader";

/**
 * Brief H33 - the attendance record has NO server endpoint yet (punches,
 * derived days, exceptions, schedule resolution all lived only in the deleted
 * mock layer). The frontend may not invent rows, so the three attendance
 * routes keep their shells, headings and copy and render the honest
 * unavailable state; every write affordance stays visible but disabled with a
 * title explaining why, and ClockAction (which AppShell also renders)
 * degrades to the same disabled control.
 */

const noAttendanceCopy = (locale: "ar" | "en") => ({
  banner: locale === "ar"
    ? "الحضور بيتسجّل على الخادم: بصمة الدخول والخروج بتحصل من الزرار، واليوم بيتحسب من جدول الدوام النشط."
    : "Attendance is recorded on the server: the button punches in and out, and the day is derived from the active work schedule.",
  waiting: locale === "ar" ? "مفيش إجراء حضور متاح دلوقتي" : "No attendance action is available right now",
  emptyIntervals: locale === "ar" ? "لا توجد فواصل حضور مؤكدة من الخادم بعد." : "No confirmed attendance intervals from the server yet.",
  emptySchedule: locale === "ar" ? "لا يوجد جدول مؤكد من الخادم بعد." : "No confirmed schedule from the server yet.",
  emptyCorrections: locale === "ar" ? "لا توجد طلبات تصحيح مؤكدة من الخادم بعد." : "No confirmed correction requests from the server yet.",
});

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

export default function AttendancePage() {
  const { t, locale } = useApp(); usePageTitle(t("attendanceTitle"));
  const copy = noAttendanceCopy(locale);
  return <main className="page">
    <PageHeader title={t("attendanceTitle")} subtitle={translate(locale, "attendanceDemoBoundary")} primaryAction={<Link className="btn btn-secondary" to="/attendance/history">{t("attendanceHistoryTitle")}</Link>} />
    <Banner tone="warning" role="alert">{copy.banner}</Banner>
    <TodayPanel />
    <section className="work-surface section">
      <div className="section-heading"><h2>{translate(locale, "attendanceRecentDays")}</h2><Link to="/attendance/history">{translate(locale, "attendanceViewFullHistory")}</Link></div>
      <EmptyState message={copy.emptyIntervals} />
    </section>
  </main>;
}

/**
 * History and corrections keep their filter shells and append-only copy so
 * the design is genuinely unchanged; with no server rows the honest cell in
 * the table body is the state that renders, whatever filter is picked.
 */
function attendanceTableShell(locale: "ar" | "en") {
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
        <tr><td colSpan={7}><EmptyState message={noAttendanceCopy(locale).emptyIntervals} /></td></tr>
      </tbody>
    </table>
  </div>;
}

function AttendanceTable({ locale }: { locale: "ar" | "en" }) {
  return attendanceTableShell(locale);
}

function formatArabicDigits(value: string): string {
  const westernDigits = "0123456789";
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return value.replace(/[0-9]/g, (digit) => arabicDigits[westernDigits.indexOf(digit)]);
}

export function AttendanceHistoryPage() {
  const { locale } = useApp();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filter, setFilter] = useState("ALL");
  /* The range/status decisions wait for real server rows; the shell keeps its
     value so the operator's chosen filter survives the endpoint arriving. */
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
      <Banner tone="warning" role="alert">{noAttendanceCopy(locale).banner}</Banner>
      <Banner tone="info">
        <strong>{translate(locale, "attendanceWhatStatesMean")}</strong> {translate(locale, "attendanceStatesHelp")}
      </Banner>
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
          <p className="table-caption" aria-live="polite">{translate(locale, "taskFiltersShowing").replace("%s", "0").replace("%s", "0")}</p>
        </div>
        <AttendanceTable locale={locale} />
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
