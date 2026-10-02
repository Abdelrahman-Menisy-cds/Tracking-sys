import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { ApiError, type ApiFailureKind } from "../../app/api";
import { fetchHolidays, isPartial, refreshHolidays, type RefreshSummary } from "../../app/holidaysApi";
import { Banner, Dialog, EmptyState, ErrorState, SkeletonRows, StatusPill, type StatusTone } from "../../components/ui";
import OperationalTable, { type OperationalColumn } from "../../components/data/OperationalTable";
import PageHeader from "../../components/layout/PageHeader";
import AdjustLeaveDialog, { leaveTypeKeys } from "./AdjustLeaveDialog";
import ScheduleEditorDialog from "./ScheduleEditorDialog";
import AdminNav from "./AdminNav";
import { ChevronDownIcon, EditIcon, FilterIcon, InfoIcon, SearchIcon, TrashIcon } from "../../components/icons";
import type { Dict, Locale } from "../../i18n/dict";
import type {
  LeaveBalance,
  PublicHoliday,
  WorkSchedule,
} from "../../mock/attendance";
import { findDirectoryEntry } from "../../mock/data";

type DictKey = keyof Dict;

/**
 * Organization settings — spec §1 (schedule, leave entitlement table, public
 * holidays register, and the disabled-by-design AI control §1.4), with the
 * §5 mutation lifecycle, §6 RTL rules and §7 responsive layout.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateIsValid = (value: string): boolean => ISO_DATE.test(value) && Number.isFinite(new Date(`${value}T12:00:00Z`).getTime());

const weekdayLabel = (weekday: number, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, { weekday: "long" }).format(new Date(Date.UTC(2023, 0, 1 + weekday)));

const numText = (value: number, locale: Locale): string => new Intl.NumberFormat(locale).format(value);

const fullDate = (value: string, locale: Locale): string =>
  dateIsValid(value) ? new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(new Date(`${value}T12:00:00Z`)) : value;

const weekDayOf = (value: string, locale: Locale): string =>
  dateIsValid(value) ? new Intl.DateTimeFormat(locale, { weekday: "long" }).format(new Date(`${value}T12:00:00Z`)) : "";

const fmtDateTime = (value: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const cairoDateLocal = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).reduce<Record<string, string>>((result, part) => { result[part.type] = part.value; return result; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/** Demo fixture ids → identity names for `recorded_by` on adjustments. */
const recordedBy = (code: string, locale: Locale): string => {
  const names: Record<string, string> = locale === "ar"
    ? { e1: "كريم مصطفى", m1: "هالة عبد الرحمن", hr1: "منى شريف" }
    : { e1: "Karim Mostafa", m1: "Hala Abdelrahman", hr1: "Mona Sherif" };
  return names[code] ?? code;
};

type VersionState = "IN_FORCE" | "UPCOMING" | "SUPERSEDED";
const versionState = (schedule: WorkSchedule, today: string): VersionState => {
  if (schedule.effective_from > today) return "UPCOMING";
  if (schedule.effective_to && schedule.effective_to < today) return "SUPERSEDED";
  return "IN_FORCE";
};
const versionMeta: Record<VersionState, { tone: StatusTone; key: DictKey }> = {
  IN_FORCE: { tone: "success", key: "adminSettingsVersionInForce" },
  UPCOMING: { tone: "info", key: "adminSettingsVersionUpcoming" },
  SUPERSEDED: { tone: "neutral", key: "adminSettingsVersionSuperseded" },
};

type HolidayMutation = "add" | "edit" | "delete";

export default function AdminSettingsPage() {
  const { t, locale, capabilities, schedules } = useApp();
  usePageTitle(t("adminNavSettings"));
  const today = cairoDateLocal(new Date());

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  // Honest read lifecycle over the committed fixtures (same pattern as Overview).
  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setTimeout(() => setPhase("ready"), 350);
    return () => window.clearTimeout(timer);
  }, [phase, attempt]);

  if (!capabilities.canSetOrgSchedule && !capabilities.canManageLeaveBalance && !capabilities.canManageHolidays) {
    return <Navigate to="/" replace />;
  }

  if (phase === "error") {
    return (
      <div className="page">
        <AdminNav />
        <PageHeader title={t("adminNavSettings")} />
        <ErrorState onRetry={() => { setAttempt((current) => current + 1); setPhase("loading"); }} />
      </div>
    );
  }

  return (
    <div className="page">
      <AdminNav />
      <PageHeader title={t("adminNavSettings")} subtitle={t("adminSubtitle")} />
      <Banner tone="info">{t("adminDemoBoundary")}</Banner>
      {phase === "loading" ? (
        <section className="work-surface" aria-busy="true">
          <SkeletonRows rows={3} />
        </section>
      ) : (
        <SettingsBody
          key={`${attempt}-${locale}`}
          today={today}
          t={t as (key: DictKey) => string}
          locale={locale}
          schedules={schedules.filter((schedule) => schedule.scope === "ORGANIZATION")}
          canSchedule={capabilities.canSetOrgSchedule}
          canLeave={capabilities.canManageLeaveBalance}
          canHolidays={capabilities.canManageHolidays}
        />
      )}
    </div>
  );
}

function SettingsBody({
  today,
  t,
  locale,
  schedules,
  canSchedule,
  canLeave,
  canHolidays,
}: {
  today: string;
  t: (key: DictKey) => string;
  locale: Locale;
  schedules: WorkSchedule[];
  canSchedule: boolean;
  canLeave: boolean;
  canHolidays: boolean;
}) {
  return (
    <div className="dashboard-grid">
      {canSchedule ? <ScheduleCard today={today} t={t} locale={locale} orgSchedules={schedules} /> : null}
      {canHolidays ? <HolidaysCard t={t} locale={locale} today={today} /> : null}
      {canLeave ? (
        <div style={{ gridColumn: "1 / -1" }}>
          <LeaveSection />
        </div>
      ) : null}
    </div>
  );
}

/* ============================ §1.1 Work schedule card ============================ */

function ScheduleCard({ today, t, locale, orgSchedules }: { today: string; t: (key: DictKey) => string; locale: Locale; orgSchedules: WorkSchedule[] }) {
  const { setWorkSchedule } = useApp();
  const current = useMemo(
    () =>
      orgSchedules
        .filter((schedule) => schedule.effective_from <= today && (!schedule.effective_to || today <= schedule.effective_to))
        .sort((l, r) => r.effective_from.localeCompare(l.effective_from))[0] ?? null,
    [orgSchedules, today],
  );
  const versions = useMemo(() => [...orgSchedules].sort((l, r) => r.effective_from.localeCompare(l.effective_from)), [orgSchedules]);

  const [showVersions, setShowVersions] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  /** null = "New version"; a schedule = editing/deriving that row in the editor. */
  const [editing, setEditing] = useState<WorkSchedule | null | undefined>(undefined);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const openEditor = (target: WorkSchedule | null) => {
    setEditing(target);
    setEditorOpen(true);
  };

  // First-run empty state (spec §1.1): no schedule at all → editor auto-opens.
  useEffect(() => {
    if (current === null && orgSchedules.length === 0) setEditorOpen(true);
  }, [current, orgSchedules.length]);

  return (
    <section className="work-surface section" aria-labelledby="settings-schedule-heading" id="settings-schedule">
      <div className="section-heading">
        <h2 id="settings-schedule-heading">{t("adminOrgScheduleTitle")}</h2>
        <span className="page-meta">{t("adminCurrentSchedule")}</span>
      </div>

      {/* Current schedule summary — read-only, never carries edit affordances */}
      <div className="quiet-inset">
        {current ? (
          <dl className="decision-facts">
            <div>
              <dt>{t("adminWorkingWeekdays")}</dt>
              <dd>{current.working_weekdays.map((weekday) => weekdayLabel(weekday, locale)).join(locale === "ar" ? "، " : ", ")}</dd>
            </div>
            <div>
              <dt>{t("attendanceExpected")}</dt>
              <dd><bdi dir="ltr">{current.expected_start}</bdi> – <bdi dir="ltr">{current.expected_end}</bdi></dd>
            </div>
            <div>
              <dt>{t("adminExpectedDailyMinutes")}</dt>
              <dd>{numText(current.expected_daily_minutes, locale)}</dd>
            </div>
            <div>
              <dt>{t("adminGraceMinutes")}</dt>
              <dd>{numText(current.grace_minutes, locale)}</dd>
            </div>
            <div>
              <dt>{t("adminCurrentSchedule")}</dt>
              <dd><bdi dir="ltr">{current.effective_from}</bdi> → <bdi dir="ltr">{current.effective_to ?? "—"}</bdi></dd>
            </div>
          </dl>
        ) : (
          <p className="page-meta">{t("adminNoCurrentSchedule")}</p>
        )}
      </div>

      {feedback ? (
        <Banner tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.text}</Banner>
      ) : null}

      <button type="button" className="btn btn-secondary" aria-expanded={showVersions} onClick={() => setShowVersions((open) => !open)}>
        <ChevronDownIcon />
        {showVersions ? t("adminSettingsVersionsHide") : t("adminSettingsVersionsShow").replace("%s", numText(versions.length, locale))}
      </button>
      {showVersions ? (
        <ul className="compact-list" style={{ marginBlockStart: "var(--sp-4)" }}>
          {versions.map((version) => {
            const meta = versionMeta[versionState(version, today)];
            return (
              <li className="compact-row" key={version.id}>
                <div>
                  <strong><bdi dir="ltr">{version.effective_from}</bdi> → <bdi dir="ltr">{version.effective_to ?? "—"}</bdi></strong>
                  <div className="page-meta">
                    {version.working_weekdays.map((weekday) => weekdayLabel(weekday, locale)).join(locale === "ar" ? "، " : ", ")}
                    {" · "}
                    <bdi dir="ltr">{version.expected_start}–{version.expected_end}</bdi>
                    {" · "}
                    {numText(version.expected_daily_minutes, locale)} +{numText(version.grace_minutes, locale)}
                  </div>
                </div>
                <div className="row-actions">
                  <StatusPill tone={meta.tone} label={t(meta.key)} />
                  <button type="button" className="btn btn-ghost btn-compact" onClick={() => openEditor(version)}>
                    {t("adminSettingsOpenInEditor")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="form-actions" style={{ marginBlockStart: "var(--sp-4)" }}>
        <button type="button" className="btn btn-primary" onClick={() => openEditor(null)}>
          {t("adminSettingsNewVersion")}
        </button>
      </div>

      {editorOpen ? (
        <ScheduleEditorDialog
          today={today}
          t={t}
          locale={locale}
          base={editing === undefined ? null : editing ?? null}
          onClose={() => { setEditorOpen(false); setEditing(undefined); }}
          onSaved={(ok, message) => {
            setEditorOpen(false);
            setEditing(undefined);
            setFeedback({ tone: ok ? "success" : "error", text: message });
          }}
          saveSchedule={setWorkSchedule}
        />
      ) : null}
    </section>
  );
}

/* ==================== §1.2 Leave entitlement table + §Employee rows ==================== */

function LeaveSection() {
  const { t, locale, directoryLeaveBalances, leaveBalances, leaveBalanceSummary } = useApp();
  // The three fixture identities carry live balances that the context
  // mutation actually updates; other directory rows stay at their derived
  // defaults (see the honest-demo note in the report).
  const rows = useMemo(() => {
    const live = new Map(leaveBalances.map((balance) => [`${balance.employee}-${balance.leave_type}`, balance]));
    const merged = [...directoryLeaveBalances];
    return merged.map((row) => live.get(`${row.employee}-${row.leave_type}`) ?? row);
  }, [directoryLeaveBalances, leaveBalances]);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [periodFilter, setPeriodFilter] = useState("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<{ employeeId: string; type: LeaveBalance["leave_type"] } | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const periods = useMemo(() => [...new Set(rows.map((row) => row.period))], [rows]);
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const entry = findDirectoryEntry(row.employee);
        const name = entry?.name[locale] ?? "";
        const number = entry?.employee_number ?? "";
        const matchSearch = !search.trim() || `${name} ${number} ${row.employee}`.toLowerCase().includes(search.trim().toLowerCase());
        const matchType = typeFilter === "ALL" || row.leave_type === typeFilter;
        const matchPeriod = periodFilter === "ALL" || row.period === periodFilter;
        return matchSearch && matchType && matchPeriod;
      }),
    [rows, search, typeFilter, periodFilter, locale],
  );

  const activeFilters = [
    search.trim() ? { key: "search", label: `"${search.trim()}"` } : null,
    typeFilter !== "ALL" ? { key: "type", label: t(leaveTypeKeys[typeFilter as LeaveBalance["leave_type"]]) } : null,
    periodFilter !== "ALL" ? { key: "period", label: `${t("adminPeriod")} ${periodFilter}` } : null,
  ].filter(Boolean) as { key: string; label: string }[];

  const clearFilter = (key: string) => {
    if (key === "search") setSearch("");
    if (key === "type") setTypeFilter("ALL");
    if (key === "period") setPeriodFilter("ALL");
  };
  const clearAllFilters = () => { setSearch(""); setTypeFilter("ALL"); setPeriodFilter("ALL"); };

  const typeLabels = useMemo(() => Object.keys(leaveTypeKeys) as LeaveBalance["leave_type"][], []);
  const employmentTypeKey = (value: string): DictKey => ({ FULL: "hrEmploymentTypeFull", PART: "hrEmploymentTypePart", HYBRID: "hrEmploymentTypeHybrid", REMOTE: "hrEmploymentTypeRemote" } as const)[value as "FULL" | "PART" | "HYBRID" | "REMOTE"] ?? "hrEmploymentTypeFull";

  const fmt = (value: number): string => new Intl.NumberFormat(locale).format(value);

  type RowRecord = (LeaveBalance & { id: string });
  const columns: OperationalColumn<RowRecord>[] = [
    {
      key: "employee",
      label: t("employee"),
      render: (row) => {
        const entry = findDirectoryEntry(row.employee);
        return <bdi>{entry?.name[locale] ?? row.employee} ({entry?.employee_number ?? row.employee})</bdi>;
      },
    },
    {
      key: "type-work",
      label: t("hrEmploymentType"),
      render: (row) => {
        const entry = findDirectoryEntry(row.employee);
        return entry ? <StatusPill tone="neutral" label={t(employmentTypeKey(entry.employment_type))} /> : null;
      },
    },
    {
      key: "leave-type",
      label: t("adminLeaveType"),
      render: (row) => <StatusPill tone="info" label={t(leaveTypeKeys[row.leave_type])} />,
    },
    { key: "entitlement", label: t("adminEntitlement"), render: (row) => fmt(row.entitlement_days) },
    { key: "carry", label: t("adminCarryOver"), render: (row) => fmt(row.carry_over_days) },
    { key: "used", label: t("adminUsedDays"), render: (row) => fmt(row.used_days) },
    { key: "pending", label: t("adminPendingDays"), render: (row) => fmt(row.pending_days) },
    {
      key: "remaining",
      label: t("remainingBalance"),
      render: (row) => <strong>{fmt(leaveBalanceSummary(row).remaining)}</strong>,
    },
    {
      key: "delta",
      label: t("adminAdjustmentsTotal"),
      render: (row) => <bdi dir="ltr">{new Intl.NumberFormat(locale, { signDisplay: "exceptZero" }).format(leaveBalanceSummary(row).adjustments_total)}</bdi>,
    },
    {
      key: "action",
      label: t("attendanceActionLabel"),
      render: (row) => (
        <button
          type="button"
          className="btn btn-ghost btn-compact"
          aria-label={`${t("adminAdjustBalance")} — ${findDirectoryEntry(row.employee)?.name[locale] ?? row.employee}`}
          onClick={() => setAdjustTarget({ employeeId: row.employee, type: row.leave_type })}
        >
          {t("adminAdjustBalance")}
        </button>
      ),
    },
  ];

  return (
    <section className="work-surface section" aria-labelledby="settings-leave-heading" id="settings-leave">
      <div className="section-heading">
        <h2 id="settings-leave-heading">{t("adminSettingsLeaveTitle")}</h2>
        <span className="page-meta">
          {new Intl.NumberFormat(locale).format(filtered.length)} · {t("adminAllEmployees")}
        </span>
      </div>

      <div className="filter-toolbar">
        <label className="field">
          <span className="field-label"><SearchIcon />{t("employee")}</span>
          <input
            className="input"
            type="search"
            aria-label={t("adminSettingsSearchEmployee")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label"><FilterIcon />{t("adminLeaveType")}</span>
          <select className="select" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="ALL">{t("attendanceAll")}</option>
            {typeLabels.map((code) => <option key={code} value={code}>{t(leaveTypeKeys[code])}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label"><FilterIcon />{t("adminPeriod")}</span>
          <select className="select" value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
            <option value="ALL">{t("attendanceAll")}</option>
            {periods.map((period) => <option key={period} value={period}>{period}</option>)}
          </select>
        </label>
      </div>

      {activeFilters.length ? (
        <div className="applied-filters" aria-live="polite">
          <span>{t("attendanceAppliedFilters")}</span>
          {activeFilters.map((filter) => (
            <span className="filter-chip" key={filter.key}>
              {filter.label}
              <button
                type="button"
                className="btn btn-ghost btn-compact chip-clear"
                aria-label={t("attendanceClearFilterAriaTemplate").replace("%s", filter.label)}
                onClick={() => clearFilter(filter.key)}
              >
                ×
              </button>
            </span>
          ))}
          <button type="button" className="btn btn-ghost btn-compact" onClick={clearAllFilters}>{t("attendanceClearAllFilters")}</button>
        </div>
      ) : null}

      {confirmMessage ? <Banner tone="success" role="status">{confirmMessage}</Banner> : null}

      {rows.length === 0 ? (
        <EmptyState message={t("adminOverviewNoEmployees")} />
      ) : filtered.length === 0 ? (
        <EmptyState
          message={t("adminSettingsNoFilteredRows")}
          action={<button type="button" className="btn btn-secondary" onClick={clearAllFilters}>{t("attendanceClearAllFilters")}</button>}
        />
      ) : (
        <>
          <OperationalTable
            caption={`${t("adminSettingsLeaveTitle")} — ${new Intl.NumberFormat(locale).format(filtered.length)}`}
            columns={columns}
            records={filtered.map((row) => ({ ...row, id: `${row.employee}-${row.leave_type}-${row.period}` }))}
          />
          <ul className="compact-list" style={{ marginBlockStart: "var(--sp-4)" }}>
            {filtered.map((row) => {
              const rowId = `${row.employee}-${row.leave_type}`;
              const entry = findDirectoryEntry(row.employee);
              const isOpen = expanded === rowId;
              return (
                <li key={rowId}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    aria-expanded={isOpen}
                    aria-label={`${t("adminSettingsAdjustmentFor").replace("%s", `${entry?.name[locale] ?? row.employee} · ${t(leaveTypeKeys[row.leave_type])}`)}`}
                    onClick={() => setExpanded(isOpen ? null : rowId)}
                  >
                    <ChevronDownIcon className={isOpen ? "is-open" : undefined} />
                    {t("adminAdjustmentsHistory")} — {entry?.name[locale] ?? row.employee} · {t(leaveTypeKeys[row.leave_type])}
                  </button>
                  {isOpen ? (
                    row.adjustments.length ? (
                      <ul className="compact-list quiet-inset">
                        {row.adjustments.map((adjustment) => (
                          <li className="compact-row" key={adjustment.id}>
                            <div>
                              <bdi dir="ltr">{new Intl.NumberFormat(locale, { signDisplay: "exceptZero" }).format(adjustment.days)}</bdi>
                              {" — "}{adjustment.reason}
                              <div className="page-meta">
                                {recordedBy(adjustment.recorded_by, locale)} · <bdi>{fmtDateTime(adjustment.created_at, locale)}</bdi>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState message={t("adminNoAdjustments")} />
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {adjustTarget ? (
        <AdjustLeaveDialog
          key={`adjust-${resetKey}`}
          employeeId={adjustTarget.employeeId}
          employeeName={findDirectoryEntry(adjustTarget.employeeId)?.name[locale]}
          initialLeaveType={adjustTarget.type}
          availableTypes={typeLabels}
          onClose={(outcome) => {
            setAdjustTarget(null);
            setResetKey((current) => current + 1);
            if (outcome.ok) setConfirmMessage(t("adminBalanceAdjusted"));
          }}
        />
      ) : null}
    </section>
  );
}

/* ==================== §1.3 Public holidays register + §1.4 AI control ==================== */

/** What the §1.4 control is doing right now. Every state is a real observation. */
type AiControlState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; summary: RefreshSummary }
  | { kind: "failed"; reason: ApiFailureKind; message: string };

function HolidaysCard({ t, locale, today }: { t: (key: DictKey) => string; locale: Locale; today: string }) {
  const { publicHolidays } = useApp();
  const year = Number(today.slice(0, 4)) || new Date().getFullYear();
  /**
   * The register. Server-backed whenever the API answers; the demo fixtures otherwise.
   * `backing` is what the UI reports as the source — never silently mixed.
   */
  const [holidays, setHolidays] = useState<PublicHoliday[]>(() => structuredClone(publicHolidays));
  const [backing, setBacking] = useState<"server" | "demo">("demo");
  const [loadFailure, setLoadFailure] = useState<{ reason: ApiFailureKind; message: string } | null>(null);
  const [ai, setAi] = useState<AiControlState>({ kind: "idle" });
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [dialog, setDialog] = useState<{ kind: HolidayMutation; target: PublicHoliday | null } | null>(null);

  /** Read the register from the server. Never falls back to faking a successful load. */
  useEffect(() => {
    let cancelled = false;
    fetchHolidays(year)
      .then((rows) => {
        if (cancelled) return;
        setHolidays(rows);
        setBacking("server");
        setLoadFailure(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const failure = describeApiFailure(error);
        setBacking("demo");
        setLoadFailure(failure);
      });
    return () => { cancelled = true; };
  }, [year]);

  const runRefresh = async () => {
    setAi({ kind: "loading" });
    setFeedback(null);
    try {
      const summary = await refreshHolidays(year);
      // Re-read rather than trusting what we think changed.
      const rows = await fetchHolidays(year);
      setHolidays(rows);
      setBacking("server");
      setLoadFailure(null);
      setAi({ kind: "done", summary });
    } catch (error) {
      setAi({ kind: "failed", ...describeApiFailure(error) });
    }
  };

  const sorted = useMemo(
    () => [...holidays].sort((l, r) => l.date.localeCompare(r.date)),
    [holidays],
  );
  const pastCount = sorted.filter((holiday) => holiday.date < today).length;
  const upcoming = sorted.filter((holiday) => holiday.date >= today);
  const past = sorted.filter((holiday) => holiday.date < today);

  const applyMutation = (kind: HolidayMutation, value: PublicHoliday) => {
    setHolidays((current) => {
      if (kind === "add") return [...current, value];
      if (kind === "edit") return current.map((holiday) => (holiday.id === value.id ? value : holiday));
      return current.filter((holiday) => holiday.id !== value.id);
    });
  };

  return (
    <section className="work-surface section" aria-labelledby="settings-holidays-heading" id="settings-holidays">
      <div className="section-heading">
        <h2 id="settings-holidays-heading">{t("hrHolidaysTitle")}</h2>
        <div className="row-actions">
          <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: "add", target: null })}>
            {t("adminSettingsHolidaysAdd")}
          </button>
          {/* §1.4 — the control is real now. It reports what the server actually did. */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={runRefresh}
            disabled={ai.kind === "loading"}
            aria-busy={ai.kind === "loading"}
          >
            <InfoIcon />
            {ai.kind === "loading" ? t("adminSettingsAiWorking") : t("adminSettingsAiLabel")}
          </button>
        </div>
      </div>
      <span className="holiday-soon-note">{t("adminSettingsAiNote")}</span>

      {/* Which register is on screen, stated plainly. */}
      {backing === "demo" && loadFailure ? (
        <p className="page-meta" style={{ marginBlockStart: "var(--sp-2)" }}>
          {describeLoadFallback(loadFailure, t)}
        </p>
      ) : null}

      {ai.kind === "done" ? (
        <Banner tone={isPartial(ai.summary) ? "warning" : "success"} role="status">
          {summariseRefresh(ai.summary, locale, t)}
        </Banner>
      ) : null}
      {ai.kind === "failed" ? (
        <Banner tone="error" role="alert">{describeRefreshFailure(ai, t)}</Banner>
      ) : null}

      {feedback ? (
        <Banner tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.text}</Banner>
      ) : null}

      {holidays.length === 0 ? (
        <EmptyState
          message={t("adminSettingsHolidaysEmpty")}
          action={<button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: "add", target: null })}>{t("adminSettingsAddFirstHoliday")}</button>}
        />
      ) : (
        <>
          <ul className="compact-list" style={{ marginBlockStart: "var(--sp-2)" }}>
            {upcoming.map((holiday) => (
              <HolidayRow
                key={holiday.id}
                holiday={holiday}
                t={t}
                locale={locale}
                onEdit={() => setDialog({ kind: "edit", target: holiday })}
                onDelete={() => setDialog({ kind: "delete", target: holiday })}
              />
            ))}
          </ul>
          {pastCount > 0 ? (
            <details style={{ marginBlockStart: "var(--sp-3)" }}>
              <summary className="page-meta" style={{ cursor: "pointer", paddingBlock: "var(--sp-2)" }}>
                {t("adminSettingsPastToggle").replace("%s", numText(pastCount, locale))}
              </summary>
              <ul className="compact-list">
                {past.map((holiday) => (
                  <HolidayRow
                    key={holiday.id}
                    holiday={holiday}
                    t={t}
                    locale={locale}
                    onEdit={() => setDialog({ kind: "edit", target: holiday })}
                    onDelete={() => setDialog({ kind: "delete", target: holiday })}
                  />
                ))}
              </ul>
            </details>
          ) : null}
          <p className="page-meta" style={{ marginBlockStart: "var(--sp-3)" }}>{t("adminSettingsHolidaysTotal").replace("%s", numText(holidays.length, locale))}</p>
        </>
      )}

      {dialog?.kind === "add" || dialog?.kind === "edit" ? (
        <HolidayFormDialog
          t={t}
          target={dialog.target}
          onClose={() => setDialog(null)}
          onSaved={(ok, holiday, message) => {
            setDialog(null);
            if (ok && holiday) applyMutation(dialog.kind, holiday);
            setFeedback({ tone: ok ? "success" : "error", text: message });
          }}
        />
      ) : dialog?.kind === "delete" && dialog.target ? (
        <HolidayDeleteDialog
          t={t}
          locale={locale}
          target={dialog.target}
          onClose={() => setDialog(null)}
          onSaved={(ok, holiday, message) => {
            setDialog(null);
            if (ok && holiday) applyMutation("delete", holiday);
            setFeedback({ tone: ok ? "success" : "error", text: message });
          }}
        />
      ) : null}
    </section>
  );
}

/** Map a thrown value to the honest reason the control will report. */
function describeApiFailure(error: unknown): { reason: ApiFailureKind; message: string } {
  if (error instanceof ApiError) return { reason: error.kind, message: error.message };
  return { reason: "unreachable", message: error instanceof Error ? error.message : String(error) };
}

/** Why the register on screen is the demo one, said without pretending. */
function describeLoadFallback(failure: { reason: ApiFailureKind }, t: (key: DictKey) => string): string {
  if (failure.reason === "unauthenticated") return t("adminSettingsAiNotSignedIn");
  if (failure.reason === "forbidden") return t("adminSettingsAiNotAllowed");
  return t("adminSettingsAiServerUnreachable");
}

/** The refresh outcome, from the server's own summary — counts, not adjectives. */
function summariseRefresh(summary: RefreshSummary, locale: Locale, t: (key: DictKey) => string): string {
  const n = (value: number) => numText(value, locale);
  const parts = [
    t("adminSettingsAiAdded").replace("%s", n(summary.added)),
    t("adminSettingsAiUpdated").replace("%s", n(summary.updated)),
    t("adminSettingsAiPreserved").replace("%s", n(summary.manual_preserved)),
  ];
  // The AI's own contribution belongs in the summary: without it a run that added
  // nothing official but proposed two Islamic holidays reads as "nothing happened".
  if (summary.proposed_missing > 0) {
    parts.push(t("adminSettingsAiProposedCount").replace("%s", n(summary.proposed_missing)));
  }
  const line = `${t("adminSettingsAiDonePrefix")} ${parts.join(" · ")}`;
  // A dead LLM is a PARTIAL result: the official import landed, the Arabic/proposals did not.
  return summary.llm_available
    ? line
    : `${line} — ${t("adminSettingsAiLlmUnavailable")}`;
}

/** A failed refresh names the reason. It never reads as a success. */
function describeRefreshFailure(state: { reason: ApiFailureKind }, t: (key: DictKey) => string): string {
  if (state.reason === "unauthenticated") return t("adminSettingsAiFailedAuth");
  if (state.reason === "forbidden") return t("adminSettingsAiFailedForbidden");
  if (state.reason === "unreachable") return t("adminSettingsAiFailedUnreachable");
  return t("adminSettingsAiFailedServer");
}

function HolidayRow({ holiday, t, locale, onEdit, onDelete }: { holiday: PublicHoliday; t: (key: DictKey) => string; locale: Locale; onEdit: () => void; onDelete: () => void }) {
  // Provenance, when the row came from the server. A proposal is NOT an official
  // holiday, so it gets its own tone and its own label — never the default one.
  const badge = holiday.needsConfirmation
    ? { tone: "warning" as StatusTone, label: t("adminSettingsAiProposed") }
    : holiday.isManualOverride
      ? { tone: "info" as StatusTone, label: t("adminSettingsAiManual") }
      : null;

  return (
    <li className="compact-row">
      <div>
        <strong><bdi dir="ltr">{fullDate(holiday.date, locale)}</bdi></strong>
        <div className="page-meta">{weekDayOf(holiday.date, locale)} · {holiday.name[locale]}{holiday.recurring ? ` · ${t("adminSettingsRecurring")}` : ""}</div>
        {badge ? (
          <div style={{ marginBlockStart: "var(--sp-1)" }}>
            <StatusPill tone={badge.tone} label={badge.label} />
          </div>
        ) : null}
      </div>
      <div className="row-actions">
        <button type="button" className="btn btn-ghost btn-compact icon-button" aria-label={t("adminSettingsHolidayEditAria").replace("%s", holiday.name[locale])} onClick={onEdit}>
          <EditIcon />
        </button>
        <button type="button" className="btn btn-ghost btn-compact icon-button" aria-label={t("adminSettingsHolidayDeleteAria").replace("%s", holiday.name[locale])} onClick={onDelete}>
          <TrashIcon />
        </button>
      </div>
    </li>
  );
}

function HolidayFormDialog({
  t,
  target,
  onClose,
  onSaved,
}: {
  t: (key: DictKey) => string;
  target: PublicHoliday | null;
  onClose: () => void;
  onSaved: (ok: boolean, holiday: PublicHoliday | null, message: string) => void;
}) {
  const [date, setDate] = useState(target?.date ?? "");
  const [nameAr, setNameAr] = useState(target?.name.ar ?? "");
  const [nameEn, setNameEn] = useState(target?.name.en ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ date?: boolean; name?: boolean }>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: { date?: boolean; name?: boolean } = {};
    if (!dateIsValid(date)) nextErrors.date = true;
    if (!nameAr.trim() && !nameEn.trim()) nextErrors.name = true;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    window.setTimeout(() => {
      const fallbackEnglish = nameEn.trim() || nameAr.trim();
      const fallbackArabic = nameAr.trim() || nameEn.trim();
      const holiday: PublicHoliday = {
        id: target?.id ?? `hol-demo-${date}`,
        date,
        name: { ar: fallbackArabic, en: fallbackEnglish },
        recurring: false,
      };
      onSaved(true, holiday, target ? t("adminSettingsHolidayUpdated") : t("adminSettingsHolidayAdded"));
    }, 200);
  };

  return (
    <Dialog
      title={target ? t("adminSettingsHolidayEditTitle") : t("adminSettingsHolidaysAdd")}
      busy={submitting}
      dirty={date !== (target?.date ?? "") || nameAr !== (target?.name.ar ?? "") || nameEn !== (target?.name.en ?? "")}
      onClose={onClose}
    >
      <form noValidate onSubmit={submit} aria-busy={submitting}>
        <label className="field">
          <span className="field-label">{t("attendanceDate")}</span>
          <input
            className="input"
            type="date"
            dir="ltr"
            value={date}
            aria-invalid={errors.date ? "true" : undefined}
            aria-describedby={errors.date ? "holiday-date-error" : undefined}
            onChange={(event) => setDate(event.target.value)}
            disabled={submitting}
          />
          {errors.date ? <span className="field-error" id="holiday-date-error" role="alert">{t("adminErrorRequired")}</span> : null}
        </label>
        <label className="field">
          <span className="field-label">{t("hrAnnouncementBody")} ({t("adminSettingsNameArabic")})</span>
          <input
            className="input"
            value={nameAr}
            onChange={(event) => setNameAr(event.target.value)}
            disabled={submitting}
            aria-invalid={errors.name ? "true" : undefined}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("hrAnnouncementBody")} ({t("adminSettingsNameEnglish")})</span>
          <input
            className="input"
            value={nameEn}
            onChange={(event) => setNameEn(event.target.value)}
            disabled={submitting}
            aria-invalid={errors.name ? "true" : undefined}
          />
          {errors.name ? <span className="field-error" role="alert">{t("adminErrorRequired")}</span> : null}
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>{t("cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? (
              <>
                <span className="spinner" aria-hidden="true" />
                {t("adminSettingsSavingHoliday")}
              </>
            ) : (
              target ? t("save") : t("adminSettingsHolidaysAdd")
            )}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function HolidayDeleteDialog({
  t,
  locale,
  target,
  onClose,
  onSaved,
}: {
  t: (key: DictKey) => string;
  locale: Locale;
  target: PublicHoliday;
  onClose: () => void;
  onSaved: (ok: boolean, holiday: PublicHoliday | null, message: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <Dialog title={t("adminSettingsDeleteTitle")} description={t("adminSettingsDeleteDescription")} busy={submitting} onClose={onClose}>
      <p><strong>{target.name[locale]}</strong> · <bdi dir="ltr">{fullDate(target.date, locale)}</bdi></p>
      <form noValidate onSubmit={(event) => {
        event.preventDefault();
        setSubmitting(true);
        window.setTimeout(() => onSaved(true, target, t("adminSettingsHolidayDeleted")), 200);
      }}>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>{t("cancel")}</button>
          <button type="submit" className="btn btn-danger-quiet" disabled={submitting}>
            {submitting ? (
              <>
                <span className="spinner" aria-hidden="true" />
                {t("adminSettingsDeletingHoliday")}
              </>
            ) : (
              t("adminSettingsDeleteBtn")
            )}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export const settingsLocale: Locale = "en";
export const settingsDictProbe: keyof Dict = "adminSettingsAiLabel";
