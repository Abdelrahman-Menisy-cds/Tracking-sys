import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { cairoDayIso, formatDateLong, formatWeekdayIndex, formatWeekdayOf } from "../../app/format";
import { ApiError, type ApiFailureKind } from "../../app/api";
import { fetchHolidays, isPartial, refreshHolidays, type RefreshSummary } from "../../app/holidaysApi";
import {
  clockText,
  createWorkSchedule,
  fetchWorkSchedules,
  emptyScheduleDraft,
  payloadFromDraft,
  scheduleFieldIssues,
  type ScheduleDayDraft,
  type ServerWorkSchedule,
  type WorkScheduleDraft,
  type WorkScheduleIssues,
} from "../../app/workSchedulesApi";
import type { PublicHoliday } from "../../app/serverTypes";
import { Banner, Dialog, EmptyState, SkeletonRows, StatusPill, type StatusTone } from "../../components/ui";
import PageHeader from "../../components/layout/PageHeader";
import AdminNav from "./AdminNav";
import { CompanyProfilePanel } from "./CompanyProfilePanel";
import { InfoIcon } from "../../components/icons";
import type { Dict, Locale } from "../../i18n/dict";

type DictKey = keyof Dict;

/**
 * Organization settings - spec §1, now server-backed where the server exists:
 *
 *   • §1.3 Public-holidays register: READ from `GET /holidays` and refreshed
 *     by the §1.4 control (`POST /holidays/refresh`). The manual add/edit/
 *     delete dialogs had no endpoint behind them - they were demo writes, and
 *     they are gone; the register is read-only + refresh, invoices proposals
 *     as proposals, and an empty register is an honest empty state.
 *   • §1.1 Work schedule: READ from `GET /work-schedules` and created through
 *     `POST /work-schedules` with the whole week in one request (H39 - HR
 *     only, the server enforces it again). A failed read is not «no schedule»:
 *     the failure states stay separate. Scope deliberately excludes PATCH/
 *     DELETE UI and leave entitlement; the leave table still has no endpoint
 *     and keeps the honest unavailable state instead of fixture rows.
 *   • Company identity stays on its real GET/PATCH /company widget.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateIsValid = (value: string): boolean => ISO_DATE.test(value) && Number.isFinite(new Date(`${value}T12:00:00Z`).getTime());

const numText = (value: number, locale: Locale): string => new Intl.NumberFormat(locale).format(value);

// Brief H3 - the ONE shared formatting path; no screen-local Intl date formatters.
const fullDate = (value: string, locale: Locale): string =>
  dateIsValid(value) ? formatDateLong(`${value}T12:00:00Z`, locale) : value;

const weekDayOf = (value: string, locale: Locale): string =>
  dateIsValid(value) ? formatWeekdayOf(`${value}T12:00:00Z`, locale) : "";

export default function AdminSettingsPage() {
  const { t, locale, capabilities } = useApp();
  usePageTitle(t("adminNavSettings"));
  const today = cairoDayIso(new Date());

  if (!capabilities.canSetOrgSchedule && !capabilities.canManageLeaveBalance && !capabilities.canManageHolidays) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="page">
      <AdminNav />
      <PageHeader title={t("adminNavSettings")} subtitle={t("adminSubtitle")} />
      <div className="dashboard-grid settings-grid">
        {capabilities.canSetOrgSchedule ? <ScheduleCard t={t as (key: DictKey) => string} locale={locale} /> : null}
        {capabilities.canManageHolidays ? <HolidaysCard t={t as (key: DictKey) => string} locale={locale} today={today} /> : null}
        {capabilities.canManageLeaveBalance ? (
          <div style={{ gridColumn: "1 / -1" }}>
            <LeaveSection t={t as (key: DictKey) => string} locale={locale} />
          </div>
        ) : null}
        {/* H17 - the company identity: its own widget card, full width, server-backed
            (GET/PATCH /company). */}
        <div style={{ gridColumn: "1 / -1" }}>
          <CompanyProfilePanel t={t as (key: DictKey) => string} locale={locale} />
        </div>
      </div>
    </div>
  );
}

/* ============================ §1.1 Work schedule card ============================ */

/**
 * H39 phase 2 - the card reads GET /work-schedules and creates through
 * POST /work-schedules with the whole week in ONE request. Honesty states stay
 * separated: loading is a skeleton, a failed read names its real reason with a
 * retry and never renders as «no schedule yet», a genuinely empty tenant gets
 * the empty state plus the add button, and only the ``is_active`` row reads as
 * the schedule in force. The add button exists for HR (the card itself only
 * renders when capabilities.canSetOrgSchedule) - the server refuses writes
 * again, so the role UI shows here is informational, never the security check.
 */
function ScheduleCard({ t, locale }: { t: (key: DictKey) => string; locale: Locale }) {
  const [schedules, setSchedules] = useState<ServerWorkSchedule[] | null>(null);
  const [failure, setFailure] = useState<{ reason: ApiFailureKind; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  /** Read the schedules from the server. Never fakes a successful load. */
  useEffect(() => {
    let cancelled = false;
    fetchWorkSchedules(locale)
      .then((rows) => {
        if (cancelled) return;
        setSchedules(rows);
        setFailure(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A failed read hides the list: the empty state must not be reachable
        // from a refusal, only from a genuine empty tenant.
        setSchedules([]);
        setFailure(describeApiFailure(error));
      });
    return () => { cancelled = true; };
  }, [locale, attempt]);

  const addButton = (
    <button className="btn btn-primary" type="button" onClick={() => setDialogOpen(true)}>
      {t("adminScheduleAdd")}
    </button>
  );

  const active = schedules?.find((row) => row.is_active) ?? null;
  const inactiveCount = (schedules ?? []).filter((row) => !row.is_active).length;
  const orderedDays = useMemo(
    () => (active ? [...active.days].sort((left, right) => left.weekday - right.weekday) : []),
    [active],
  );

  return (
    <section className="work-surface section" aria-labelledby="settings-schedule-heading" id="settings-schedule">
      <div className="section-heading">
        <h2 id="settings-schedule-heading">{t("adminOrgScheduleTitle")}</h2>
        {schedules && !failure ? <span className="page-meta">{t("adminCurrentSchedule")}</span> : null}
      </div>

      {savedNotice ? <Banner tone="success" role="status">{t("adminScheduleSaved")}</Banner> : null}

      {/* Loading is a skeleton - never an empty card pretending data went missing. */}
      {schedules === null && !failure ? <SkeletonRows rows={2} /> : null}

      {/* A failed read states what ACTUALLY happened, keyed on the failure kind. */}
      {failure ? (
        <div>
          <Banner tone="error" role="alert">{describeScheduleFailure(failure, t)}</Banner>
          <div style={{ marginBlockStart: "var(--sp-3)" }}>
            <button className="btn btn-secondary" type="button" onClick={() => setAttempt((count) => count + 1)} disabled={schedules === null}>
              {t("retry")}
            </button>
          </div>
        </div>
      ) : null}

      {schedules && !failure && active ? (
        <>
          <div className="section-heading">
            <h3 className="schedule-name">{active.name}</h3>
            <StatusPill tone="success" label={t("adminScheduleActivePill")} icon="approved" />
          </div>
          <p className="page-meta">
            {t("adminSchedulePeriodLabel")}: {fullDate(active.effective_from, locale)}
            {active.effective_to ? ` — ${fullDate(active.effective_to, locale)}` : ""}
          </p>
          <ul className="compact-list" style={{ marginBlockStart: "var(--sp-2)" }}>
            {orderedDays.map((day) => (
              <ScheduleDayRow key={day.weekday} day={day} t={t} locale={locale} />
            ))}
          </ul>
          {inactiveCount > 0 ? (
            <p className="page-meta" style={{ marginBlockStart: "var(--sp-3)" }}>
              {t("adminScheduleInactiveNote").replace("%s", numText(inactiveCount, locale))}
            </p>
          ) : null}
        </>
      ) : schedules && !failure ? (
        <EmptyState message={t("adminScheduleEmpty")} />
      ) : null}

      {/* HR can always add one, not only when the card is empty: a tenant with a
          schedule in force still needs the way to add the next one (a seasonal
          schedule, a replacement). The button was inside the empty state, so it
          disappeared the moment a schedule existed - which is what made the card
          look like it had no way in. Renders nothing for a non-HR caller. */}
      {schedules && !failure ? (
        <div style={{ marginBlockStart: "var(--sp-3)" }}>{addButton}</div>
      ) : null}

      {dialogOpen ? (
        <ScheduleFormDialog
          t={t}
          locale={locale}
          onClose={() => setDialogOpen(false)}
          onSaved={() => {
            setDialogOpen(false);
            setSavedNotice(true);
            // Re-read rather than trusting what we think changed.
            setAttempt((count) => count + 1);
          }}
        />
      ) : null}
    </section>
  );
}

/** One weekday of the schedule in force - clock times keep Latin digits (dir=ltr). */
function ScheduleDayRow({ day, t, locale }: { day: ServerWorkSchedule["days"][number]; t: (key: DictKey) => string; locale: Locale }) {
  const from = clockText(day.start_time);
  const to = clockText(day.end_time);
  return (
    <li className="compact-row">
      <div>
        <strong>{formatWeekdayIndex(day.weekday, locale)}</strong>
        {day.is_working_day ? (
          <div className="page-meta">
            <bdi dir="ltr">{from ?? "—"}</bdi> – <bdi dir="ltr">{to ?? "—"}</bdi>
            {day.break_minutes > 0 ? ` · ${t("adminScheduleBreakCount").replace("%s", numText(day.break_minutes, locale))}` : ""}
          </div>
        ) : (
          <div className="page-meta">{t("adminScheduleRestDay")}</div>
        )}
      </div>
    </li>
  );
}

/* ============================ §1.1 the week form ============================ */

/** The per-day refusal, printed next to its row with the field named in words. */
const DAY_FIELD_LABEL: Record<string, DictKey> = {
  start_time: "adminScheduleDayFrom",
  end_time: "adminScheduleDayTo",
  break_minutes: "adminScheduleBreakLabel",
};

function dayIssueText(entry: Record<string, string[]>, t: (key: DictKey) => string): string {
  return Object.entries(entry)
    .map(([field, messages]) => `${DAY_FIELD_LABEL[field] ? t(DAY_FIELD_LABEL[field]) : field}: ${messages.join(" · ")}`)
    .join(" · ");
}

/**
 * The form's own side of the contract (the server re-checks everything): the
 * required trio, the range order, at least one working day, and for every
 * working day a from < to pair. Returns the WorkScheduleIssues shape so the
 * client refusals and the server's `fields` render through one path.
 */
function validateScheduleDraft(draft: WorkScheduleDraft, t: (key: DictKey) => string): WorkScheduleIssues | null {
  const scalar: Record<string, string[]> = {};
  const day: Record<number, Record<string, string[]>> = {};
  const daysGeneral: string[] = [];
  let workingDays = 0;
  if (!draft.name.trim()) scalar.name = [t("adminErrorRequired")];
  if (!draft.effectiveFrom) scalar.effective_from = [t("adminErrorRequired")];
  if (draft.effectiveFrom && draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom) {
    scalar.effective_to = [t("adminErrorDates")];
  }
  draft.days.forEach((row, weekday) => {
    if (!row.working) return;
    workingDays += 1;
    const perDay: Record<string, string[]> = {};
    if (!row.from || !row.to) {
      if (!row.from) perDay.start_time = [t("adminErrorRequired")];
      if (!row.to) perDay.end_time = [t("adminErrorRequired")];
    } else if (row.to <= row.from) {
      perDay.end_time = [t("adminErrorTimeRange")];
    }
    if (Object.keys(perDay).length) day[weekday] = perDay;
  });
  if (workingDays === 0) daysGeneral.push(t("adminErrorWeekdays"));
  const empty = Object.keys(scalar).length === 0 && Object.keys(day).length === 0 && daysGeneral.length === 0;
  return empty ? null : { scalar, day, daysGeneral };
}

/**
 * Why a save did NOT land, said without pretending. The form never reprints the
 * server's own per-field messages here - those travel as WorkScheduleIssues and
 * render next to their fields; this is only the non-field remainder.
 */
function describeSaveFailure(failure: unknown, t: (key: DictKey) => string): string {
  if (failure instanceof ApiError) {
    if (failure.kind === "unauthenticated" || failure.kind === "forbidden") return t("adminScheduleActionDenied");
    if (failure.kind === "unreachable") return t("adminScheduleFailureUnreachable");
    if (failure.message) return `${t("adminScheduleSaveFailed")} ${failure.message}`;
  }
  return t("adminScheduleSaveFailed");
}

function ScheduleFormDialog({
  t,
  locale,
  onClose,
  onSaved,
}: {
  t: (key: DictKey) => string;
  locale: Locale;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<WorkScheduleDraft>(emptyScheduleDraft);
  const [issues, setIssues] = useState<WorkScheduleIssues | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const patch = (changes: Partial<WorkScheduleDraft>) => {
    setDirty(true);
    setDraft((current) => ({ ...current, ...changes }));
  };
  const patchDay = (weekday: number, changes: Partial<ScheduleDayDraft>) => {
    setDirty(true);
    setDraft((current) => ({
      ...current,
      days: current.days.map((row, index) => (index === weekday ? { ...row, ...changes } : row)),
    }));
  };

  const submit = async () => {
    setProblem(null);
    const local = validateScheduleDraft(draft, t);
    if (local) {
      setIssues(local);
      return;
    }
    setIssues(null);
    setSaving(true);
    try {
      await createWorkSchedule(payloadFromDraft(draft), locale);
      onSaved();
    } catch (failure) {
      const mapped = scheduleFieldIssues(failure);
      if (mapped) setIssues(mapped);
      else setProblem(describeSaveFailure(failure, t));
    } finally {
      setSaving(false);
    }
  };

  const dayName = (weekday: number) => formatWeekdayIndex(weekday, locale);

  return (
    <Dialog
      title={t("adminScheduleAdd")}
      description={t("adminScheduleDialogHint")}
      busy={saving}
      dirty={dirty}
      onClose={onClose}
    >
      <form noValidate onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label className="field" htmlFor="schedule-form-name" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">
            {t("adminScheduleNameLabel")} <span className="field-required">*</span>
          </span>
          <input
            id="schedule-form-name"
            className="input"
            autoFocus
            value={draft.name}
            aria-invalid={issues?.scalar.name ? "true" : undefined}
            onChange={(event) => patch({ name: event.target.value })}
          />
          {issues?.scalar.name ? <span className="field-error" role="alert">{issues.scalar.name.join(" · ")}</span> : null}
        </label>

        <div className="schedule-period">
          <label className="field" htmlFor="schedule-form-effective-from">
            <span className="field-label">
              {t("adminEffectiveFrom")} <span className="field-required">*</span>
            </span>
            <input
              id="schedule-form-effective-from"
              className="input"
              dir="ltr"
              type="date"
              value={draft.effectiveFrom}
              aria-invalid={issues?.scalar.effective_from ? "true" : undefined}
              onChange={(event) => patch({ effectiveFrom: event.target.value })}
            />
            {issues?.scalar.effective_from ? (
              <span className="field-error" role="alert">{issues.scalar.effective_from.join(" · ")}</span>
            ) : null}
          </label>
          <label className="field" htmlFor="schedule-form-effective-to">
            <span className="field-label">{t("adminEffectiveTo")}</span>
            {/* The optional end cannot precede the start - linked both ways. */}
            <input
              id="schedule-form-effective-to"
              className="input"
              dir="ltr"
              type="date"
              min={draft.effectiveFrom || undefined}
              value={draft.effectiveTo}
              aria-invalid={issues?.scalar.effective_to ? "true" : undefined}
              onChange={(event) => patch({ effectiveTo: event.target.value })}
            />
            {issues?.scalar.effective_to ? (
              <span className="field-error" role="alert">{issues.scalar.effective_to.join(" · ")}</span>
            ) : null}
          </label>
        </div>

        <label className="field" htmlFor="schedule-form-active" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminScheduleActiveCheckbox")}</span>
          <input
            id="schedule-form-active"
            type="checkbox"
            checked={draft.isActive}
            onChange={(event) => patch({ isActive: event.target.checked })}
          />
          <span className="field-hint">{t("adminScheduleActiveCheckboxHint")}</span>
        </label>

        <fieldset className="quiet-inset schedule-days" disabled={saving}>
          <legend className="visually-hidden">{t("adminScheduleDaysHeading")}</legend>
          {/* The header row is layout only; every real input owns its own labelled name. */}
          <div className="schedule-day-row" aria-hidden="true">
            <span className="page-meta">{t("adminScheduleDaysHeading")}</span>
            <span className="page-meta">{t("adminScheduleDayWorking")}</span>
            <span className="page-meta">{t("adminScheduleDayFrom")}</span>
            <span className="page-meta">{t("adminScheduleDayTo")}</span>
            <span className="page-meta">{t("adminScheduleBreakLabel")}</span>
          </div>
          {issues?.daysGeneral.map((line) => (
            <span className="field-error schedule-days-general" role="alert" key={line}>{line}</span>
          ))}
          {draft.days.map((row, weekday) => (
            <div className="schedule-day-row" key={weekday}>
              <span className="schedule-day-name">{dayName(weekday)}</span>
              <label className="admin-weekday">
                {/* ds-allow-native-checkbox: single boolean toggle; segmented work is out of scope */}
                <input
                  type="checkbox"
                  checked={row.working}
                  aria-label={`${dayName(weekday)} - ${t("adminScheduleDayWorking")}`}
                  onChange={(event) => patchDay(weekday, { working: event.target.checked })}
                />
              </label>
              <input
                className="input"
                dir="ltr"
                type="time"
                value={row.from}
                disabled={!row.working}
                aria-label={`${dayName(weekday)} - ${t("adminScheduleDayFrom")}`}
                aria-invalid={issues?.day[weekday]?.start_time ? "true" : undefined}
                onChange={(event) => patchDay(weekday, { from: event.target.value })}
              />
              <input
                className="input"
                dir="ltr"
                type="time"
                min={row.from || undefined}
                value={row.to}
                disabled={!row.working}
                aria-label={`${dayName(weekday)} - ${t("adminScheduleDayTo")}`}
                aria-invalid={issues?.day[weekday]?.end_time ? "true" : undefined}
                onChange={(event) => patchDay(weekday, { to: event.target.value })}
              />
              <input
                className="input"
                dir="ltr"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={row.breakMinutes}
                disabled={!row.working}
                aria-label={`${dayName(weekday)} - ${t("adminScheduleBreakLabel")}`}
                aria-invalid={issues?.day[weekday]?.break_minutes ? "true" : undefined}
                onChange={(event) => patchDay(weekday, { breakMinutes: event.target.value })}
              />
              {issues?.day[weekday] ? (
                <span className="field-error" role="alert">{dayIssueText(issues.day[weekday], t)}</span>
              ) : null}
            </div>
          ))}
        </fieldset>

        {problem ? <Banner tone="error" role="alert" >{problem}</Banner> : null}

        <div className="dialog-actions">
          <button className="btn btn-secondary" type="button" disabled={saving} onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="btn btn-primary" type="submit" disabled={saving} aria-busy={saving}>
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/* ==================== §1.2 Leave entitlement table (honest) ==================== */

function LeaveSection({ t, locale }: { t: (key: DictKey) => string; locale: Locale }) {
  const unavailable = locale === "ar"
    ? "جدول مخصص الإجازات غير متاح: لا توجد نقطة نهاية لأرصدة الإجازات على الخادم (قراءة أو تسوية)، فلا توجد صفوف مؤكدة لأي موظف ولا إجراء ضبط. الجدول يُستكمل عند توفر النقطة."
    : "The leave entitlement table is not available: no leave-balances endpoint exists on the server (read or adjust), so there are no confirmed rows for any employee and no adjust action. The table completes when the endpoint does.";
  return (
    <section className="section" aria-labelledby="settings-leave-heading" id="settings-leave">
      <div className="section-heading">
        <h2 id="settings-leave-heading">{t("adminSettingsLeaveTitle")}</h2>
        <span className="page-meta">{t("adminAllEmployees")}</span>
      </div>
      <Banner tone="warning" role="alert">{unavailable}</Banner>
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
  const year = Number(today.slice(0, 4)) || new Date().getFullYear();
  /**
   * The register, from the server only. No fixture fallback, no silent mixing:
   * a failed read is reported by its real reason and the list stays empty.
   */
  const [holidays, setHolidays] = useState<PublicHoliday[] | null>(null);
  const [loadFailure, setLoadFailure] = useState<{ reason: ApiFailureKind; message: string } | null>(null);
  const [ai, setAi] = useState<AiControlState>({ kind: "idle" });

  /** Read the register from the server. Never falls back to faking a successful load. */
  useEffect(() => {
    let cancelled = false;
    fetchHolidays(year)
      .then((rows) => {
        if (cancelled) return;
        setHolidays(rows);
        setLoadFailure(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setHolidays([]);
        setLoadFailure(describeApiFailure(error));
      });
    return () => { cancelled = true; };
  }, [year]);

  const runRefresh = async () => {
    setAi({ kind: "loading" });
    try {
      const summary = await refreshHolidays(year);
      // Re-read rather than trusting what we think changed.
      const rows = await fetchHolidays(year);
      setHolidays(rows);
      setLoadFailure(null);
      setAi({ kind: "done", summary });
    } catch (error) {
      setAi({ kind: "failed", ...describeApiFailure(error) });
    }
  };

  const sorted = useMemo(() => [...(holidays ?? [])].sort((l, r) => l.date.localeCompare(r.date)), [holidays]);
  const pastCount = sorted.filter((holiday) => holiday.date < today).length;
  const upcoming = sorted.filter((holiday) => holiday.date >= today);
  const past = sorted.filter((holiday) => holiday.date < today);

  return (
    <section className="work-surface section" aria-labelledby="settings-holidays-heading" id="settings-holidays">
      <div className="section-heading">
        <h2 id="settings-holidays-heading">{t("hrHolidaysTitle")}</h2>
        <div className="row-actions">
          {/* §1.4 - the control is real. It reports what the server actually did. */}
          <button
            type="button"
            className="btn btn-secondary has-tooltip"
            data-tooltip={t("adminSettingsAiNote")}
            aria-describedby="settings-holidays-ai-note"
            onClick={runRefresh}
            disabled={ai.kind === "loading"}
            aria-busy={ai.kind === "loading"}
          >
            <InfoIcon />
            {ai.kind === "loading" ? t("adminSettingsAiWorking") : t("adminSettingsAiLabel")}
          </button>
        </div>
      </div>
      {/* The tooltip above carries these words on wide screens; keeping them in the
          tree gives the control an aria-describedby target either way. */}
      <span className="holiday-soon-note" id="settings-holidays-ai-note">
        {t("adminSettingsAiNote")}
      </span>

      {/* A failed read is stated by its real reason - nothing was rendered instead. */}
      {loadFailure ? (
        <p className="page-meta" style={{ marginBlockStart: "var(--sp-2)" }}>
          {describeLoadFailure(loadFailure, t)}
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

      {holidays === null ? (
        <EmptyState message={t("adminSettingsHolidaysEmpty")} />
      ) : (
        <>
          {upcoming.length > 0 ? (
            <ul className="compact-list" style={{ marginBlockStart: "var(--sp-2)" }}>
              {upcoming.map((holiday) => (
                <HolidayRow key={holiday.id} holiday={holiday} t={t} locale={locale} />
              ))}
            </ul>
          ) : (
            <p className="page-meta" style={{ marginBlockStart: "var(--sp-2)" }}>
              {t("adminSettingsHolidaysNoneUpcoming")}
            </p>
          )}
          {pastCount > 0 ? (
            <details style={{ marginBlockStart: "var(--sp-3)" }}>
              <summary className="page-meta" style={{ cursor: "pointer", paddingBlock: "var(--sp-2)" }}>
                {t("adminSettingsPastToggle").replace("%s", numText(pastCount, locale))}
              </summary>
              <ul className="compact-list">
                {past.map((holiday) => (
                  <HolidayRow key={holiday.id} holiday={holiday} t={t} locale={locale} />
                ))}
              </ul>
            </details>
          ) : null}
          <p className="page-meta" style={{ marginBlockStart: "var(--sp-3)" }}>{t("adminSettingsHolidaysTotal").replace("%s", numText(holidays.length, locale))}</p>
        </>
      )}
    </section>
  );
}

/** Map a thrown value to the honest reason the control will report. */
function describeApiFailure(error: unknown): { reason: ApiFailureKind; message: string } {
  if (error instanceof ApiError) return { reason: error.kind, message: error.message };
  return { reason: "unreachable", message: error instanceof Error ? error.message : String(error) };
}

/** Why the schedule list could not be read - keyed on the real failure kind. */
function describeScheduleFailure(failure: { reason: ApiFailureKind; message: string }, t: (key: DictKey) => string): string {
  if (failure.reason === "unauthenticated") return t("adminScheduleFailureAuth");
  if (failure.reason === "forbidden") return t("adminScheduleFailureForbidden");
  if (failure.reason === "unreachable") return t("adminScheduleFailureUnreachable");
  if (failure.reason === "invalid" && failure.message) return `${t("adminScheduleFailureServer")} ${failure.message}`;
  return t("adminScheduleFailureServer");
}

/** Why the register on screen is empty, said without pretending. */
function describeLoadFailure(failure: { reason: ApiFailureKind }, t: (key: DictKey) => string): string {
  if (failure.reason === "unauthenticated") return t("adminSettingsAiNotSignedIn");
  if (failure.reason === "forbidden") return t("adminSettingsAiNotAllowed");
  return t("adminSettingsAiServerUnreachable");
}

/** The refresh outcome, from the server's own summary - counts, not adjectives. */
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
    : `${line} - ${t("adminSettingsAiLlmUnavailable")}`;
}

/** A failed refresh names the reason. It never reads as a success. */
function describeRefreshFailure(state: { reason: ApiFailureKind }, t: (key: DictKey) => string): string {
  if (state.reason === "unauthenticated") return t("adminSettingsAiFailedAuth");
  if (state.reason === "forbidden") return t("adminSettingsAiFailedForbidden");
  if (state.reason === "unreachable") return t("adminSettingsAiFailedUnreachable");
  return t("adminSettingsAiFailedServer");
}

/** Server register row - read-only now: no endpoint backs manual edits. */
function HolidayRow({ holiday, t, locale }: { holiday: PublicHoliday; t: (key: DictKey) => string; locale: Locale }) {
  // Provenance. A proposal is NOT an official holiday, so it gets its own tone
  // and its own label - never the default one.
  const badge = holiday.needsConfirmation
    ? { tone: "warning" as StatusTone, label: t("adminSettingsAiProposed") }
    : holiday.isManualOverride
      ? { tone: "info" as StatusTone, label: t("adminSettingsAiManual") }
      : null;

  return (
    <li className="compact-row">
      <div>
        <strong>{fullDate(holiday.date, locale)}</strong>
        <div className="page-meta">{weekDayOf(holiday.date, locale)} · {holiday.name[locale]}{holiday.recurring ? ` · ${t("adminSettingsRecurring")}` : ""}</div>
        {badge ? (
          <div style={{ marginBlockStart: "var(--sp-1)" }}>
            <StatusPill tone={badge.tone} label={badge.label} />
          </div>
        ) : null}
      </div>
    </li>
  );
}
