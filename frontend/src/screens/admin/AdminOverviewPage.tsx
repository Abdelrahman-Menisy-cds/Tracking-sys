import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { Banner, EmptyState, ErrorState, SkeletonRows, StatusPill } from "../../components/ui";
import OperationalTable, { type OperationalColumn } from "../../components/data/OperationalTable";
import PageHeader from "../../components/layout/PageHeader";
import AdjustLeaveDialog, { leaveTypeKeys } from "./AdjustLeaveDialog";
import AdminNav from "./AdminNav";
import {
  cairoDate,
  isPublicHoliday,
  type AttendanceDay,
  type AttendanceDayStatus,
  type DemoIdentity,
  type LeaveBalance,
} from "../../mock/attendance";
import { demoUser, employeeDirectory, findDirectoryEntry } from "../../mock/data";

type DictKey = keyof import("../../i18n/dict").Dict;

/**
 * Overview page — spec §3 (today-only org attendance snapshot).
 * Derived strictly from the committed per-identity attendance fixtures;
 * full history lives at /attendance/history and is linked, never embedded.
 */
type OverviewBucket = "PRESENT" | "ABSENT" | "LEAVE" | "INCOMPLETE" | "OPEN";

const bucketFor = (status: AttendanceDayStatus): OverviewBucket => {
  if (status === "PRESENT" || status === "REMOTE") return "PRESENT";
  if (status === "ABSENT" || status === "ABSENT_CANDIDATE") return "ABSENT";
  if (status === "LEAVE" || status === "HOLIDAY") return "LEAVE";
  if (status === "OPEN") return "OPEN"; // not clocked in yet — the normal early-day state
  return "INCOMPLETE";
};

const bucketKeys: Record<OverviewBucket, DictKey> = {
  PRESENT: "attendanceStatusPresent",
  ABSENT: "attendanceStatusAbsent",
  LEAVE: "attendanceStatusLeave",
  INCOMPLETE: "attendanceStatusIncomplete",
  OPEN: "adminOverviewNotYetIn",
};

const bucketTones: Record<OverviewBucket, "success" | "danger" | "info" | "warning" | "neutral"> = {
  PRESENT: "success",
  ABSENT: "danger",
  LEAVE: "info",
  INCOMPLETE: "warning",
  OPEN: "neutral", // not a fault — muted, not danger/success
};

/** Minimal local view of an event — derived from the existing fixture events. */
type EventPair = { kind: "CLOCK_IN" | "CLOCK_OUT"; note?: string; occurred_at: string };

type DayRow = {
  identity: DemoIdentity;
  employee: string;
  /** Directory name (demoUser[identity] only matches the three fixture ids). */
  name: { ar: string; en: string };
  day: Pick<AttendanceDay, "first_in_at" | "last_out_at" | "worked_minutes" | "status" | "exception">;
};

/** Derive one employee's today-row from their event fixtures; null = no events (OPEN). */
function todayRowFor(employee: string, events: EventPair[], today: string): DayRow | null {
  const identity = employee === "e1" ? "employee" : employee === "m1" ? "manager" : "hr";
  const dayEvents = events.filter((event) => event.occurred_at.slice(0, 10) === today);
  if (!dayEvents.length) return null;
  const ordered = [...dayEvents].sort((l, r) => l.occurred_at.localeCompare(r.occurred_at));
  // Walk the ordered events: IN opens a pair, OUT closes it — so a lone CLOCK_IN
  // at the end of the day is the only thing that leaves `open` set.
  const open = ordered.reduce<EventPair | null>((prev, e) => {
    if (e.kind === "CLOCK_IN") return e;
    return e.kind === "CLOCK_OUT" ? null : prev;
  }, null);
  let worked = 0;
  let openPair: string | null = null;
  ordered.forEach((event) => {
    if (event.kind === "CLOCK_IN") openPair = event.occurred_at;
    else if (openPair) {
      worked += Math.max(0, Math.round((Date.parse(event.occurred_at) - Date.parse(openPair)) / 60000));
      openPair = null;
    }
  });
  // "On approved leave" arrives as the deriveAttendanceDays LEAVE marker: a
  // lone CLOCK_OUT whose note starts with "LEAVE:" (src/mock/attendance.ts).
  const onLeave = ordered.some((event) => /^LEAVE:/.test(event.note ?? ""));
  const status: AttendanceDayStatus =
    isPublicHoliday(today) && !worked ? "HOLIDAY" : open ? "INCOMPLETE" : worked ? "PRESENT" : onLeave ? "LEAVE" : "OPEN";
  return {
    identity,
    employee,
    name: findDirectoryEntry(employee)?.name ?? demoUser[identity].name,
    day: {
      first_in_at: ordered.find((e) => e.kind === "CLOCK_IN")?.occurred_at ?? null,
      last_out_at: [...ordered].reverse().find((e) => e.kind === "CLOCK_OUT")?.occurred_at ?? null,
      worked_minutes: worked,
      status,
      exception: open ? "MISSING_CLOCK_OUT" : "NONE",
    },
  };
}

/**
 * Today's row per DIRECTORY employee (spec §3 scope is the whole directory).
 * Employees with no events today are still returned, as OPEN rows — the
 * "not clocked in yet" bucket; a person is never dropped from the snapshot.
 */
function todayRows(
  eventsByEmployee: Record<string, EventPair[]>,
  today: string,
): DayRow[] {
  return employeeDirectory.flatMap((entry) => {
    const row = todayRowFor(entry.id, eventsByEmployee[entry.id] ?? [], today);
    const identity: DemoIdentity = entry.id === "e1" ? "employee" : entry.id === "m1" ? "manager" : "hr";
    if (row) return [{ ...row, name: entry.name }];
    return [{
      identity,
      employee: entry.id,
      name: entry.name,
      day: { first_in_at: null, last_out_at: null, worked_minutes: 0, status: "OPEN" as AttendanceDayStatus, exception: "NONE" },
    }];
  });
}

type TableRecord = DayRow & { id: string };

export default function AdminOverviewPage() {
  const { t, locale, capabilities, attendanceEvents } = useApp();
  usePageTitle(t("adminOverviewTitle"));
  const today = cairoDate(new Date());

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [adjustTarget, setAdjustTarget] = useState<{ employeeId: string; type: LeaveBalance["leave_type"] } | null>(null);

  if (!capabilities.canViewOrgAttendance && !capabilities.canSetOrgSchedule && !capabilities.canManageLeaveBalance) {
    return <Navigate to="/" replace />;
  }

  // Honest read lifecycle over the committed fixtures: short simulated fetch,
  // retryable error state, skeleton while pending.
  return <OverviewBody
    key={`${today}-${attempt}`}
    today={today}
    phase={phase}
    setPhase={setPhase}
    retry={() => { setAttempt((current) => current + 1); setPhase("loading"); }}
    t={t}
    locale={locale}
    eventsByEmployee={Object.fromEntries(
      employeeDirectory.map((entry) => [
        entry.id,
        attendanceEvents
          .filter((event) => event.employee === entry.id)
          .map((event) => ({ kind: event.kind, note: event.note, occurred_at: event.occurred_at })),
      ]),
    ) as Record<string, EventPair[]>}
    onAdjust={(employeeId, type) => setAdjustTarget({ employeeId, type })}
    adjustDialog={
      adjustTarget ? (
        <AdjustLeaveDialog
          employeeId={adjustTarget.employeeId}
          employeeName={findDirectoryEntry(adjustTarget.employeeId)?.name[locale]}
          initialLeaveType={adjustTarget.type}
          availableTypes={Object.keys(leaveTypeKeys) as LeaveBalance["leave_type"][]}
          onClose={() => setAdjustTarget(null)}
        />
      ) : null
    }
  />;
}

function OverviewBody({
  today,
  phase,
  setPhase,
  retry,
  t,
  locale,
  eventsByEmployee,
  onAdjust,
  adjustDialog,
}: {
  today: string;
  phase: "loading" | "ready" | "error";
  setPhase: (phase: "loading" | "ready" | "error") => void;
  retry: () => void;
  t: (key: DictKey) => string;
  locale: "ar" | "en";
  eventsByEmployee: Record<DemoIdentity, EventPair[]>;
  onAdjust: (employeeId: string, type: LeaveBalance["leave_type"]) => void;
  adjustDialog: React.ReactNode;
}) {
  // Simulated load of the snapshot; settled on the next tick.
  useMemo(() => {
    const timer = window.setTimeout(() => setPhase("ready"), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "loading"]);
  void retry;

  const rows = useMemo(() => todayRows(eventsByEmployee, today), [eventsByEmployee, today]);
  const buckets = useMemo(() => {
    const grouped: Record<OverviewBucket, DayRow[]> = { PRESENT: [], ABSENT: [], LEAVE: [], INCOMPLETE: [], OPEN: [] };
    rows.forEach((row) => grouped[bucketFor(row.day.status)].push(row));
    return grouped;
  }, [rows]);

  const fmt = (value: number): string => new Intl.NumberFormat(locale).format(value);

  const columns = (bucket: OverviewBucket): OperationalColumn<TableRecord>[] => [
    {
      key: "employee",
      label: t("employee"),
      render: (entry) => <bdi>{entry.name[locale]} ({entry.employee})</bdi>,
    },
    {
      key: "worked",
      label: t("workedMinutes"),
      render: (entry) => {
        return duration(entry.day.worked_minutes, locale);
      },
    },
    {
      key: "times",
      label: `${t("attendanceFirstIn")} – ${t("attendanceLastOut")}`,
      render: (entry) => (
        <bdi dir="ltr">{formatTime(entry.day.first_in_at, locale)} → {formatTime(entry.day.last_out_at, locale)}</bdi>
      ),
    },
    {
      key: "status",
      label: t("status"),
      render: () => <StatusPill tone={bucketTones[bucket]} label={t(bucketKeys[bucket])} />,
    },
    {
      key: "action",
      label: t("attendanceActionLabel"),
      render: (entry) => {
        if (entry.day.status === "INCOMPLETE" || entry.day.status === "OPEN") {
          return <Link className="btn btn-ghost btn-compact" to="/attendance/corrections">{t("attendanceRequestCorrection")}</Link>;
        }
        if (entry.day.status === "PRESENT" || entry.day.status === "REMOTE" || entry.day.status === "LEAVE") {
          return (
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={() => onAdjust(entry.employee, "ANNUAL")}
            >
              {t("adminAdjustBalance")}
            </button>
          );
        }
        return null; // ABSENT deliberately has no action (spec §3 row actions)
      },
    },
  ];

  if (phase === "error") {
    return (
      <div className="page">
        <AdminNav />
        <PageHeader title={t("adminOverviewTitle")} subtitle={`${t("adminOverviewSnapshotPrefix")} ${today}`} />
        <ErrorState onRetry={retry} />
      </div>
    );
  }

  return (
    <div className="page">
      <AdminNav />
      <PageHeader
        title={t("adminOverviewTitle")}
        subtitle={<>{t("adminOverviewSnapshotPrefix")} <bdi dir="ltr">{today}</bdi></>}
      />
      <Banner tone="info" role="status">{t("adminOverviewScopeBanner")}</Banner>
      {phase === "loading" ? (
        <div className="work-surface"><SkeletonRows rows={4} /></div>
      ) : isPublicHoliday(today) && rows.every((row) => row.day.worked_minutes === 0) ? (
        // Genuinely empty day (public holiday per the register): the day is
        // announced in place of the counts — no tables, no per-table error.
        <Banner tone="info">{t("hrPublicHoliday")}</Banner>
      ) : (
        <>
          <div className="summary-strip" aria-live="polite">
            {(["PRESENT", "ABSENT", "LEAVE", "INCOMPLETE", "OPEN"] as OverviewBucket[]).map((bucket) => (
              <div className="summary-item" key={bucket}>
                <span className="summary-label">{t(bucketKeys[bucket])}</span>
                <span className="summary-value">{fmt(buckets[bucket].length)}</span>
              </div>
            ))}
          </div>
          {(["PRESENT", "ABSENT", "LEAVE", "INCOMPLETE", "OPEN"] as OverviewBucket[]).map((bucket) => (
            <section className="work-surface section" key={bucket} aria-labelledby={`overview-${bucket}`}>
              <div className="section-heading">
                <h2 id={`overview-${bucket}`}>{t(bucketKeys[bucket])}</h2>
                <span className="page-meta">{fmt(buckets[bucket].length)}</span>
              </div>
              {buckets[bucket].length ? (
                <OperationalTable
                  caption={t(bucketKeys[bucket])}
                  columns={columns(bucket)}
                  records={buckets[bucket].map((entry, index) => ({ ...entry, id: `${bucket}-${entry.employee}-${index}` }))}
                />
              ) : (
                <EmptyState message={t("adminOverviewEmptyTable")} />
              )}
            </section>
          ))}
          <p>
            <Link to="/attendance/history">{t("adminOverviewHistoryLink")}</Link>
          </p>
        </>
      )}
      {adjustDialog}
    </div>
  );
}

const formatTime = (value: string | null, locale: "ar" | "en"): string =>
  value ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";

const duration = (minutes: number, locale: "ar" | "en"): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}${locale === "ar" ? "س" : "h"} ${m}${locale === "ar" ? "د" : "m"}`;
};
