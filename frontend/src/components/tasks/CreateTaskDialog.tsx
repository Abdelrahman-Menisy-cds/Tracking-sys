import { useMemo, useState, type FormEvent } from "react";
import { useApp } from "../../app/AppContext";
import { formatDateTime } from "../../app/useMockList";
import { Banner, Dialog, StatusPill } from "../ui";
import { findDirectoryEntry } from "../../mock/data";
import type { TaskCapability, TaskMock, TaskMutationResult, TaskPriority } from "../../mock/tasks";

export type TaskPriorityTone = "warning" | "info" | "neutral";

export function taskPriorityTone(priority: TaskPriority): TaskPriorityTone {
  return priority === "HIGH" ? "warning" : priority === "MEDIUM" ? "info" : "neutral";
}

export function taskPriorityLabel(priority: TaskPriority, locale: "ar" | "en"): string {
  return locale === "ar"
    ? priority === "HIGH" ? "عالية" : priority === "MEDIUM" ? "متوسطة" : "منخفضة"
    : priority === "HIGH" ? "High" : priority === "MEDIUM" ? "Medium" : "Low";
}

/**
 * The create-task dialog.
 * The assign control and the manager picker are two DIFFERENT clauses of one
 * branch: the assignee select only renders when the creator may assign; when
 * they may not, the manager select is mandatory and takes its place. No
 * layout where both are true.
 */
export default function CreateTaskDialog({
  capability,
  employees,
  managers,
  onClose,
  onCreate,
}: {
  capability: TaskCapability;
  /** Directory entries offered in the assignee select (the employees). */
  employees: ReturnType<typeof findDirectoryEntry>[];
  /** Directory entries offered in the manager picker (managers + HR). */
  managers: ReturnType<typeof findDirectoryEntry>[];
  onClose: (created: TaskMock | null) => void;
  onCreate: (input: { title: string; description: string; priority: TaskPriority; dueDate: string | null; assignee: string | null; routeTo: string | null }) => TaskMutationResult<TaskMock>;
}) {
  const { t, locale } = useApp();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState("");
  const [routeTo, setRouteTo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rejected, setRejected] = useState<"CAPABILITY_DENIED" | "INVALID_INPUT" | "MISSING_RECORD" | null>(null);
  const titleId = "create-task-title";

  const canAssign = capability.can_assign_tasks;
  const parseDue = (value: string): string | null => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  const assigneeId = canAssign && assignee ? assignee : null;
  const routeToId = !canAssign && routeTo ? routeTo : null;

  /**
   * The picker's emptiness is a data condition, not a neutral state: with the
   * trail holding no one to route to, a save here would strand the task. The
   * dialog blocks the submit — the context would refuse it too, but this way
   * the disabled button carries an aria-describedby pointing at the reason.
   */
  const managerListEmpty = !canAssign && managers.length === 0;
  const pickerEmpty = !canAssign && !routeTo;
  const formReady = Boolean(title.trim()) && (!canAssign || Boolean(assignee)) && (!managerListEmpty && pickerEmpty ? false : true);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    if (canAssign && !assignee) return;
    if (!canAssign && !routeTo) return;
    setSubmitting(true);
    // The context mutation applies asynchronously (demo layer); the 150ms beat
    // keeps the pending state honest before the dialog resolves.
    window.setTimeout(() => {
      const result = onCreate({
        title: title.trim(),
        description: description.trim(),
        priority,
        dueDate: parseDue(dueDate),
        assignee: assigneeId,
        routeTo: routeToId,
      });
      if (result.ok) {
        onClose(result.value ?? null);
        return;
      }
      setSubmitting(false);
      setRejected(result.code);
    }, 150);
  };

  const namesInPicker = useMemo(() => managers, [managers]);
  const createdFor = useMemo(() => {
    const target = canAssign ? findDirectoryEntry(assignee) : findDirectoryEntry(routeTo);
    return target?.name[locale] ?? null;
  }, [assignee, routeTo, canAssign, locale]);

  // Brief H3 — the ONE shared formatting path; no component-local Intl formatters.
  const fmtStamp = (value: string): string => formatDateTime(value, locale);

  return (
    <Dialog
      title={t("taskCreate")}
      description={t("taskCreateDialogDescription")}
      busy={submitting}
      dirty={Boolean(title.trim() || description.trim())}
      onClose={() => onClose(null)}
    >
      <form noValidate onSubmit={submit} aria-busy={submitting}>
        {submitting ? <Banner tone="info">{t("taskCreating")}</Banner> : null}
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
          <span className="field-label">
            {t("taskTitleLabel")}
            <span className="field-required">{t("adminRequiredMark")}</span>
          </span>
          <input
            className="input"
            id={titleId}
            type="text"
            required
            value={title}
            autoComplete="off"
            aria-invalid={title.trim() === "" && rejected === "INVALID_INPUT" ? "true" : undefined}
            onChange={(event) => setTitle(event.target.value)}
            disabled={submitting}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("details")}</span>
          <textarea className="textarea" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} disabled={submitting} />
        </label>
        <div className="row-actions">
          <label className="field">
            <span className="field-label">{t("taskPriority")}</span>
            <select className="select" value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} disabled={submitting}>
              {(["HIGH", "MEDIUM", "LOW"] as TaskPriority[]).map((code) => (
                <option key={code} value={code}>{taskPriorityLabel(code, locale)}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t("taskDueDate")}</span>
            <input className="input" type="date" dir="ltr" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={submitting} />
          </label>
        </div>
        <label className="field">
          <span className="field-label">{t("taskStatus")}</span>
          <StatusPill tone="info" label={t("stOpen")} />
        </label>
        {canAssign ? (
          <label className="field">
            <span className="field-label">
              {t("taskAssignee")}
              <span className="field-required">{t("adminRequiredMark")}</span>
            </span>
            <select
              className="select"
              value={assignee}
              required
              aria-required="true"
              onChange={(event) => setAssignee(event.target.value)}
              disabled={submitting}
            >
              <option value="">{locale === "ar" ? "اختر موظفًا" : "Choose an employee"}</option>
              {employees.map((entry) => entry ? <option key={entry.id} value={entry.id}>{entry.name[locale]}</option> : null)}
            </select>
          </label>
        ) : (
          <label className="field">
            <span className="field-label">
              {t("taskRouteManagerLabel")}
              <span className="field-required">{t("adminRequiredMark")}</span>
            </span>
            <select
              className="select"
              data-testid="create-task-manager-picker"
              value={routeTo}
              required
              aria-required="true"
              aria-invalid={pickerEmpty && rejected === "INVALID_INPUT" ? "true" : undefined}
              aria-describedby={managers.length === 0 ? "create-task-manager-empty" : undefined}
              onChange={(event) => setRouteTo(event.target.value)}
              disabled={submitting || managers.length === 0}
            >
              <option value="">{locale === "ar" ? "اختر مديرًا" : "Choose a manager"}</option>
              {namesInPicker.map((entry) => entry ? <option key={entry.id} value={entry.id}>{entry.name[locale]}</option> : null)}
            </select>
            {managers.length === 0 ? (
              <span className="field-error" id="create-task-manager-empty" role="alert">{t("taskNoManagerOptions")}</span>
            ) : (
              <span className="field-hint">{t("taskManagerHint")}</span>
            )}
          </label>
        )}
        {createdFor ? (
          <div className="quiet-inset">
            <dl className="decision-facts">
              <div>
                <dt>{t("taskRoutePreview")}</dt>
                <dd>{t("taskRoutePreviewLine").replace("%s", createdFor)}</dd>
              </div>
              <div>
                <dt>{t("taskWillBeCreatedAt")}</dt>
                <dd>{fmtStamp(new Date().toISOString())}</dd>
              </div>
            </dl>
          </div>
        ) : null}
        {pickerEmpty && !managerListEmpty && !canAssign ? (
          <p className="dialog-blocked-hint" role="status">{t("taskPickManagerFirst")}</p>
        ) : null}
        {managerListEmpty ? (
          <Banner tone="warning">{t("taskManagerListEmpty")}</Banner>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={() => onClose(null)} disabled={submitting}>
            {t("cancel")}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !formReady}
            aria-describedby={pickerEmpty && managerListEmpty ? "create-task-manager-empty" : undefined}
          >
            {submitting ? <><span className="spinner" aria-hidden="true" />{t("taskCreating")}</> : t("taskCreate")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
