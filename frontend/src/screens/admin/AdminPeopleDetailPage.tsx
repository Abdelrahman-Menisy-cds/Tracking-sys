import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { Banner, StatusPill } from "../../components/ui";
import PageHeader from "../../components/layout/PageHeader";
import AttentionStrip from "../../components/state/AttentionStrip";
import AdjustLeaveDialog, { leaveTypeKeys, type AdjustLeaveOutcome } from "./AdjustLeaveDialog";
import ScheduleEditorDialog from "./ScheduleEditorDialog";
import AdminNav from "./AdminNav";
import type { LeaveBalance, WorkSchedule } from "../../mock/attendance";
import {
  employeeDirectory,
  findDirectoryEntry,
  type EmployeeDirectoryEntry,
  type EmployeeHrOnlyFile,
} from "../../mock/data";
import type { Dict, Locale } from "../../i18n/dict";

type DictKey = keyof Dict;

/**
 * Employee employment settings — spec §2.2/§2.3/§2.4, a routed sub-view at
 * /admin/people/:employeeId. One draft ("all unsaved changes"), one sticky
 * save bar; the HR-only file tier is gated by the data layer's
 * visibleEmployeeFile, never re-implemented here (§2.3).
 */

const cairoDateLocal = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).reduce<Record<string, string>>((result, part) => { result[part.type] = part.value; return result; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const weekdayLabel = (weekday: number, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, { weekday: "long" }).format(new Date(Date.UTC(2023, 0, 1 + weekday)));

const fmt = (value: number, locale: Locale): string => new Intl.NumberFormat(locale).format(value);
const mediumDate = (value: string, locale: Locale): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${value}T12:00:00Z`))
    : value;
const fmtDateTime = (value: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const employmentTypeKeys = {
  FULL: "hrEmploymentTypeFull",
  PART: "hrEmploymentTypePart",
  HYBRID: "hrEmploymentTypeHybrid",
  REMOTE: "hrEmploymentTypeRemote",
} as const;

const employmentHintKeys = {
  FULL: "adminPeopleEmploymentHintFull",
  PART: "adminPeopleEmploymentHintPart",
  HYBRID: "adminPeopleEmploymentHintHybrid",
  REMOTE: "adminPeopleEmploymentHintRemote",
} as const;

type EmploymentTypeCode = keyof typeof employmentTypeKeys;

const scheduleText = (schedule: WorkSchedule, locale: Locale): string =>
  `${schedule.working_weekdays.map((weekday) => weekdayLabel(weekday, locale)).join(locale === "ar" ? "، " : ", ")}`
  + ` · ${schedule.expected_start}–${schedule.expected_end} · ${fmt(schedule.expected_daily_minutes, locale)} ${locale === "ar" ? "دقيقة/يوم" : "min/day"}`;

export default function AdminPeopleDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const { t, locale, role, capabilities, schedules, resolveScheduleFor, setWorkSchedule, visibleEmployeeFile, leaveBalances, directoryLeaveBalances, leaveBalanceSummary } = useApp();
  usePageTitle(t("adminPeopleTitle"));

  const base = employeeId ? employeeDirectory.find((candidate) => candidate.id === employeeId) : undefined;
  const entry = useMemo(
    () => (base ? visibleEmployeeFile(base, { id: "hr1", role }) : null),
    [base, role, visibleEmployeeFile],
  );

  const orgSchedule = useMemo(() => schedules.find((schedule) => schedule.scope === "ORGANIZATION") ?? null, [schedules]);
  const today = cairoDateLocal(new Date());
  const inForceOwn = useMemo(
    () =>
      schedules.find(
        (schedule) =>
          schedule.scope === "EMPLOYEE" && schedule.target === employeeId
          && schedule.effective_from <= today && (!schedule.effective_to || today <= schedule.effective_to),
      ) ?? null,
    [schedules, employeeId, today],
  );
  const effective = employeeId ? resolveScheduleFor(employeeId, today) : null;
  const hasException = Boolean(inForceOwn) && effective !== null && orgSchedule !== null && effective.id !== orgSchedule.id;

  // ── Draft state (§2.2 item 6: one draft, one save bar). Selecting never saves. ──
  const [draftType, setDraftType] = useState<EmploymentTypeCode>(entry?.employment_type ?? "FULL");
  const [draftPolicyMode, setDraftPolicyMode] = useState<"FIXED_DAYS" | "FLEXIBLE_QUOTA">(
    entry?.hybrid_policy?.mode === "FLEXIBLE_QUOTA" ? "FLEXIBLE_QUOTA" : "FIXED_DAYS",
  );
  const [draftFixedDays, setDraftFixedDays] = useState<number[]>(
    entry?.hybrid_policy?.mode === "FIXED_DAYS" ? [...entry.hybrid_policy.office_weekdays] : [0, 2],
  );
  const [draftMinDays, setDraftMinDays] = useState<string>(
    entry?.hybrid_policy?.mode === "FLEXIBLE_QUOTA" ? String(entry.hybrid_policy.min_office_days) : "2",
  );
  const [draftPeriodDays, setDraftPeriodDays] = useState<string>(
    entry?.hybrid_policy?.mode === "FLEXIBLE_QUOTA" ? String(entry.hybrid_policy.period_days) : "7",
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  // The saved employment type for the session (the directory fixture has no
  // employment mutation; the demo boundary copy says so on save).
  const [savedType, setSavedType] = useState<EmploymentTypeCode>(entry?.employment_type ?? "FULL");

  useEffect(() => {
    // Reset the draft when navigating between employees.
    setDraftType(entry?.employment_type ?? "FULL");
    setSavedType(entry?.employment_type ?? "FULL");
    setDraftPolicyMode(entry?.hybrid_policy?.mode === "FLEXIBLE_QUOTA" ? "FLEXIBLE_QUOTA" : "FIXED_DAYS");
    setDraftFixedDays(entry?.hybrid_policy?.mode === "FIXED_DAYS" ? [...entry.hybrid_policy.office_weekdays] : [0, 2]);
    setDraftMinDays(entry?.hybrid_policy?.mode === "FLEXIBLE_QUOTA" ? String(entry.hybrid_policy.min_office_days) : "2");
    setDraftPeriodDays(entry?.hybrid_policy?.mode === "FLEXIBLE_QUOTA" ? String(entry.hybrid_policy.period_days) : "7");
    setDirty(false);
    setFeedback(null);
  }, [entry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!employeeId || !base || !entry) return <Navigate to="/admin/people" replace />;
  if (!capabilities.canManageDirectory) return <Navigate to="/" replace />;

  const discard = () => {
    setDraftType(savedType);
    setDirty(false);
    setFeedback(null);
  };

  const save = () => {
    setSaving(true);
    window.setTimeout(() => {
      setSavedType(draftType);
      setSaving(false);
      setDirty(false);
      setFeedback({ tone: "success", text: `${t("adminPeopleSaved")} ${t("adminDemoBoundary")}` });
    }, 200);
  };

  const managerName = entry.direct_manager ? findDirectoryEntry(entry.direct_manager)?.name[locale] ?? entry.direct_manager : null;

  return (
    <div className="page">
      <AdminNav />
      <PageHeader
        title={entry.name[locale]}
        subtitle={<span>{t("adminPeopleEmploymentSubtitle")} · <bdi dir="ltr">{entry.employee_number}</bdi> · {entry.department[locale]}</span>}
        breadcrumb={<Link to="/admin/people">{t("adminPeopleBack")}</Link>}
      />
      <Banner tone="info">{t("adminDemoBoundary")}</Banner>

      <div className="dashboard-grid">
        {/* ── Employment settings (§2.2) ── */}
        <section className="work-surface section" aria-labelledby="people-employment">
          <div className="section-heading">
            <h2 id="people-employment">{t("adminPeopleEmploymentSubtitle")}</h2>
          </div>

          {hasException && effective && orgSchedule ? (
            <AttentionStrip>
              <div>
                <strong>{t("adminPeopleExceptionPill")}</strong>
                <span>
                  {t("adminPeopleExceptionStrip")
                    .replace("%s", scheduleText(effective, locale))
                    .replace("%s", scheduleText(orgSchedule, locale))}
                </span>
              </div>
            </AttentionStrip>
          ) : null}

          <h3>{t("adminPeopleEmploymentTypeHeading")}</h3>
          <div className="role-segmented" role="radiogroup" aria-label={t("adminPeopleEmploymentTypeHeading")}>
            {(Object.keys(employmentTypeKeys) as EmploymentTypeCode[]).map((code) => (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={draftType === code}
                className={`role-segmented-option${draftType === code ? " is-selected" : ""}`}
                onClick={() => { setDraftType(code); setDirty(true); }}
                onKeyDown={(event) => {
                  const codes = Object.keys(employmentTypeKeys) as EmploymentTypeCode[];
                  const index = codes.indexOf(draftType);
                  const delta = event.key === "ArrowRight" ? (locale === "ar" ? -1 : 1) : event.key === "ArrowLeft" ? (locale === "ar" ? 1 : -1) : 0;
                  if (!delta) return;
                  event.preventDefault();
                  const next = codes[Math.min(codes.length - 1, Math.max(0, index + delta))];
                  setDraftType(next);
                  setDirty(true);
                }}
              >
                <span>{t(employmentTypeKeys[code])}</span>
                <span className="field-hint">{t(employmentHintKeys[code])}</span>
              </button>
            ))}
          </div>

          {draftType === "HYBRID" ? (
            <>
              <h3 style={{ marginBlockStart: "var(--sp-6)" }}>{t("adminPeopleHybridHeading")}</h3>
              <p className="page-meta">{t("adminPeopleSwitchWarning")}</p>
              <div className="dashboard-grid">
                {/* Fixed-days card — calendar-strip silhouette */}
                <div
                  className="quiet-inset"
                  style={draftPolicyMode === "FIXED_DAYS" ? { borderColor: "var(--accent-border)" } : undefined}
                >
                  <h4>{t("adminPeopleHybridFixedTitle")}</h4>
                  <fieldset className="field">
                    <div className="admin-weekday-row">
                      {[0, 1, 2, 3, 4, 5, 6].map((weekday) => (
                        <label className="admin-weekday" key={weekday}>
                          <input
                            type="checkbox"
                            checked={draftPolicyMode === "FIXED_DAYS" && draftFixedDays.includes(weekday)}
                            disabled={saving}
                            onChange={() => {
                              setDraftPolicyMode("FIXED_DAYS");
                              setDraftFixedDays((current) =>
                                current.includes(weekday)
                                  ? current.filter((day) => day !== weekday)
                                  : [...current, weekday].sort((l, r) => l - r));
                              setDirty(true);
                            }}
                          />
                          <span>{weekdayLabel(weekday, locale).slice(0, locale === "ar" ? 5 : 3)}</span>
                        </label>
                      ))}
                    </div>
                    <span className="field-hint">
                      {t("adminPeopleHybridFixedSentence").replace(
                        "%s",
                        draftFixedDays.map((weekday) => weekdayLabel(weekday, locale)).join(locale === "ar" ? "، " : ", ") || "—",
                      )}
                    </span>
                  </fieldset>
                  <button
                    type="button"
                    className={`btn ${draftPolicyMode === "FIXED_DAYS" ? "btn-primary" : "btn-secondary"}`}
                    disabled={saving}
                    onClick={() => { setDraftPolicyMode("FIXED_DAYS"); setDirty(true); }}
                  >
                    {draftPolicyMode === "FIXED_DAYS" ? t("adminPeopleExceptionInForce") : t("adminPeopleEditException")}
                  </button>
                </div>
                {/* Flexible-quota card — one bold number silhouette */}
                <div
                  className="quiet-inset"
                  style={draftPolicyMode === "FLEXIBLE_QUOTA" ? { borderColor: "var(--accent-border)" } : undefined}
                >
                  <h4>{t("adminPeopleHybridFlexTitle")}</h4>
                  <div className="row-actions">
                    <label className="field">
                      <span className="field-label">1–6</span>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={6}
                        dir="ltr"
                        inputMode="numeric"
                        style={{ fontSize: "var(--font-size-2xl)", width: "6ch" }}
                        value={draftMinDays}
                        disabled={saving}
                        onChange={(event) => { setDraftPolicyMode("FLEXIBLE_QUOTA"); setDraftMinDays(event.target.value); setDirty(true); }}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">{t("adminPeriod")}</span>
                      <select
                        className="select"
                        value={draftPeriodDays}
                        disabled={saving}
                        onChange={(event) => { setDraftPolicyMode("FLEXIBLE_QUOTA"); setDraftPeriodDays(event.target.value); setDirty(true); }}
                      >
                        <option value="7">{t("adminPeoplePeriodWeek")}</option>
                        <option value="14">{locale === "ar" ? "أسبوعان" : "Two weeks"}</option>
                        <option value="30">{t("adminPeoplePeriodMonth")}</option>
                      </select>
                    </label>
                  </div>
                  <p className="page-meta">
                    {t("adminPeopleHybridFlexSentence")
                      .replace("%s", fmt(Number(draftMinDays) || 0, locale))
                      .replace("%s", Number(draftPeriodDays) <= 7 ? t("adminPeoplePeriodWeek") : Number(draftPeriodDays) <= 14 ? (locale === "ar" ? "أسبوعين" : "two weeks") : t("adminPeoplePeriodMonth"))}
                  </p>
                  <button
                    type="button"
                    className={`btn ${draftPolicyMode === "FLEXIBLE_QUOTA" ? "btn-primary" : "btn-secondary"}`}
                    disabled={saving}
                    onClick={() => { setDraftPolicyMode("FLEXIBLE_QUOTA"); setDirty(true); }}
                  >
                    {draftPolicyMode === "FLEXIBLE_QUOTA" ? t("adminPeopleExceptionInForce") : t("adminPeopleEditException")}
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {/* 5 · Per-employee schedule exception (§2.2 item 5) */}
          <h3 style={{ marginBlockStart: "var(--sp-6)" }}>{t("adminPeopleExceptionPill")}</h3>
          {hasException && effective ? (
            <div className="quiet-inset">
              <dl className="decision-facts">
                <div>
                  <dt>{t("adminPeopleExceptionInForce")}</dt>
                  <dd>{scheduleText(effective, locale)}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="page-meta">{t("adminPeopleFollowsOrg")}</p>
          )}
          <div className="form-actions" style={{ marginBlockStart: "var(--sp-3)" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setExceptionOpen(true)}
            >
              {t("adminPeopleEditException")}
            </button>
          </div>
          {exceptionOpen && employeeId ? (
            <ScheduleEditorDialog
              today={today}
              t={t as (key: DictKey) => string}
              locale={locale}
              base={inForceOwn}
              onClose={() => setExceptionOpen(false)}
              onSaved={(ok) => {
                setExceptionOpen(false);
                setFeedback({
                  tone: ok ? "success" : "error",
                  text: ok ? t("adminSettingsScheduleSaved") : t("adminMutationDenied"),
                });
              }}
              saveSchedule={setWorkSchedule}
              scope="EMPLOYEE"
              target={employeeId}
              blastRadiusNote={t("adminPeopleBlastRadius").replace("%s", entry.name[locale])}
            />
          ) : null}
        </section>

        {/* ── §2.4 Leave allocation — inset-inline-end column on ≥1024 ── */}
        <section className="work-surface section" aria-labelledby="people-leave">
          <div className="section-heading">
            <h2 id="people-leave">{t("adminPeopleLeaveAllocationHeading")}</h2>
          </div>
          <LeaveAllocation
            employeeId={employeeId}
            employeeName={entry.name[locale]}
            leaveBalances={leaveBalances}
            directoryLeaveBalances={directoryLeaveBalances}
            leaveBalanceSummary={leaveBalanceSummary}
            t={t}
            locale={locale}
          />
        </section>
      </div>

      {feedback ? <Banner tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.text}</Banner> : null}

      {/* 6 · Single sticky save bar for the whole draft (§2.2 item 6) */}
      <div className="form-actions" style={{ position: "sticky", bottom: 0, zIndex: 2, background: "var(--surface)", borderTop: "var(--timeline-width) solid var(--border-subtle)", paddingBlock: "var(--sp-3)" }}>
        {dirty ? <span className="field-hint" role="status">{t("adminPeopleDirtyWarning")}</span> : null}
        <button type="button" className="btn btn-secondary" onClick={discard} disabled={!dirty || saving}>
          {t("adminPeopleDiscard")}
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || saving} aria-busy={saving}>
          {saving ? <><span className="spinner" aria-hidden="true" />{t("adminPeopleSavingEmployment")}</> : t("adminPeopleSaveEmployment")}
        </button>
        <span className="field-hint">
          {t("adminPeopleLastSaved").replace("%s", fmtDateTime(new Date().toISOString(), locale)).replace("%s", "Mona Sherif")}
        </span>
      </div>

      {/* ── §2.3 Two-tier file: shared first; two separate <form> elements ── */}
      <section className="work-surface section" aria-labelledby="people-file-shared">
        <div className="section-heading">
          <h2 id="people-file-shared">{t("adminPeopleFileSharedHeading")}</h2>
        </div>
        <SharedFileFacts entry={entry as EmployeeDirectoryEntry} manager={managerName} employmentType={savedType} />
      </section>

      <hr style={{ border: 0, borderTop: "var(--timeline-width) solid var(--border-subtle)", marginBlock: "var(--sp-6)" }} />

      {entry.hr_file ? (
        <section className="work-surface section" aria-labelledby="people-file-hr">
          <div className="section-heading">
            <h2 id="people-file-hr">
              <StatusPill tone="danger" label={t("adminPeopleFileHrOnlyPill")} /> {t("adminPeopleFileHrOnlyHeading")}
            </h2>
          </div>
          <p className="page-meta">{t("adminPeopleFileHrOnlySentence")}</p>
          <HrOnlyFileFacts hrFile={entry.hr_file} />
        </section>
      ) : null}
    </div>
  );
}

function SharedFileFacts({ entry, manager, employmentType }: { entry: EmployeeDirectoryEntry; manager: string | null; employmentType: EmploymentTypeCode }) {
  const { t, locale } = useApp();
  return (
    <form className="quiet-inset" onSubmit={(event) => event.preventDefault()}>
      <dl className="decision-facts">
        <div><dt>{t("adminPeopleFactName")}</dt><dd><bdi>{entry.name[locale]}</bdi></dd></div>
        <div><dt>{t("adminPeopleFactDepartment")}</dt><dd>{entry.department[locale]}</dd></div>
        <div><dt>{t("adminPeopleFactJobTitle")}</dt><dd>{entry.job_title[locale]}</dd></div>
        <div><dt>{t("adminPeopleFactManager")}</dt><dd>{manager ?? "—"}</dd></div>
        <div><dt>{t("adminPeopleFactEmail")}</dt><dd><a href={`mailto:${entry.email}`}><bdi dir="ltr">{entry.email}</bdi></a></dd></div>
        <div><dt>{t("adminPeopleFactPhone")}</dt><dd><bdi dir="ltr">{entry.phone}</bdi></dd></div>
        <div><dt>{t("adminPeopleFactJoinDate")}</dt><dd><bdi dir="ltr">{mediumDate(entry.join_date, locale)}</bdi></dd></div>
        <div><dt>{t("adminPeopleFactEmploymentType")}</dt><dd><StatusPill tone="neutral" label={t(employmentTypeKeys[employmentType])} /></dd></div>
      </dl>
    </form>
  );
}

function HrOnlyFileFacts({ hrFile }: { hrFile: EmployeeHrOnlyFile }) {
  const { t, locale } = useApp();
  return (
    <form className="quiet-inset" onSubmit={(event) => event.preventDefault()}>
      <dl className="decision-facts">
        <div>
          <dt>{t("adminPeopleFactSalary")}</dt>
          <dd>
            {fmt(hrFile.salary.amount, locale)} {hrFile.salary.currency} · <span className="page-meta">{hrFile.salary.payroll_cycle === "MONTHLY" ? (locale === "ar" ? "شهري" : "monthly") : hrFile.salary.payroll_cycle}</span>
          </dd>
        </div>
        <div><dt>{t("adminPeopleFactNationalId")}</dt><dd><bdi dir="ltr">{hrFile.national_id}</bdi></dd></div>
        <div><dt>{t("adminPeopleFactBank")}</dt><dd>{hrFile.bank_account.bank_name[locale]}</dd></div>
        <div><dt>{t("adminPeopleFactIban")}</dt><dd><bdi dir="ltr">{hrFile.bank_account.iban}</bdi></dd></div>
      </dl>
      <h3>{t("adminPeopleFactContracts")}</h3>
      <ul className="attachment-list">
        {hrFile.contracts.map((contract) => (
          <li className="attachment-row" key={contract.id}>
            <div>
              <strong>{contract.type[locale]}</strong>
              <div className="page-meta">
                <bdi dir="ltr">{mediumDate(contract.start_date, locale)}</bdi>
                {" → "}
                {contract.end_date ? <bdi dir="ltr">{mediumDate(contract.end_date, locale)}</bdi> : "—"}
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-compact">{t("adminPeopleDownload")}</button>
          </li>
        ))}
      </ul>
      <h3>{t("adminPeopleFactEvaluations")}</h3>
      {hrFile.evaluations.length ? (
        <ul className="compact-list">
          {hrFile.evaluations.map((evaluation) => (
            <li className="compact-row" key={evaluation.id}>
              <div>
                <strong>{evaluation.period}</strong> · {fmt(evaluation.rating, locale)}/5
                <div className="page-meta">{evaluation.note[locale]}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="page-meta">—</p>
      )}
    </form>
  );
}

/* ==================== §2.4 Leave allocation ==================== */

function LeaveAllocation({
  employeeId,
  employeeName,
  leaveBalances,
  directoryLeaveBalances,
  leaveBalanceSummary,
  t,
  locale,
}: {
  employeeId: string;
  employeeName: string;
  leaveBalances: LeaveBalance[];
  directoryLeaveBalances: LeaveBalance[];
  leaveBalanceSummary: (balance: LeaveBalance) => { entitlement_days: number; used_days: number; pending_days: number; remaining: number };
  t: (key: DictKey) => string;
  locale: Locale;
}) {
  const rows = useMemo(() => {
    const live = new Map(leaveBalances.filter((row) => row.employee === employeeId).map((row) => [row.leave_type, row]));
    const base = directoryLeaveBalances.filter((row) => row.employee === employeeId);
    return base.map((row) => live.get(row.leave_type) ?? row);
  }, [leaveBalances, directoryLeaveBalances, employeeId]);

  const [adjustTarget, setAdjustTarget] = useState<LeaveBalance | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const handleAdjustClose = (outcome: AdjustLeaveOutcome) => {
    setAdjustTarget(null);
    setResetKey((current) => current + 1);
    if (outcome.ok) setConfirmMessage(t("adminBalanceAdjusted"));
  };

  return (
    <>
      {confirmMessage ? <Banner tone="success" role="status">{confirmMessage}</Banner> : null}
      {rows.map((row) => {
        const summary = leaveBalanceSummary(row);
        return (
          <div className="quiet-inset" key={row.leave_type} style={{ marginBlockEnd: "var(--sp-3)" }}>
            <h3><StatusPill tone="info" label={t(leaveTypeKeys[row.leave_type])} /></h3>
            <dl className="decision-facts">
              <div><dt>{t("adminPeopleEntitlement")}</dt><dd>{fmt(summary.entitlement_days, locale)}</dd></div>
              <div><dt>{t("adminPeopleUsed")}</dt><dd>{fmt(summary.used_days, locale)}</dd></div>
              <div><dt>{t("adminPeoplePending")}</dt><dd>{fmt(summary.pending_days, locale)}</dd></div>
              <div><dt>{t("remainingBalance")}</dt><dd><strong>{fmt(summary.remaining, locale)}</strong></dd></div>
            </dl>
            <button
              type="button"
              className="btn btn-secondary"
              aria-label={t("adminPeopleAdjustLeaveAria").replace("%s", t(leaveTypeKeys[row.leave_type])).replace("%s", employeeName)}
              onClick={() => setAdjustTarget(row)}
            >
              {t("adminAdjustBalance")}
            </button>
          </div>
        );
      })}
      {adjustTarget && employeeId ? (
        <AdjustLeaveDialog
          key={`adjust-${resetKey}`}
          employeeId={employeeId}
          employeeName={employeeName}
          initialLeaveType={adjustTarget.leave_type}
          availableTypes={rows.map((row) => row.leave_type)}
          onClose={handleAdjustClose}
        />
      ) : null}
    </>
  );
}
