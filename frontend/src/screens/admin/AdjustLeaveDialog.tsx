import { useMemo, useState, type FormEvent } from "react";
import { useApp } from "../../app/AppContext";
import type { LeaveBalance } from "../../mock/attendance";
import type { Dict } from "../../i18n/dict";
import { Banner, Dialog, StatusPill, type StatusTone } from "../../components/ui";

type DictKey = keyof Dict;

export const leaveTypeKeys: Record<LeaveBalance["leave_type"], DictKey> = {
  ANNUAL: "leaveAnnual",
  SICK: "leaveSick",
  UNPAID: "leaveUnpaid",
  EMERGENCY: "leaveEmergency",
};

export type AdjustLeaveOutcome =
  | { ok: true }
  | { ok: false; code: "CAPABILITY_DENIED" | "INVALID_INPUT" | "CANCELLED" };

/**
 * Shared "Adjust leave balance" dialog (spec §1.2 + §2.4 — one component,
 * two callers). Employee is pre-filled from context or passed by the caller;
 * org-level selector can be added by a later stage on the same props.
 * It calls the existing `adjustLeaveBalance` and surfaces CAPABILITY_DENIED /
 * INVALID_INPUT honestly instead of pretending success.
 */
export default function AdjustLeaveDialog({
  employeeId,
  initialLeaveType,
  availableTypes,
  onClose,
}: {
  employeeId: string;
  employeeName?: string;
  initialLeaveType: LeaveBalance["leave_type"];
  availableTypes: LeaveBalance["leave_type"][];
  onClose: (outcome: AdjustLeaveOutcome) => void;
}) {
  const { t, locale, leaveBalances, leaveBalanceSummary, adjustLeaveBalance } = useApp();
  const [leaveType, setLeaveType] = useState<LeaveBalance["leave_type"]>(initialLeaveType);
  const [daysText, setDaysText] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const balance = useMemo(
    () => leaveBalances.find((row) => row.leave_type === leaveType) ?? null,
    [leaveBalances, leaveType],
  );
  const summary = balance ? leaveBalanceSummary(balance) : null;
  const parsedDays = /^-?\d+$/.test(daysText.trim()) ? Number(daysText.trim()) : Number.NaN;
  const daysValid = Number.isInteger(parsedDays) && parsedDays !== 0;
  const projectedRemaining = daysValid && summary ? summary.remaining + parsedDays : null;
  const signedDays = (value: number): string => {
    const text = new Intl.NumberFormat(locale, { signDisplay: "exceptZero" }).format(value);
    return text;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!daysValid) return;
    if (!reason.trim()) return;
    setSubmitting(true);
    // The context mutation applies asynchronously (demo layer); give it a
    // beat so the pending state is honest, then resolve.
    window.setTimeout(() => {
      const result = adjustLeaveBalance(leaveType, parsedDays, reason.trim());
      if (result.ok) {
        onClose({ ok: true });
        return;
      }
      setSubmitting(false);
      // Surface the refusal with the existing honest-copy keys.
      window.alert(
        result.code === "CAPABILITY_DENIED"
          ? t("adminMutationDenied")
          : t("adminMutationInvalid"),
      );
    }, 150);
  };

  const fmt = (value: number): string => new Intl.NumberFormat(locale).format(value);

  return (
    <Dialog
      title={t("adminAdjustBalance")}
      description={t("adminAdjustDialogDescription")}
      busy={submitting}
      dirty={Boolean(daysText.trim() || reason.trim())}
      onClose={() => onClose({ ok: false, code: "CANCELLED" })}
    >
      <form noValidate onSubmit={submit} aria-busy={submitting}>
        {submitting ? (
          <Banner tone="info">{t("adminAdjustPending")}</Banner>
        ) : null}
        <label className="field">
          <span className="field-label">{t("employee")}</span>
          <input className="input" value={employeeId} readOnly dir="ltr" />
        </label>
        <label className="field">
          <span className="field-label">{t("adminLeaveType")}</span>
          <select
            className="select"
            value={leaveType}
            onChange={(event) => setLeaveType(event.target.value as LeaveBalance["leave_type"])}
            disabled={submitting}
          >
            {availableTypes.map((code) => (
              <option key={code} value={code}>{t(leaveTypeKeys[code])}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t("adminDays")}</span>
          <input
            className="input"
            type="number"
            step={1}
            inputMode="numeric"
            dir="ltr"
            value={daysText}
            placeholder="+1 / -2"
            aria-required="true"
            aria-invalid={daysText.trim() !== "" && !daysValid ? "true" : undefined}
            aria-describedby="adjust-days-hint"
            onChange={(event) => setDaysText(event.target.value)}
            disabled={submitting}
          />
          <span className="field-hint" id="adjust-days-hint">{t("adminDaysHint")}</span>
        </label>
        <label className="field">
          <span className="field-label">{t("decisionComment")}</span>
          <input
            className="input"
            type="text"
            required
            value={reason}
            aria-required="true"
            onChange={(event) => setReason(event.target.value)}
            disabled={submitting}
          />
        </label>
        {/* Preview of the resulting row (spec: "preview of the change row, confirm"). */}
        {summary && projectedRemaining !== null ? (
          <div className="quiet-inset">
            <p className="page-meta">{t("adminAdjustPreview")}</p>
            <dl className="decision-facts">
              <div>
                <dt>{t("adminLeaveType")}</dt>
                <dd>{t(leaveTypeKeys[leaveType])}</dd>
              </div>
              <div>
                <dt>{t("adminAdjustmentsTotal")}</dt>
                <dd><bdi dir="ltr">{signedDays(summary.adjustments_total + parsedDays)}</bdi></dd>
              </div>
              <div>
                <dt>{t("adminAdjustResultingRemaining")}</dt>
                <dd><strong>{fmt(projectedRemaining)}</strong></dd>
              </div>
            </dl>
            <StatusPill tone={"info" as StatusTone} label={t("adminPeriod") + " · " + balance!.period} />
          </div>
        ) : balance === null ? (
          <Banner tone="warning">{t("adminAdjustNoBalance")}</Banner>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={() => onClose({ ok: false, code: "CANCELLED" })} disabled={submitting}>
            {t("cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting || !daysValid || !reason.trim() || !balance}>
            {submitting ? <><span className="spinner" aria-hidden="true" />{t("adminAdjustPending")}</> : t("confirm")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
