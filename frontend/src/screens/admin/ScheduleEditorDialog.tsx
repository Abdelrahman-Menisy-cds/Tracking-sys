import { useMemo, useRef, useState, type FormEvent, type ChangeEvent } from "react";
import { Banner, Dialog } from "../../components/ui";
import type { Dict, Locale } from "../../i18n/dict";
import type { WorkSchedule } from "../../mock/attendance";

type DictKey = keyof Dict;

/**
 * Shared work-schedule editor dialog — spec §1.1 (org settings) + §2.2 item 5
 * (per-employee schedule exception). One component, two callers. Pure move of
 * the dialog from AdminSettingsPage with two additive props:
 *
 *  - `scope` / `target` : build the WorkSchedule payload with the caller's
 *    scope instead of hard-coded ORGANIZATION (EMPLOYEE needs `target`).
 *  - `blastRadiusNote`  : the page-meta line under the title ("Applies to K.
 *    Mostafa only; no other employee is affected"). Undefined for org settings,
 *    which keeps the /admin/settings behaviour byte-for-byte.
 */
export type ScheduleDraft = {
  working_weekdays: number[];
  expected_start: string;
  expected_end: string;
  expected_daily_minutes: string;
  grace_minutes: string;
  effective_from: string;
  effective_to: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const dateIsValid = (value: string): boolean =>
  ISO_DATE.test(value) && Number.isFinite(new Date(`${value}T12:00:00Z`).getTime());
const timeIsValid = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const nonNegativeInt = (value: string): boolean => Number.isInteger(Number(value)) && Number(value) >= 0;

/**
 * Minutes between the day's start and end, or null when the two do not form a
 * usable range. Null means "leave the field alone" — the user is probably
 * mid-edit and validateSchedule already reports the bad range on submit.
 *
 * Deliberately not wrapping past midnight: validateSchedule rejects end <=
 * start, so a night shift never reaches a saved schedule and inventing +24h
 * here would silently contradict the validator.
 */
export const minutesBetween = (start: string, end: string): number | null => {
  if (!timeIsValid(start) || !timeIsValid(end)) return null;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const span = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  return span > 0 ? span : null;
};

export const defaultDraft = (today: string): ScheduleDraft => ({
  working_weekdays: [0, 1, 2, 3, 4],
  expected_start: "09:00",
  expected_end: "17:00",
  expected_daily_minutes: "480",
  grace_minutes: "15",
  effective_from: today,
  effective_to: "",
});

export const toDraft = (schedule: WorkSchedule): ScheduleDraft => ({
  working_weekdays: [...schedule.working_weekdays].sort((l, r) => l - r),
  expected_start: schedule.expected_start,
  expected_end: schedule.expected_end,
  expected_daily_minutes: String(schedule.expected_daily_minutes),
  grace_minutes: String(schedule.grace_minutes),
  effective_from: schedule.effective_from,
  effective_to: schedule.effective_to ?? "",
});

export type ScheduleErrorKey = "weekdays" | "start" | "end" | "dailyMinutes" | "graceMinutes" | "effectiveFrom" | "effectiveTo";
export type ScheduleErrors = Partial<Record<ScheduleErrorKey | Exclude<keyof ScheduleDraft, "working_weekdays">, DictKey>>;

export function validateSchedule(draft: ScheduleDraft): ScheduleErrors {
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

export const scheduleErrorDraftKeys: Record<Exclude<ScheduleErrorKey, "weekdays">, Exclude<keyof ScheduleDraft, "working_weekdays">> = {
  start: "expected_start",
  end: "expected_end",
  dailyMinutes: "expected_daily_minutes",
  graceMinutes: "grace_minutes",
  effectiveFrom: "effective_from",
  effectiveTo: "effective_to",
};

export default function ScheduleEditorDialog({
  today,
  t,
  locale,
  base,
  onClose,
  onSaved,
  saveSchedule,
  scope = "ORGANIZATION",
  target,
  blastRadiusNote,
}: {
  today: string;
  t: (key: DictKey) => string;
  locale: Locale;
  base: WorkSchedule | null;
  onClose: () => void;
  onSaved: (ok: boolean, message: string) => void;
  saveSchedule: (schedule: WorkSchedule) => { ok: boolean; code?: string };
  /** §2.2: "EMPLOYEE" carries `target` and shows the blast-radius note. */
  scope?: "ORGANIZATION" | "EMPLOYEE";
  target?: string;
  blastRadiusNote?: string;
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

  const setField = (field: keyof ScheduleDraft) => (event: ChangeEvent<HTMLInputElement>) =>
    setDraft((current) => {
      const next = { ...current, [field]: event.target.value };
      // Moving either end of the working day recomputes the required minutes from
      // the new span. The field stays editable: a number typed by hand is left
      // alone until a time changes again, because only these two keys recompute.
      if (field === "expected_start" || field === "expected_end") {
        const span = minutesBetween(next.expected_start, next.expected_end);
        if (span !== null) next.expected_daily_minutes = String(span);
      }
      return next;
    });

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
        id: base?.id ?? `schedule-${scope.toLowerCase()}-${target ?? "org"}-${draft.effective_from}`,
        scope,
        ...(scope !== "ORGANIZATION" && target ? { target } : {}),
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
      {blastRadiusNote ? <p className="page-meta">{blastRadiusNote}</p> : null}
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

const weekdayLabel = (weekday: number, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, { weekday: "long" }).format(new Date(Date.UTC(2023, 0, 1 + weekday)));

const mediumDate = (value: string, locale: Locale): string =>
  dateIsValid(value) ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${value}T12:00:00Z`)) : value;
