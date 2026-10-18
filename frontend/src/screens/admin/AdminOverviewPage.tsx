import { Link, Navigate } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { useServerData } from "../../app/useServerData";
import {
  fetchAttendanceSnapshot,
  type AttendanceHistoryState,
  type AttendanceSnapshot,
  type AttendanceSnapshotEmployee,
} from "../../app/attendanceApi";
import { formatDate } from "../../app/format";
import { t as translate, type Dict } from "../../i18n/dict";
import { Banner, EmptyState, ErrorState, SkeletonRows, StatusPill } from "../../components/ui";
import OperationalTable, { type OperationalColumn } from "../../components/data/OperationalTable";
import PageHeader from "../../components/layout/PageHeader";
import AdminNav from "./AdminNav";

/**
 * Overview page - the organisation's attendance day, read from the server.
 *
 * Brief H33 rendered this screen as an honest unavailable state because the
 * backend exposed no attendance endpoint. It does now: GET /attendance/snapshot
 * answers HR with the day, the schedule in force, the counts per state and every
 * active employee's derived row, so the panel shows the real day instead of a
 * banner that is no longer true. The read goes through the ONE server hook - a
 * failed read is a real error with a retry, and a day with no schedule in force
 * says exactly that rather than posing as a working day.
 */

/** The five derived states, in the order the panel reads them. */
const COUNT_ORDER: AttendanceHistoryState[] = ["PRESENT", "ABSENT", "REST_DAY", "INCOMPLETE", "NO_SCHEDULE"];

const STATE_LABEL_KEY: Record<AttendanceHistoryState, keyof Dict> = {
  PRESENT: "attendanceStatusPresent",
  ABSENT: "attendanceStatusAbsent",
  REST_DAY: "attendanceStatusRestDay",
  INCOMPLETE: "attendanceStatusIncomplete",
  NO_SCHEDULE: "attendanceStatusNoSchedule",
};

/** Tone + icon per state, drawn from the shared pill vocabulary. */
const STATE_META = {
  PRESENT: { tone: "success", icon: "approved" },
  ABSENT: { tone: "danger", icon: "rejected" },
  REST_DAY: { tone: "neutral", icon: "draft" },
  INCOMPLETE: { tone: "warning", icon: "pending" },
  NO_SCHEDULE: { tone: "neutral", icon: "draft" },
} as const;

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

/** OperationalTable keys rows by a STRING id; the server's ids are numeric. */
type SnapshotRow = AttendanceSnapshotEmployee & { id: string };

function SnapshotTable({ locale, rows }: { locale: "ar" | "en"; rows: AttendanceSnapshotEmployee[] }) {
  const { t } = useApp();
  const records: SnapshotRow[] = rows.map((row) => ({ ...row, id: String(row.user.id) }));
  const columns: OperationalColumn<SnapshotRow>[] = [
    { key: "name", label: t("employee"), render: (row) => row.user.full_name },
    { key: "firstIn", label: t("attendanceFirstInLabel"), render: (row) => <bdi dir="ltr">{clockTime(row.first_clock_in)}</bdi> },
    { key: "lastOut", label: t("attendanceLastOutLabel"), render: (row) => <bdi dir="ltr">{clockTime(row.last_clock_out)}</bdi> },
    { key: "worked", label: t("attendanceWorkedLabel"), render: (row) => formatWorked(row.worked_minutes, locale) },
    {
      key: "state",
      label: t("attendanceStatusExceptionLabel"),
      render: (row) => <StatusPill tone={STATE_META[row.state].tone} icon={STATE_META[row.state].icon} label={translate(locale, STATE_LABEL_KEY[row.state])} />,
    },
  ];
  return <OperationalTable caption={t("adminOverviewSnapshotRows")} columns={columns} records={records} />;
}

/** The day the server answered: its schedule, its per-state counts, its rows. */
function SnapshotPanel({ snapshot }: { snapshot: AttendanceSnapshot }) {
  const { t, locale } = useApp();
  return (
    <section className="work-surface section">
      <div className="section-heading"><h2>{t("adminOverviewSnapshotCaption")}</h2></div>
      <p className="page-meta">
        {t("attendanceDateLabel")}: {formatDate(`${snapshot.date}T12:00:00Z`, locale)} · {t("attendanceScheduleToday")}: {snapshot.schedule ? snapshot.schedule.name : t("attendanceStatusNoSchedule")}
      </p>
      <div className="summary-strip section">
        {COUNT_ORDER.map((state) => (
          <div className="summary-item" key={state}>
            <span className="summary-label">{translate(locale, STATE_LABEL_KEY[state])}</span>
            <strong className="summary-value">{snapshot.counts[state]}</strong>
          </div>
        ))}
      </div>
      {/* A day with no schedule in force is not a working day: say so instead of
          drawing an empty table that would read as "nobody showed up". */}
      {snapshot.schedule === null
        ? <EmptyState message={t("adminOverviewNoSchedule")} />
        : snapshot.employees.length === 0
          ? <EmptyState message={t("adminOverviewNoEmployees")} />
          : <SnapshotTable locale={locale} rows={snapshot.employees} />}
    </section>
  );
}

function SnapshotBody() {
  const { t, locale } = useApp();
  const state = useServerData(() => fetchAttendanceSnapshot(null, locale), [locale]);
  return (
    <>
      <PageHeader
        title={t("adminOverviewTitle")}
        subtitle={<>{t("adminOverviewSnapshotPrefix")} {state.phase === "ready" ? formatDate(`${state.data.date}T12:00:00Z`, locale) : "—"}</>}
      />
      <Banner tone="info" role="status">{t("adminOverviewScopeBanner")}</Banner>
      {state.phase === "loading" ? <SkeletonRows rows={4} /> : null}
      {state.phase === "error" ? <ErrorState onRetry={state.retry} /> : null}
      {state.phase === "ready" ? <SnapshotPanel snapshot={state.data} /> : null}
      <p>
        <Link to="/attendance/history">{t("adminOverviewHistoryLink")}</Link>
      </p>
    </>
  );
}

export default function AdminOverviewPage() {
  const { t, capabilities } = useApp();
  usePageTitle(t("adminOverviewTitle"));

  if (!capabilities.canViewOrgAttendance && !capabilities.canSetOrgSchedule && !capabilities.canManageLeaveBalance) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="page">
      <AdminNav />
      <SnapshotBody />
    </div>
  );
}
