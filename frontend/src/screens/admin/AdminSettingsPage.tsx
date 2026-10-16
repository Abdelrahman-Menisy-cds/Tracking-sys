import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { formatWeekdayOf, formatDateLong, cairoDayIso } from "../../app/format";
import { ApiError, type ApiFailureKind } from "../../app/api";
import { fetchHolidays, isPartial, refreshHolidays, type RefreshSummary } from "../../app/holidaysApi";
import type { PublicHoliday } from "../../app/serverTypes";
import { Banner, EmptyState, StatusPill, type StatusTone } from "../../components/ui";
import PageHeader from "../../components/layout/PageHeader";
import AdminNav from "./AdminNav";
import { CompanyProfilePanel } from "./CompanyProfilePanel";
import { InfoIcon } from "../../components/icons";
import type { Dict, Locale } from "../../i18n/dict";

type DictKey = keyof Dict;

/**
 * Organization settings — spec §1, now server-backed where the server exists:
 *
 *   • §1.3 Public-holidays register: READ from `GET /holidays` and refreshed
 *     by the §1.4 control (`POST /holidays/refresh`). The manual add/edit/
 *     delete dialogs had no endpoint behind them — they were demo writes, and
 *     they are gone; the register is read-only + refresh, invoices proposals
 *     as proposals, and an empty register is an honest empty state.
 *   • §1.1 Work schedule + §1.2 leave entitlement: NO endpoints exist. They
 *     render the honest unavailable state instead of fixture rows.
 *   • Company identity stays on its real GET/PATCH /company widget.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateIsValid = (value: string): boolean => ISO_DATE.test(value) && Number.isFinite(new Date(`${value}T12:00:00Z`).getTime());

const numText = (value: number, locale: Locale): string => new Intl.NumberFormat(locale).format(value);

// Brief H3 — the ONE shared formatting path; no screen-local Intl date formatters.
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
        {/* H17 — the company identity: its own widget card, full width, server-backed
            (GET/PATCH /company). */}
        <div style={{ gridColumn: "1 / -1" }}>
          <CompanyProfilePanel t={t as (key: DictKey) => string} locale={locale} />
        </div>
      </div>
    </div>
  );
}

/* ============================ §1.1 Work schedule card ============================ */

function ScheduleCard({ t, locale }: { t: (key: DictKey) => string; locale: Locale }) {
  const unavailable = locale === "ar"
    ? "جدول العمل الرسمي للمؤسسة غير متاح: لا توجد نقطة نهاية للجداول على الخادم (قراءة أو كتابة)، فلا يوجد جدول مؤكد ولا إصدارات سابقة. تُستكمل البطاقة عند توفر النقطة."
    : "The organization's work schedule is not available: no schedules endpoint exists on the server (read or write), so there is no confirmed schedule and no version history. The card completes when the endpoint does.";
  return (
    <section className="work-surface section" aria-labelledby="settings-schedule-heading" id="settings-schedule">
      <div className="section-heading">
        <h2 id="settings-schedule-heading">{t("adminOrgScheduleTitle")}</h2>
        <span className="page-meta">{t("adminCurrentSchedule")}</span>
      </div>
      <Banner tone="warning" role="alert">{unavailable}</Banner>
    </section>
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
          {/* §1.4 — the control is real. It reports what the server actually did. */}
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

      {/* A failed read is stated by its real reason — nothing was rendered instead. */}
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

/** Why the register on screen is empty, said without pretending. */
function describeLoadFailure(failure: { reason: ApiFailureKind }, t: (key: DictKey) => string): string {
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

/** Server register row — read-only now: no endpoint backs manual edits. */
function HolidayRow({ holiday, t, locale }: { holiday: PublicHoliday; t: (key: DictKey) => string; locale: Locale }) {
  // Provenance. A proposal is NOT an official holiday, so it gets its own tone
  // and its own label — never the default one.
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
