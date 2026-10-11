import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../../app/AppContext";
import { formatWeekdayIndex, formatDateTime, cairoDayIso } from "../../app/useMockList";
import { Banner, StatusPill } from "../../components/ui";
import PageHeader from "../../components/layout/PageHeader";
import AttentionStrip from "../../components/state/AttentionStrip";
import AdjustLeaveDialog, { leaveTypeKeys, type AdjustLeaveOutcome } from "./AdjustLeaveDialog";
import ScheduleEditorDialog from "./ScheduleEditorDialog";
import AdminNav from "./AdminNav";
import type { LeaveBalance, WorkSchedule } from "../../mock/attendance";
import {
  type EmployeeDirectoryEntry,
  type EmployeeHrOnlyFile,
  type EmployeeFilePatch,
  type EmployeeContractMock,
  type ReligionCode,
} from "../../mock/data";
import type { Dict, Locale } from "../../i18n/dict";

type DictKey = keyof Dict;

/**
 * Employee employment settings — spec §2.2/§2.3/§2.4, a routed sub-view at
 * /admin/people/:employeeId. One draft ("all unsaved changes"), one sticky
 * save bar; the HR-only file tier is gated by the data layer's
 * visibleEmployeeFile, never re-implemented here (§2.3).
 */

const cairoDateLocal = (date: Date) => cairoDayIso(date);

const weekdayLabel = (weekday: number, locale: Locale): string => formatWeekdayIndex(weekday, locale);

const fmt = (value: number, locale: Locale): string => new Intl.NumberFormat(locale).format(value);
// Brief H3 — the ONE shared formatting path; no screen-local Intl date formatters.
const fmtDateTime = (value: string, locale: Locale): string => formatDateTime(value, locale);

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

// ── File-draft validation (§2.3 shared + HR-only fields) ──
// Same ids/render pattern as ScheduleEditorDialog: errors[key] feeds
// aria-invalid + aria-describedby + a field-error span with role=alert.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s-]{7,20}$/;
const NATIONAL_ID_RE = /^\d{14}$/;

/**
 * Every editable fact, keyed for validation and error-message ids.
 * Declared with a fixed key list so the type and value stay in sync.
 */
type FactFieldKey =
  | "nameAr" | "nameEn"
  | "departmentAr" | "departmentEn"
  | "jobTitleAr" | "jobTitleEn"
  | "directManager" | "email" | "phone" | "joinDate"
  | "salaryAmount" | "nationalId"
  | "bankNameAr" | "bankNameEn" | "iban"
  | "religion" | "religionOther";

const FACT_FIELD_IDS: Record<FactFieldKey, string> = {
  nameAr: "people-fact-name-ar",
  nameEn: "people-fact-name-en",
  departmentAr: "people-fact-department-ar",
  departmentEn: "people-fact-department-en",
  jobTitleAr: "people-fact-job-title-ar",
  jobTitleEn: "people-fact-job-title-en",
  directManager: "people-fact-direct-manager",
  email: "people-fact-email",
  phone: "people-fact-phone",
  joinDate: "people-fact-join-date",
  salaryAmount: "people-hr-salary",
  nationalId: "people-hr-national-id",
  bankNameAr: "people-hr-bank-name-ar",
  bankNameEn: "people-hr-bank-name-en",
  iban: "people-hr-iban",
  religion: "people-hr-religion",
  religionOther: "people-hr-religion-other",
};

type ErrorMap = Partial<Record<FactFieldKey, DictKey>>;

/**
 * One draft covering both panels (the page's contract: one draft, one save
 * bar; selecting never saves). Contracts are edited in place — adding or
 * removing them is out of scope for this pass.
 */
interface FileDraft {
  nameAr: string;
  nameEn: string;
  departmentAr: string;
  departmentEn: string;
  jobTitleAr: string;
  jobTitleEn: string;
  directManager: string;
  email: string;
  phone: string;
  joinDate: string;
  salaryAmount: string;
  nationalId: string;
  bankNameAr: string;
  bankNameEn: string;
  iban: string;
  religion: ReligionCode;
  religionOther: string;
  contracts: EmployeeContractMock[];
}

const seedFileDraft = (entry: EmployeeDirectoryEntry): FileDraft => {
  const hr = entry.hr_file;
  return {
    nameAr: entry.name.ar,
    nameEn: entry.name.en,
    departmentAr: entry.department.ar,
    departmentEn: entry.department.en,
    jobTitleAr: entry.job_title.ar,
    jobTitleEn: entry.job_title.en,
    directManager: entry.direct_manager ?? "",
    email: entry.email,
    phone: entry.phone,
    joinDate: entry.join_date,
    salaryAmount: hr ? String(hr.salary.amount) : "",
    nationalId: hr?.national_id ?? "",
    bankNameAr: hr?.bank_account.bank_name.ar ?? "",
    bankNameEn: hr?.bank_account.bank_name.en ?? "",
    iban: hr?.bank_account.iban ?? "",
    religion: hr?.religion ?? "MUSLIM",
    // «آخر» carries a free-text detail; seed it whenever the fixture has one
    // so switching to OTHER shows what was there rather than an empty box.
    religionOther: hr?.religion_other ?? "",
    contracts: hr ? hr.contracts.map((contract) => ({ ...contract })) : [],
  };
};

const validateFileDraft = (draft: FileDraft): ErrorMap => {
  const errors: ErrorMap = {};
  if (!draft.nameAr.trim()) errors.nameAr = "adminErrorRequired";
  if (!draft.nameEn.trim()) errors.nameEn = "adminErrorRequired";
  if (!draft.departmentAr.trim()) errors.departmentAr = "adminErrorRequired";
  if (!draft.departmentEn.trim()) errors.departmentEn = "adminErrorRequired";
  if (!draft.jobTitleAr.trim()) errors.jobTitleAr = "adminErrorRequired";
  if (!draft.jobTitleEn.trim()) errors.jobTitleEn = "adminErrorRequired";
  if (!EMAIL_RE.test(draft.email.trim())) errors.email = "adminErrorEmail";
  if (!PHONE_RE.test(draft.phone.trim())) errors.phone = "adminErrorPhone";
  if (!draft.joinDate) errors.joinDate = "adminErrorRequired";
  if (!draft.salaryAmount.trim() || !Number.isFinite(Number(draft.salaryAmount)) || Number(draft.salaryAmount) <= 0) errors.salaryAmount = "adminErrorSalary";
  if (!NATIONAL_ID_RE.test(draft.nationalId.trim())) errors.nationalId = "adminErrorNationalId";
  if (!draft.bankNameAr.trim()) errors.bankNameAr = "adminErrorRequired";
  if (!draft.bankNameEn.trim()) errors.bankNameEn = "adminErrorRequired";
  if (!draft.iban.trim()) errors.iban = "adminErrorIban";
  // «آخر» is only valid with a non-empty detail (§2.3 -- own-religion data).
  if (draft.religion === "OTHER" && !draft.religionOther.trim()) errors.religionOther = "adminErrorReligionDetail";
  return errors;
};

/**
 * The patch passed to saveEmployeeFile. Because the merge rule replaces the
 * WHOLE hr_file slice, this always builds a complete EmployeeHrOnlyFile from
 * the draft — a partial object would silently blank fields.
 */
const filePatchFromDraft = (draft: FileDraft): EmployeeFilePatch => ({
  name: { ar: draft.nameAr, en: draft.nameEn },
  department: { ar: draft.departmentAr, en: draft.departmentEn },
  job_title: { ar: draft.jobTitleAr, en: draft.jobTitleEn },
  direct_manager: draft.directManager || null,
  email: draft.email,
  phone: draft.phone,
  join_date: draft.joinDate,
  hr_file: {
    hr_only: true,
    salary: { amount: Number(draft.salaryAmount), currency: "EGP", payroll_cycle: "MONTHLY" },
    national_id: draft.nationalId,
    bank_account: { bank_name: { ar: draft.bankNameAr, en: draft.bankNameEn }, iban: draft.iban },
    contracts: draft.contracts,
    evaluations: [],
    religion: draft.religion,
    ...(draft.religion === "OTHER" && draft.religionOther ? { religion_other: draft.religionOther } : {}),
  },
});

export default function AdminPeopleDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const { t, locale, role, capabilities, schedules, resolveScheduleFor, setWorkSchedule, removeWorkSchedule, visibleEmployeeFile, leaveBalances, directoryLeaveBalances, leaveBalanceSummary, saveEmployeeFile, employeeDirectory } = useApp();
  usePageTitle(t("adminPeopleTitle"));

  // The directory read MUST be the context's: the context value is
  // employeeDirectoryWithOverrides (AppContext.tsx), so a fresh page load
  // re-applies the sessionStorage overlay. The raw fixture import this page
  // used to read is a module constant — it never carried the overlay, which
  // is why saved edits reverted to fixture values after every hard reload.
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
  /** Part-time starts at half the organization's day — see chooseType below. */
  const halfOrgMinutes = Math.round((orgSchedule?.expected_daily_minutes ?? 480) / 2);
  /** "09:00" + 240 → "13:00". The editor dialog does the same for typed times. */
  const endAfterMinutes = (start: string, minutes: number): string => {
    const [hours, mins] = start.split(":").map(Number);
    const total = hours * 60 + mins + minutes;
    return `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };

  // ── Draft state (§2.2 item 6: one draft, one save bar). Selecting never saves. ──
  const [draftType, setDraftType] = useState<EmploymentTypeCode>(entry?.employment_type ?? "FULL");
  const [draftPolicyMode, setDraftPolicyMode] = useState<"FIXED_DAYS" | "FLEXIBLE_QUOTA">(
    entry?.hybrid_policy?.mode === "FLEXIBLE_QUOTA" ? "FLEXIBLE_QUOTA" : "FIXED_DAYS",
  );
  const [draftFixedDays, setDraftFixedDays] = useState<number[]>(
    entry?.hybrid_policy?.mode === "FIXED_DAYS" && entry?.hybrid_policy ? [...entry.hybrid_policy.office_weekdays] : [0, 2],
  );
  const [draftMinDays, setDraftMinDays] = useState<string>(
    entry?.hybrid_policy?.mode === "FLEXIBLE_QUOTA" ? String(entry.hybrid_policy.min_office_days) : "2",
  );
  const [draftPeriodDays, setDraftPeriodDays] = useState<string>(
    entry?.hybrid_policy?.mode === "FLEXIBLE_QUOTA" ? String(entry.hybrid_policy.period_days) : "7",
  );
  const [draftMinutes, setDraftMinutes] = useState<string>(String(effective?.expected_daily_minutes ?? halfOrgMinutes));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  // The saved employment type for the session (the directory fixture has no
  // employment mutation; the demo boundary copy says so on save).
  const [savedType, setSavedType] = useState<EmploymentTypeCode>(entry?.employment_type ?? "FULL");
  /**
   * File-facts draft (shared + HR-only panels): seeded from the entry as it is
   * now — which already includes any saved overlay, because the directory read
   * of the context is employeeDirectoryWithOverrides. Save writes the whole
   * EmployeeFilePatch at once through saveEmployeeFile.
   */
  const [fileDraft, setFileDraft] = useState<FileDraft>(() => seedFileDraft(entry ?? employeeDirectory[0]));
  const [fileErrors, setFileErrors] = useState<ErrorMap>({});
  const [savingFile, setSavingFile] = useState(false);
  // The manager select offers the whole directory (current entry included);
  // names come from the overridden directory view, so a renamed manager
  // shows the new name here too.
  const managerOptions = useMemo(() => employeeDirectory.map((candidate) => ({ id: candidate.id, name: candidate.name })), []);

  useEffect(() => {
    // Reset BOTH drafts when navigating between employees.
    setDraftType(entry?.employment_type ?? "FULL");
    setSavedType(entry?.employment_type ?? "FULL");
    setDraftPolicyMode(entry?.hybrid_policy?.mode === "FLEXIBLE_QUOTA" ? "FLEXIBLE_QUOTA" : "FIXED_DAYS");
    setDraftFixedDays(entry?.hybrid_policy?.mode === "FIXED_DAYS" && entry?.hybrid_policy ? [...entry.hybrid_policy.office_weekdays] : [0, 2]);
    setDraftMinDays(entry?.hybrid_policy?.mode === "FLEXIBLE_QUOTA" ? String(entry.hybrid_policy.min_office_days) : "2");
    setDraftPeriodDays(entry?.hybrid_policy?.mode === "FLEXIBLE_QUOTA" ? String(entry.hybrid_policy.period_days) : "7");
    setDraftMinutes(String(resolveScheduleFor(entry?.id ?? "", today)?.expected_daily_minutes ?? halfOrgMinutes));
    setFileDraft(seedFileDraft(entry ?? employeeDirectory[0]));
    setFileErrors({});
    setDirty(false);
    setFeedback(null);
  }, [entry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!employeeId || !base || !entry) return <Navigate to="/admin/people" replace />;
  if (!capabilities.canManageDirectory) return <Navigate to="/" replace />;

  const discard = () => {
    setDraftType(savedType);
    setDraftMinutes(String(effective?.expected_daily_minutes ?? halfOrgMinutes));
    setFileDraft(seedFileDraft(entry));
    setFileErrors({});
    setDirty(false);
    setFeedback(null);
  };

  /** Every change goes through here so dirty stays in lockstep with the draft. */
  const patchDraft = (changes: Partial<FileDraft>) => {
    setFileDraft((current) => ({ ...current, ...changes }));
    setDirty(true);
  };
  const patchContract = (id: string, field: "type_ar" | "type_en" | "start_date" | "end_date", value: string) => {
    setFileDraft((current) => ({
      ...current,
      contracts: current.contracts.map((contract) =>
        contract.id !== id
          ? contract
          : {
              ...contract,
              ...(field === "type_ar" ? { type: { ...contract.type, ar: value } } : {}),
              ...(field === "type_en" ? { type: { ...contract.type, en: value } } : {}),
              ...(field === "start_date" ? { start_date: value } : {}),
              ...(field === "end_date" ? { end_date: value || null } : {}),
            },
      ),
    }));
    setDirty(true);
  };

  /**
   * Choosing a type only fills the draft (§2.2 item 6: selecting never saves).
   *
   * Part-time is the one choice with a number attached, so it seeds the field with
   * half the organization's day. That seeding happens only on a real change of type:
   * re-clicking PART after editing the minutes must not throw the edit away.
   */
  const chooseType = (code: EmploymentTypeCode) => {
    if (code === "PART" && draftType !== "PART") setDraftMinutes(String(halfOrgMinutes));
    setDraftType(code);
    setDirty(true);
  };

  const minutesValue = Number.parseInt(draftMinutes, 10);
  const minutesValid = Number.isFinite(minutesValue) && minutesValue > 0;

  const save = () => {
    setSaving(true);
    // The schedule is the one real mutation here (the directory fixture has no
    // employment-type write), so it rides the same Save as the rest of the draft.
    if (employeeId && orgSchedule) {
      const start = inForceOwn?.expected_start ?? orgSchedule.expected_start;
      if (draftType === "PART" && minutesValid) {
        setWorkSchedule({
          // Reuse the live exception's id when there is one: setWorkSchedule replaces
          // by id, and a second id would stack two schedules on the same person.
          id: inForceOwn?.id ?? `schedule-${employeeId}-part`,
          scope: "EMPLOYEE",
          target: employeeId,
          working_weekdays: [...(inForceOwn?.working_weekdays ?? orgSchedule.working_weekdays)],
          expected_start: start,
          expected_end: endAfterMinutes(start, minutesValue),
          expected_daily_minutes: minutesValue,
          grace_minutes: inForceOwn?.grace_minutes ?? orgSchedule.grace_minutes,
          effective_from: today,
        });
      } else if (draftType === "FULL" && hasException && inForceOwn) {
        // Full-time means the organization's schedule, so the exception goes away
        // rather than being rewritten with the same numbers under a new id.
        removeWorkSchedule(inForceOwn.id);
      }
    }
    window.setTimeout(() => {
      setSavedType(draftType);
      setSaving(false);
      setDirty(false);
      setFeedback({ tone: "success", text: `${t("adminPeopleSaved")} ${t("adminDemoBoundary")}` });
    }, 200);
  };

  /**
   * The file fields share the page's single sticky Save — validation runs
   * before anything is written; a refusal sets field-level errors and a
   * page-level Banner and keeps the draft dirty.
   */
  const saveFile = (): boolean => {
    const errors = validateFileDraft(fileDraft);
    setFileErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFeedback({ tone: "error", text: t("adminMutationInvalid") });
      return false;
    }
    setSavingFile(true);
    const outcome = saveEmployeeFile(employeeId, filePatchFromDraft(fileDraft));
    window.setTimeout(() => {
      setSavingFile(false);
      if (!outcome.ok) {
        // CAPABILITY_DENIED / MISSING_RECORD are surfaced honestly, not faked.
        setFeedback({ tone: "error", text: t("adminMutationDenied") });
      } else {
        setFeedback({ tone: "success", text: `${t("adminPeopleFileSaved")} ${t("adminDemoBoundary")}` });
      }
    }, 150);
    return outcome.ok;
  };

  const anySaving = saving || savingFile;

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
                onClick={() => chooseType(code)}
                onKeyDown={(event) => {
                  const codes = Object.keys(employmentTypeKeys) as EmploymentTypeCode[];
                  const index = codes.indexOf(draftType);
                  const delta = event.key === "ArrowRight" ? (locale === "ar" ? -1 : 1) : event.key === "ArrowLeft" ? (locale === "ar" ? 1 : -1) : 0;
                  if (!delta) return;
                  event.preventDefault();
                  const next = codes[Math.min(codes.length - 1, Math.max(0, index + delta))];
                  chooseType(next);
                }}
              >
                <span>{t(employmentTypeKeys[code])}</span>
                <span className="field-hint">{t(employmentHintKeys[code])}</span>
              </button>
            ))}
          </div>

          {/* Part-time is the one choice with a number attached, so it gets a field it
              can be edited in. It is seeded with half the organization's day (see
              chooseType) and left alone after that. */}
          {draftType === "PART" ? (
            <label className="field" style={{ marginBlockStart: "var(--sp-4)", maxInlineSize: "22rem" }}>
              <span className="field-label">{t("adminExpectedDailyMinutes")}</span>
              <input
                className="input"
                type="number"
                min="1"
                step="5"
                value={draftMinutes}
                onChange={(event) => { setDraftMinutes(event.target.value); setDirty(true); }}
                aria-describedby={minutesValid ? "people-part-minutes-hint" : "people-part-minutes-error"}
              />
              {!minutesValid ? (
                <span className="field-error" id="people-part-minutes-error" role="alert">{t("adminErrorMinutes")}</span>
              ) : null}
              <span className="field-hint" id="people-part-minutes-hint">{t("adminPeoplePartMinutesHint")}</span>
            </label>
          ) : null}

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
                            disabled={anySaving}
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
                      {t("adminPeopleHybridFixedSentence")
                        .replace("%s", draftFixedDays.map((weekday) => weekdayLabel(weekday, locale)).join(locale === "ar" ? "، " : ", ") || "—")}
                    </span>
                  </fieldset>
                  <button
                    type="button"
                    className={`btn ${draftPolicyMode === "FIXED_DAYS" ? "btn-primary" : "btn-secondary"}`}
                    disabled={anySaving}
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
                        disabled={anySaving}
                        onChange={(event) => { setDraftPolicyMode("FLEXIBLE_QUOTA"); setDraftMinDays(event.target.value); setDirty(true); }}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">{t("adminPeriod")}</span>
                      <select
                        className="select"
                        value={draftPeriodDays}
                        disabled={anySaving}
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
                    disabled={anySaving}
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

      {/* ── Brief C — the two per-employee task capability flags ── */}
      <TaskCapabilityCard employeeId={employeeId} />

      {feedback ? <Banner tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.text}</Banner> : null}

      {/* 6 · Single sticky save bar for the whole draft (§2.2 item 6). The file
          panels validate on the same Save — one draft, one save bar; selecting
          never saves. A refused save keeps the draft dirty. */}
      <div className="form-actions people-sticky-actions">
        {dirty ? <span className="field-hint" role="status">{t("adminPeopleDirtyWarning")}</span> : null}
        <button type="button" className="btn btn-secondary" onClick={discard} disabled={!dirty || anySaving}>
          {t("adminPeopleDiscard")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || anySaving}
          aria-busy={anySaving}
          onClick={() => {
            // One Save, both drafts — but nothing writes while the file draft
            // is invalid: an anonymous success would lie. saveFile keeps the
            // draft dirty and explains per-field; save() only runs on a pass.
            if (saveFile()) save();
          }}
        >
          {anySaving ? <><span className="spinner" aria-hidden="true" />{t("adminPeopleSavingEmployment")}</> : t("adminPeopleSaveEmployment")}
        </button>
        <span className="field-hint">
          {t("adminPeopleLastSaved").replace("%s", fmtDateTime(new Date().toISOString(), locale)).replace("%s", "Mona Sherif")}
        </span>
      </div>

      {/* ── §2.3 Two-tier file: everything editable for HR now. The panels
              render inside the page-level draft (one draft, one save bar); the
              <form> wrappers keep the panels' landmark/spec shape, not
              separate submission units. Employment type is NOT duplicated
              here — it stays on the segmented control above. ── */}
      <section className="work-surface section" aria-labelledby="people-file-shared">
        <div className="section-heading">
          <h2 id="people-file-shared">{t("adminPeopleFileSharedHeading")}</h2>
        </div>
        <SharedFileFacts
          draft={fileDraft}
          errors={fileErrors}
          disabled={anySaving}
          employmentType={savedType}
          directory={managerOptions}
          t={t as (key: DictKey) => string}
          locale={locale}
          patchDraft={patchDraft}
        />
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
          <HrOnlyFileFacts
            draft={fileDraft}
            errors={fileErrors}
            disabled={anySaving}
            hrFile={entry.hr_file}
            t={t as (key: DictKey) => string}
            locale={locale}
            patchDraft={patchDraft}
            patchContract={patchContract}
          />
        </section>
      ) : null}
    </div>
  );
}

function SharedFileFacts({
  draft,
  errors,
  disabled,
  employmentType,
  directory,
  t,
  locale,
  patchDraft,
}: {
  draft: FileDraft;
  errors: ErrorMap;
  disabled: boolean;
  employmentType: EmploymentTypeCode;
  directory: { id: string; name: { ar: string; en: string } }[];
  t: (key: DictKey) => string;
  locale: Locale;
  patchDraft: (changes: Partial<FileDraft>) => void;
}) {
  const fieldError = (key: FactFieldKey) =>
    errors[key] ? (
      <span className="field-error" id={`${FACT_FIELD_IDS[key]}-error`} role="alert">{t(errors[key]!)}</span>
    ) : null;
  const describedBy = (key: FactFieldKey) => (errors[key] ? `${FACT_FIELD_IDS[key]}-error` : undefined);
  const arabic = locale === "ar" ? "بالعربية" : "Arabic";
  const english = locale === "ar" ? "بالإنجليزية" : "English";

  return (
    <form className="quiet-inset" onSubmit={(event) => event.preventDefault()}>
      <div className="form-grid people-facts-grid">
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactName")} · <bdi>{arabic}</bdi></span>
          <input className="input" value={draft.nameAr} disabled={disabled} id={FACT_FIELD_IDS.nameAr}
            aria-invalid={errors.nameAr ? "true" : undefined}
            aria-describedby={describedBy("nameAr")}
            onChange={(event) => patchDraft({ nameAr: event.target.value })} />
          {fieldError("nameAr")}
        </label>
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactName")} · <bdi>{english}</bdi></span>
          <input className="input" dir="ltr" value={draft.nameEn} disabled={disabled} id={FACT_FIELD_IDS.nameEn}
            aria-invalid={errors.nameEn ? "true" : undefined}
            aria-describedby={describedBy("nameEn")}
            onChange={(event) => patchDraft({ nameEn: event.target.value })} />
          {fieldError("nameEn")}
        </label>
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactDepartment")} · <bdi>{arabic}</bdi></span>
          <input className="input" value={draft.departmentAr} disabled={disabled} id={FACT_FIELD_IDS.departmentAr}
            aria-invalid={errors.departmentAr ? "true" : undefined}
            aria-describedby={describedBy("departmentAr")}
            onChange={(event) => patchDraft({ departmentAr: event.target.value })} />
          {fieldError("departmentAr")}
        </label>
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactDepartment")} · <bdi>{english}</bdi></span>
          <input className="input" dir="ltr" value={draft.departmentEn} disabled={disabled} id={FACT_FIELD_IDS.departmentEn}
            aria-invalid={errors.departmentEn ? "true" : undefined}
            aria-describedby={describedBy("departmentEn")}
            onChange={(event) => patchDraft({ departmentEn: event.target.value })} />
          {fieldError("departmentEn")}
        </label>
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactJobTitle")} · <bdi>{arabic}</bdi></span>
          <input className="input" value={draft.jobTitleAr} disabled={disabled} id={FACT_FIELD_IDS.jobTitleAr}
            aria-invalid={errors.jobTitleAr ? "true" : undefined}
            aria-describedby={describedBy("jobTitleAr")}
            onChange={(event) => patchDraft({ jobTitleAr: event.target.value })} />
          {fieldError("jobTitleAr")}
        </label>
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactJobTitle")} · <bdi>{english}</bdi></span>
          <input className="input" dir="ltr" value={draft.jobTitleEn} disabled={disabled} id={FACT_FIELD_IDS.jobTitleEn}
            aria-invalid={errors.jobTitleEn ? "true" : undefined}
            aria-describedby={describedBy("jobTitleEn")}
            onChange={(event) => patchDraft({ jobTitleEn: event.target.value })} />
          {fieldError("jobTitleEn")}
        </label>
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactManager")}</span>
          <select
            className="select"
            id={FACT_FIELD_IDS.directManager}
            disabled={disabled}
            value={draft.directManager}
            onChange={(event) => { patchDraft({ directManager: event.target.value }); }}
          >
            <option value="">—</option>
            {directory.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name[locale]}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactEmail")}</span>
          <input className="input" dir="ltr" type="email" value={draft.email} disabled={disabled} id={FACT_FIELD_IDS.email}
            aria-invalid={errors.email ? "true" : undefined}
            aria-describedby={describedBy("email")}
            onChange={(event) => patchDraft({ email: event.target.value })} />
          {fieldError("email")}
        </label>
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactPhone")}</span>
          <input className="input" dir="ltr" type="tel" value={draft.phone} disabled={disabled} id={FACT_FIELD_IDS.phone}
            aria-invalid={errors.phone ? "true" : undefined}
            aria-describedby={describedBy("phone")}
            onChange={(event) => patchDraft({ phone: event.target.value })} />
          {fieldError("phone")}
        </label>
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactJoinDate")}</span>
          <input className="input" dir="ltr" type="date" value={draft.joinDate} disabled={disabled} id={FACT_FIELD_IDS.joinDate}
            aria-invalid={errors.joinDate ? "true" : undefined}
            aria-describedby={describedBy("joinDate")}
            onChange={(event) => patchDraft({ joinDate: event.target.value })} />
          {fieldError("joinDate")}
        </label>
        {/* Not editable here: employment type lives in the segmented control above. */}
        <div className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactEmploymentType")}</span>
          <StatusPill tone="neutral" label={t(employmentTypeKeys[employmentType])} />
        </div>
      </div>
    </form>
  );
}

function HrOnlyFileFacts({
  draft,
  errors,
  disabled,
  hrFile,
  t,
  locale,
  patchDraft,
  patchContract,
}: {
  draft: FileDraft;
  errors: ErrorMap;
  disabled: boolean;
  hrFile: EmployeeHrOnlyFile;
  t: (key: DictKey) => string;
  locale: Locale;
  patchDraft: (changes: Partial<FileDraft>) => void;
  patchContract: (id: string, field: "type_ar" | "type_en" | "start_date" | "end_date", value: string) => void;
}) {
  const fieldError = (key: FactFieldKey) =>
    errors[key] ? (
      <span className="field-error" id={`${FACT_FIELD_IDS[key]}-error`} role="alert">{t(errors[key]!)}</span>
    ) : null;
  const describedBy = (key: FactFieldKey) => (errors[key] ? `${FACT_FIELD_IDS[key]}-error` : undefined);
  const arabic = locale === "ar" ? "بالعربية" : "Arabic";
  const english = locale === "ar" ? "بالإنجليزية" : "English";

  return (
    <form className="quiet-inset" onSubmit={(event) => event.preventDefault()}>
      <div className="form-grid people-facts-grid">
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">
            {t("adminPeopleFactSalary")} — <bdi dir="ltr">{hrFile.salary.currency}</bdi> · {locale === "ar" ? "شهري" : "monthly"}
          </span>
          <input
            className="input" dir="ltr" type="number" min="0" step="50"
            value={draft.salaryAmount} disabled={disabled} id={FACT_FIELD_IDS.salaryAmount}
            aria-invalid={errors.salaryAmount ? "true" : undefined}
            aria-describedby={describedBy("salaryAmount")}
            onChange={(event) => patchDraft({ salaryAmount: event.target.value })}
          />
          {fieldError("salaryAmount")}
        </label>
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactNationalId")}</span>
          <input
            className="input" dir="ltr" inputMode="numeric" maxLength={14}
            value={draft.nationalId} disabled={disabled} id={FACT_FIELD_IDS.nationalId}
            aria-invalid={errors.nationalId ? "true" : undefined}
            aria-describedby={describedBy("nationalId")}
            onChange={(event) => patchDraft({ nationalId: event.target.value })}
          />
          {fieldError("nationalId")}
          <span className="field-hint">{locale === "ar" ? "14 رقمًا." : "14 digits."}</span>
        </label>
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactBank")} · <bdi>{arabic}</bdi></span>
          <input className="input" value={draft.bankNameAr} disabled={disabled} id={FACT_FIELD_IDS.bankNameAr}
            aria-invalid={errors.bankNameAr ? "true" : undefined}
            aria-describedby={describedBy("bankNameAr")}
            onChange={(event) => patchDraft({ bankNameAr: event.target.value })} />
          {fieldError("bankNameAr")}
        </label>
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactBank")} · <bdi>{english}</bdi></span>
          <input className="input" dir="ltr" value={draft.bankNameEn} disabled={disabled} id={FACT_FIELD_IDS.bankNameEn}
            aria-invalid={errors.bankNameEn ? "true" : undefined}
            aria-describedby={describedBy("bankNameEn")}
            onChange={(event) => patchDraft({ bankNameEn: event.target.value })} />
          {fieldError("bankNameEn")}
        </label>
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)" }}>
          <span className="field-label">{t("adminPeopleFactIban")}</span>
          <input
            className="input" dir="ltr"
            value={draft.iban} disabled={disabled} id={FACT_FIELD_IDS.iban}
            aria-invalid={errors.iban ? "true" : undefined}
            aria-describedby={describedBy("iban")}
            onChange={(event) => patchDraft({ iban: event.target.value })}
          />
          {fieldError("iban")}
        </label>
      </div>

      {/* Own-religion data stays HR-only: a select of exactly the three codes;
          «آخر» reveals a free-text detail in place, and saving OTHER with an
          empty detail is refused (see validateFileDraft). */}
      <label className="field" style={{ marginBlockEnd: "var(--sp-4)", maxInlineSize: "22rem" }}>
        <span className="field-label">{t("adminPeopleReligion")}</span>
        <select
          className="select"
          id={FACT_FIELD_IDS.religion}
          disabled={disabled}
          value={draft.religion}
          onChange={(event) => {
            const next = event.target.value as ReligionCode;
            patchDraft({ religion: next });
          }}
        >
          <option value="MUSLIM">{t("religionMuslim")}</option>
          <option value="CHRISTIAN">{t("religionChristian")}</option>
          <option value="OTHER">{t("religionOther")}</option>
        </select>
      </label>
      {draft.religion === "OTHER" ? (
        <label className="field" style={{ marginBlockEnd: "var(--sp-4)", maxInlineSize: "22rem" }}>
          <span className="field-label">{t("adminPeopleReligionOtherDetail")}</span>
          <input
            className="input"
            id={FACT_FIELD_IDS.religionOther}
            disabled={disabled}
            value={draft.religionOther}
            aria-invalid={errors.religionOther ? "true" : undefined}
            aria-describedby={describedBy("religionOther")}
            onChange={(event) => patchDraft({ religionOther: event.target.value })}
          />
          {fieldError("religionOther")}
        </label>
      ) : null}

      <h3 style={{ marginBlockStart: "var(--sp-5)" }}>{t("adminPeopleFactContracts")}</h3>
      {/* Contracts are edited in place only: adding/removing them is out of
          scope for this pass (no add/remove affordance is built or faked). */}
      <ul className="attachment-list">
        {draft.contracts.map((contract) => (
          <li className="attachment-row" key={contract.id}>
            <div className="form-grid people-contract-grid">
              <label className="field" style={{ marginBlockEnd: "var(--sp-2)" }}>
                <span className="field-label"><bdi>{arabic}</bdi></span>
                <input className="input" value={contract.type.ar} disabled={disabled}
                  onChange={(event) => patchContract(contract.id, "type_ar", event.target.value)} />
              </label>
              <label className="field" style={{ marginBlockEnd: "var(--sp-2)" }}>
                <span className="field-label"><bdi>{english}</bdi></span>
                <input className="input" dir="ltr" value={contract.type.en} disabled={disabled}
                  onChange={(event) => patchContract(contract.id, "type_en", event.target.value)} />
              </label>
              <label className="field" style={{ marginBlockEnd: "var(--sp-2)" }}>
                <span className="field-label">{t("adminContractStart")}</span>
                <input className="input" dir="ltr" type="date" value={contract.start_date} disabled={disabled}
                  onChange={(event) => patchContract(contract.id, "start_date", event.target.value)} />
              </label>
              <label className="field" style={{ marginBlockEnd: "var(--sp-2)" }}>
                <span className="field-label">{t("adminContractEnd")}</span>
                <input className="input" dir="ltr" type="date" value={contract.end_date ?? ""} disabled={disabled}
                  onChange={(event) => patchContract(contract.id, "end_date", event.target.value)} />
              </label>
            </div>
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

/* ==================== Brief C — per-employee task capability flags ==================== */

function TaskCapabilityCard({ employeeId }: { employeeId: string }) {
  const { t, locale, taskCapabilityFor, setTaskCapabilities } = useApp();
  const saved = taskCapabilityFor(employeeId);
  const [draft, setDraft] = useState(saved);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // Re-seed the draft when the card is rendered for a different employee.
  const [trackedId, setTrackedId] = useState(employeeId);
  if (trackedId !== employeeId) {
    setTrackedId(employeeId);
    setDraft(taskCapabilityFor(employeeId));
    setDirty(false);
    setNote(null);
  }

  const save = () => {
    setSaving(true);
    window.setTimeout(() => {
      const result = setTaskCapabilities(employeeId, draft);
      if (result.ok) {
        setDirty(false);
        setNote({ tone: "success", text: t("adminPeopleSaved") });
      } else {
        setNote({ tone: "error", text: t("adminMutationDenied") });
      }
      setSaving(false);
    }, 150);
  };

  return (
    <section className="work-surface section" aria-labelledby="people-task-caps">
      <div className="section-heading">
        <h2 id="people-task-caps">{t("taskCapabilityHeading")}</h2>
      </div>
      <p className="page-meta">{t("taskCapabilityHintBody")}</p>
      <div className="dashboard-grid">
        {([
          ["can_create_tasks", t("taskCanCreateTasks")],
          ["can_assign_tasks", t("taskCanAssignTasks")],
        ] as const).map(([flag, label]) => (
          <div className="quiet-inset" key={flag}>
            <h3>{label}</h3>
            <div className="role-segmented" role="radiogroup" aria-label={label}>
              {([true, false] as const).map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  role="radio"
                  aria-checked={draft[flag] === value}
                  className={`role-segmented-option${draft[flag] === value ? " is-selected" : ""}`}
                  disabled={saving}
                  onClick={() => {
                    setDraft((current) => ({ ...current, [flag]: value }));
                    setDirty(true);
                  }}
                >
                  <span>{locale === "ar" ? (value ? "نعم" : "لا") : value ? "Yes" : "No"}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {note ? <Banner tone={note.tone} role={note.tone === "error" ? "alert" : "status"}>{note.text}</Banner> : null}
      <div className="form-actions" style={{ marginBlockStart: "var(--sp-3)" }}>
        <button type="button" className="btn btn-secondary" onClick={() => { setDraft(saved); setDirty(false); setNote(null); }} disabled={!dirty || saving}>
          {t("adminPeopleDiscard")}
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || saving} aria-busy={saving}>
          {saving ? <><span className="spinner" aria-hidden="true" />{t("saving")}</> : t("adminPeopleSaveEmployment")}
        </button>
      </div>
    </section>
  );
}
