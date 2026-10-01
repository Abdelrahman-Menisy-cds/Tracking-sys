import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { Banner, Dialog, EmptyState, ErrorState, SkeletonRows, StatusPill, type StatusTone } from "../../components/ui";
import OperationalTable, { type OperationalColumn } from "../../components/data/OperationalTable";
import PageHeader from "../../components/layout/PageHeader";
import AdjustLeaveDialog, { leaveTypeKeys } from "./AdjustLeaveDialog";
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
const timeIsValid = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const nonNegativeInt = (value: string): boolean => Number.isInteger(Number(value)) && Number(value) >= 0;

const weekdayLabel = (weekday: number, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, { weekday: "long" }).format(new Date(Date.UTC(2023, 0, 1 + weekday)));

const numText = (value: number, locale: Locale): string => new Intl.NumberFormat(locale).format(value);

const mediumDate = (value: string, locale: Locale): string =>
  dateIsValid(value) ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${value}T12:00:00Z`)) : value;

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

type ScheduleDraft = {
  working_weekdays: number[];
  expected_start: string;
  expected_end: string;
  expected_daily_minutes: string;
  grace_minutes: string;
  effective_from: string;
  effective_to: string;
};

const defaultDraft = (today: string): ScheduleDraft => ({
  working_weekdays: [0, 1, 2, 3, 4],
  expected_start: "09:00",
  expected_end: "17:00",
  expected_daily_minutes: "480",
  grace_minutes: "15",
  effective_from: today,
  effective_to: "",
});

const toDraft = (schedule: WorkSchedule): ScheduleDraft => ({
  working_weekdays: [...schedule.working_weekdays].sort((l, r) => l - r),
  expected_start: schedule.expected_start,
  expected_end: schedule.expected_end,
  expected_daily_minutes: String(schedule.expected_daily_minutes),
  grace_minutes: String(schedule.grace_minutes),
  effective_from: schedule.effective_from,
  effective_to: schedule.effective_to ?? "",
});

type ScheduleErrors = Partial<Record<ScheduleErrorKey | Exclude<keyof ScheduleDraft, "working_weekdays">, DictKey>>;

function validateSchedule(draft: ScheduleDraft): ScheduleErrors {
  const errors: ScheduleErrors = {};
  if (draft.working_weekdays.length < 1) errors.weekdays = "adminErrorWeekdays";
  if (!timeIsValid(draft.expected_start)) errors.start = "adminErrorRequired";
  if (!timeIsValid(draft.expected_end)) errors.end = "adminErrorRequired";
  else if (!(draft.expected_start < draft.expected_end)) { errors.start = "adminErrorTimeRange"; errors.end = "adminErrorTimeRange"; }
  if (!nonNegativeInt(draft.expected_daily_minutes)) errors.dailyMinutes = "adminErrorMinutes";
  if (!nonNegativeInt(draft.grace_minutes)) errors.graceMinutes = "adminErrorMinutes";
  if (!dateIsValid(draft.effective_from)) errors.effectiveFrom = "adminErrorRequired";
  if (draft.effective_to !== "" && !dateIsValid(draft.effective_to)) errors.effectiveTo = "adminErrorRequired";
  else if (draft.effective_to !== "" && draft.effective_to < draft.effective_from) { errors.effectiveTo = "adminErrorDates"; errors.effectiveFrom = "adminErrorDates"; }
  return errors;
}

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
  const { t, locale, capabilities, schedules, isDemoMode } = useApp();
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
          isDemoMode={isDemoMode}
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
  isDemoMode,
}: {
  today: string;
  t: (key: DictKey) => string;
  locale: Locale;
  schedules: WorkSchedule[];
  canSchedule: boolean;
  canLeave: boolean;
  canHolidays: boolean;
  isDemoMode: boolean;
}) {
  return (
    <div className="dashboard-grid">
      {canSchedule ? <ScheduleCard today={today} t={t} locale={locale} orgSchedules={schedules} /> : null}
      {canHolidays ? <HolidaysCard t={t} locale={locale} today={today} isDemoMode={isDemoMode} /> : null}
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
    <section className="work-surface section" aria-labelledby="settings-schedule">
      <div className="section-heading">
        <h2 id="settings-schedule">{t("adminOrgScheduleTitle")}</h2>
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

type ScheduleErrorKey = "weekdays" | "start" | "end" | "dailyMinutes" | "graceMinutes" | "effectiveFrom" | "effectiveTo";
const scheduleErrorDraftKeys: Record<Exclude<ScheduleErrorKey, "weekdays">, Exclude<keyof ScheduleDraft, "working_weekdays">> = {
  start: "expected_start",
  end: "expected_end",
  dailyMinutes: "expected_daily_minutes",
  graceMinutes: "grace_minutes",
  effectiveFrom: "effective_from",
  effectiveTo: "effective_to",
};

function ScheduleEditorDialog({
  today,
  t,
  locale,
  base,
  onClose,
  onSaved,
  saveSchedule,
}: {
  today: string;
  t: (key: DictKey) => string;
  locale: Locale;
  base: WorkSchedule | null;
  onClose: () => void;
  onSaved: (ok: boolean, message: string) => void;
  saveSchedule: (schedule: WorkSchedule) => { ok: boolean; code?: string };
}) {
  const [draft, setDraft] = useState<ScheduleDraft>(() => (base ? toDraft(base) : defaultDraft(today)));
  const [errors, setErrors] = useState<ScheduleErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const firstInvalidRef = useRef<string | null>(null);

  const toggleWeekday = (weekday: number) =>
    setDraft((current) => ({
      ...current,
      working_weekdays: current.working_weekdays.includes(weekday)
        ? current.working_weekdays.filter((day) => day !== weekday)
        : [...current.working_weekdays, weekday].sort((l, r) => l - r),
    }));

  const setField = (field: keyof ScheduleDraft) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((current) => ({ ...current, [field]: event.target.value }));

  const fieldMeta: Array<{ key: Exclude<keyof ScheduleDraft, "working_weekdays">; labelKey: DictKey; type: string; optional?: boolean }> = [
    { key: "expected_start", labelKey: "attendanceFirstIn", type: "time" },
    { key: "expected_end", labelKey: "attendanceLastOut", type: "time" },
    { key: "expected_daily_minutes", labelKey: "adminExpectedDailyMinutes", type: "number" },
    { key: "grace_minutes", labelKey: "adminGraceMinutes", type: "number" },
    { key: "effective_from", labelKey: "adminEffectiveFrom", type: "date" },
    { key: "effective_to", labelKey: "adminEffectiveTo", type: "date", optional: true },
  ];

  const fieldIds: Record<Exclude<keyof ScheduleDraft, "working_weekdays">, string> = {
    expected_start: "schedule-expected-start",
    expected_end: "schedule-expected-end",
    expected_daily_minutes: "schedule-daily-minutes",
    grace_minutes: "schedule-grace-minutes",
    effective_from: "schedule-effective-from",
    effective_to: "schedule-effective-to",
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateSchedule(draft);
    setErrors(found);
    if (Object.keys(found).length) {
      // Focus the first invalid input (spec §1.1 keyboard contract).
      const firstInvalid = (Object.keys(scheduleErrorDraftKeys) as Array<Exclude<ScheduleErrorKey, "weekdays">>).find((key) => found[key]);
      firstInvalidRef.current = firstInvalid ? fieldIds[scheduleErrorDraftKeys[firstInvalid]] : null;
      if (firstInvalidRef.current) {
        window.setTimeout(() => document.getElementById(firstInvalidRef.current ?? "")?.focus(), 0);
      }
      return;
    }
    setSubmitting(true);
    window.setTimeout(() => {
      const payload: WorkSchedule = {
        id: base?.id ?? `schedule-org-${draft.effective_from}`,
        scope: "ORGANIZATION",
        working_weekdays: [...draft.working_weekdays].sort((l, r) => l - r),
        expected_start: draft.expected_start,
        expected_end: draft.expected_end,
        expected_daily_minutes: Number(draft.expected_daily_minutes),
        grace_minutes: Number(draft.grace_minutes),
        effective_from: draft.effective_from,
        ...(draft.effective_to ? { effective_to: draft.effective_to } : {}),
      };
      const result = saveSchedule(payload);
      if (result.ok) {
        onSaved(true, t("adminSettingsScheduleSaved"));
        return;
      }
      setSubmitting(false);
      onSaved(false, t(result.code === "CAPABILITY_DENIED" ? "adminMutationDenied" : "adminMutationInvalid"));
    }, 200);
  };

  const errorBannerFields = (Object.keys(scheduleErrorDraftKeys) as Array<Exclude<ScheduleErrorKey, "weekdays">>)
    .filter((key) => errors[key])
    .map((key) => {
      const labelKey = fieldMeta.find((field) => field.key === scheduleErrorDraftKeys[key])?.labelKey ?? "adminErrorRequired";
      return t(labelKey);
    });

  const dirty = useMemo(() => {
    if (!base) return true;
    const original = toDraft(base);
    return ["working_weekdays", "expected_start", "expected_end", "expected_daily_minutes", "grace_minutes", "effective_from", "effective_to"].some(
      (key) => JSON.stringify(original[key as keyof ScheduleDraft]) !== JSON.stringify(draft[key as keyof ScheduleDraft]),
    );
  }, [base, draft]);

  return (
    <Dialog
      title={base ? t("adminSettingsEditVersion") : t("adminSettingsNewVersion")}
      description={t("adminAdjustDialogDescription")}
      busy={submitting}
      dirty={dirty}
      onClose={onClose}
    >
      <form noValidate onSubmit={submit} aria-busy={submitting}>
        {Object.keys(errors).length && !submitting ? (
          <Banner tone="error" role="alert">
            <strong>{t("adminSettingsFixFields")}</strong>
            <ul className="decision-facts" style={{ marginBlock: "var(--sp-2)" }}>
              {errorBannerFields.map((label) => <li key={label}>{label}</li>)}
            </ul>
          </Banner>
        ) : null}

        <fieldset className="quiet-inset field" aria-describedby="schedule-weekdays-hint">
          <legend className="field-label">{t("adminWorkingWeekdays")}</legend>
          {[0, 1, 2, 3, 4, 5, 6].map((weekday) => (
            <label className="admin-weekday" key={weekday}>
              <input
                type="checkbox"
                aria-invalid={errors.weekdays ? "true" : undefined}
                checked={draft.working_weekdays.includes(weekday)}
                onChange={() => toggleWeekday(weekday)}
                disabled={submitting}
              />
              <span>{weekdayLabel(weekday, locale)}</span>
            </label>
          ))}
          {errors.weekdays ? <span className="field-error" role="alert">{t(errors.weekdays)}</span> : null}
          <span className="field-hint" id="schedule-weekdays-hint">{t("adminSettingsWeekdaysHint")}</span>
        </fieldset>

        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {fieldMeta.map((field) => (
            <label className="field pair-row" key={field.key} style={{ marginBlockEnd: "var(--sp-3)" }}>
              <span className="field-label">{t(field.labelKey)}</span>
              <input
                id={fieldIds[field.key]}
                className="input"
                type={field.type}
                dir="ltr"
                value={draft[field.key] as string}
                aria-invalid={errors[field.key] ? "true" : undefined}
                aria-describedby={errors[field.key] ? `${fieldIds[field.key]}-error` : undefined}
                onChange={setField(field.key)}
                disabled={submitting}
              />
              {errors[field.key] ? <span className="field-error" id={`${fieldIds[field.key]}-error`}>{t(errors[field.key]!)}</span> : null}
            </label>
          ))}
        </div>

        {/* §1.1 change preview — accent-soft attention strip, never blocking */}
        {Object.keys(errors).length === 0 ? (
          <div className="attention-strip" style={{ background: "var(--accent-soft)", borderColor: "var(--accent-border)", borderInlineStartColor: "var(--accent)" }}>
            <div>
              <strong>
                {base
                  ? t("adminSettingsPreviewUpdate")
                  : t("adminSettingsPreviewCreate").replace("%s", mediumDate(draft.effective_from, locale))}
              </strong>
              <span className="page-meta">{t("adminSettingsPreviewHistory")}</span>
            </div>
          </div>
        ) : null}

        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            {t("cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? (
              <>
                <span className="spinner" aria-hidden="true" />
                {t("adminSettingsSavingSchedule")}
              </>
            ) : (
              t("adminSettingsSaveSchedule")
            )}
          </button>
        </div>
      </form>
    </Dialog>
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
    <section className="work-surface section" aria-labelledby="settings-leave" id="settings-leave">
      <div className="section-heading">
        <h2 id="settings-leave">{t("adminSettingsLeaveTitle")}</h2>
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

function HolidaysCard({ t, locale, today, isDemoMode }: { t: (key: DictKey) => string; locale: Locale; today: string; isDemoMode: boolean }) {
  const { publicHolidays } = useApp();
  /** Local register copy — the demo layer has no holiday mutation; edits live here for the session. */
  const [holidays, setHolidays] = useState<PublicHoliday[]>(() => structuredClone(publicHolidays));
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [dialog, setDialog] = useState<{ kind: HolidayMutation; target: PublicHoliday | null } | null>(null);

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
    <section className="work-surface section" aria-labelledby="settings-holidays" id="settings-holidays">
      <div className="section-heading">
        <h2 id="settings-holidays">{t("hrHolidaysTitle")}</h2>
        <div className="row-actions">
          <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: "add", target: null })}>
            {t("adminSettingsHolidaysAdd")}
          </button>
          {/* §1.4 — disabled by design: planned, never broken */}
          <span className="holiday-soon-wrap" role="note" title={isDemoMode ? t("adminSettingsAiNote") : undefined}>
            <button type="button" className="btn btn-holiday-soon" disabled aria-disabled="true">
              <InfoIcon />{t("adminSettingsAiLabel")}
              <StatusPill tone="neutral" label={t("adminSettingsAiPill")} />
            </button>
          </span>
        </div>
      </div>
      {/* The note text is visible microcopy on mobile (CSS shows it at ⩽639px). */}
      <span className="holiday-soon-note">{t("adminSettingsAiNote")}</span>

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

function HolidayRow({ holiday, t, locale, onEdit, onDelete }: { holiday: PublicHoliday; t: (key: DictKey) => string; locale: Locale; onEdit: () => void; onDelete: () => void }) {
  return (
    <li className="compact-row">
      <div>
        <strong><bdi dir="ltr">{fullDate(holiday.date, locale)}</bdi></strong>
        <div className="page-meta">{weekDayOf(holiday.date, locale)} · {holiday.name[locale]}{holiday.recurring ? ` · ${t("adminSettingsRecurring")}` : ""}</div>
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
