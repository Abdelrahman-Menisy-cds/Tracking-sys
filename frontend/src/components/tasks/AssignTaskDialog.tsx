import { useState, type FormEvent } from "react";
import { useApp } from "../../app/AppContext";
import { Banner, Dialog } from "../ui";
import { findDirectoryEntry } from "../../mock/data";
import type { TaskMock, TaskMutationResult } from "../../mock/tasks";

/**
 * The assign dialog. The assignee select is the control carrying the whole
 * action: when the actor cannot assign, the button never activates —
 * `taskCapacityDeniedNote` names the refusal on the inactive button — and the
 * context itself refuses too (CAPABILITY_DENIED) so nothing depends on the UI.
 */
export default function AssignTaskDialog({
  task,
  employees,
  canAssign,
  onClose,
  onAssign,
}: {
  task: TaskMock;
  /** Directory entries offered in the select (roster + managers, localized). */
  employees: NonNullable<ReturnType<typeof findDirectoryEntry>>[];
  canAssign: boolean;
  onClose: (assigned: TaskMock | null) => void;
  onAssign: (taskId: string, to: string | null) => TaskMutationResult<TaskMock>;
}) {
  const { t, locale } = useApp();
  const [assignee, setAssignee] = useState(task.assignee ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [rejected, setRejected] = useState<"CAPABILITY_DENIED" | "INVALID_INPUT" | "MISSING_RECORD" | null>(null);
  const blockedHintId = "assign-task-blocked-hint";
  const pickRequired = !assignee;
  const nameOf = (id: string): string => findDirectoryEntry(id)?.name[locale] ?? id;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    window.setTimeout(() => {
      const result = onAssign(task.id, assignee || null);
      if (result.ok) {
        onClose(result.value ?? null);
        return;
      }
      setSubmitting(false);
      setRejected(result.code);
    }, 150);
  };

  const buttonDisabled = submitting || !canAssign || pickRequired;
  const buttonHint = !canAssign ? t("taskCapacityDeniedNote") : pickRequired ? t("taskAssignPickFirst") : undefined;

  return (
    <Dialog
      title={t("taskAssignHeading")}
      description={t("taskAssignDialogDescription")}
      busy={submitting}
      dirty={assignee !== (task.assignee ?? "")}
      onClose={() => onClose(null)}
    >
      <form noValidate onSubmit={submit} aria-busy={submitting}>
        {submitting ? <Banner tone="info">{t("saving")}</Banner> : null}
        {rejected && !submitting ? (
          <Banner tone="error" role="alert">
            {rejected === "CAPABILITY_DENIED"
              ? t("adminMutationDenied")
              : rejected === "MISSING_RECORD"
                ? t("taskInvalidAssignee")
                : t("adminMutationInvalid")}
          </Banner>
        ) : null}
        <label className="field">
          <span className="field-label">{t("taskTitleLabel")}</span>
          <input className="input" value={task.title} readOnly dir="auto" />
        </label>
        <dl className="decision-facts">
          <div>
            <dt>{t("taskAssigneeLabel")}</dt>
            <dd>{task.assignee ? <bdi>{nameOf(task.assignee)}</bdi> : <span className="page-meta">{t("taskUnassigned")}</span>}</dd>
          </div>
          {task.routed_to_manager ? (
            <div>
              <dt>{t("taskRoutedManager")}</dt>
              <dd><bdi>{nameOf(task.routed_to_manager)}</bdi></dd>
            </div>
          ) : null}
        </dl>
        <label className="field">
          <span className="field-label">
            {t("taskAssignee")}
            <span className="field-required">{t("adminRequiredMark")}</span>
          </span>
          <select
            className="select"
            data-testid="assign-task-assignee-picker"
            value={assignee}
            aria-required="true"
            aria-invalid={pickRequired && rejected === "INVALID_INPUT" ? "true" : undefined}
            aria-describedby={buttonHint ? blockedHintId : undefined}
            onChange={(event) => setAssignee(event.target.value)}
            disabled={submitting || !canAssign}
          >
            <option value="">{locale === "ar" ? "اختر موظفًا" : "Choose an employee"}</option>
            {employees.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name[locale]}</option>
            ))}
          </select>
        </label>
        {buttonHint ? (
          <p className="dialog-blocked-hint" id={blockedHintId} role="status">{buttonHint}</p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={() => onClose(null)} disabled={submitting}>
            {t("cancel")}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={buttonDisabled}
            aria-busy={submitting}
          >
            {submitting ? <><span className="spinner" aria-hidden="true" />{t("saving")}</> : t("taskAssignAction")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
