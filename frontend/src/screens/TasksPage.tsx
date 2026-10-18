import { useEffect, useState } from "react";
import { useApp, usePageTitle } from "../app/AppContext";
import { Banner, Dialog, EmptyState } from "../components/ui";
import PageHeader from "../components/layout/PageHeader";
import { listEmployees } from "../app/orgApi";
import {
  createTask,
  fetchTasks,
  updateTaskStatus,
  type Task,
  type TaskStatus,
} from "../app/tasksApi";

/**
 * /tasks - the server owns the tasks. «مهامي» is what is assigned to the caller,
 * «مهام أنشأتها» is what they created; both come from one call, and the status
 * moves through the server so two people looking at the same task agree.
 *
 * The draft lives in a dialog rather than inline: the list is what the page is
 * for, and a form parked above it pushed the work down the screen. It reuses the
 * app's own Dialog, so focus, Escape and the scrim behave like every other
 * dialog in the product, and the tabs use the app's segmented control so the
 * active one reads as active.
 */
export default function TasksPage() {
  const { t, locale } = useApp();
  usePageTitle(t("tasksTitle"));

  const [lists, setLists] = useState<{ mine: Task[]; created: Task[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"mine" | "created">("mine");
  const [draft, setDraft] = useState({ title: "", details: "" });
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [people, setPeople] = useState<
    { id: number; full_name: string; department_code?: string | null }[]
  >([]);

  const copy = {
    newTask: locale === "ar" ? "مهمة جديدة" : "New task",
    dialogDescription:
      locale === "ar"
        ? "اكتب عنوان المهمة، وتقدر تضيف تفاصيل تساعد اللي هينفذها."
        : "Give the task a title; details help whoever picks it up.",
    titlePlaceholder: locale === "ar" ? "عنوان المهمة" : "Task title",
    detailsPlaceholder: locale === "ar" ? "تفاصيل (اختياري)" : "Details (optional)",
    create: locale === "ar" ? "إنشاء المهمة" : "Create task",
    cancel: locale === "ar" ? "إلغاء" : "Cancel",
    statusOpen: locale === "ar" ? "مفتوحة" : "Open",
    statusInProgress: locale === "ar" ? "قيد التنفيذ" : "In progress",
    statusDone: locale === "ar" ? "مكتملة" : "Done",
    banner: locale === "ar"
      ? "المهام بتُدار على الخادم: الإنشاء والتكليف وتغيير الحالة كلهم محفوظين."
      : "Tasks are managed by the server: creation, assignment and status changes are all persisted.",
    loadFailed: locale === "ar" ? "تعذّر تحميل المهام. جرّب تحديث الصفحة." : "Could not load the tasks. Try refreshing.",
    createFailed: locale === "ar" ? "تعذّر إنشاء المهمة. جرّب تاني." : "Could not create the task. Try again.",
    due: locale === "ar" ? "الاستحقاق" : "Due",
    titleRequired: locale === "ar" ? "العنوان مطلوب." : "A title is required.",
    assigneeLabel: locale === "ar" ? "المكلَّف بالمهمة (اختياري)" : "Assignee (optional)",
    unassigned: locale === "ar" ? "بدون تكليف" : "Unassigned",
    attachmentsLabel: locale === "ar" ? "مرفقات (اختياري)" : "Attachments (optional)",
    attachmentsHint:
      locale === "ar"
        ? "تقدر ترفع أكتر من ملف."
        : "You can attach more than one file.",
    filesChosen: locale === "ar" ? "ملف مختار" : "file(s) selected",
  };

  const reload = () => {
    setFailed(false);
    fetchTasks(locale)
      .then(setLists)
      .catch(() => setFailed(true));
  };

  useEffect(reload, [locale]);

  /* The people a task may be handed to: whoever the server lists for this
     caller. A failure leaves the picker empty rather than blocking the dialog. */
  useEffect(() => {
    listEmployees(locale)
      .then((rows) =>
        setPeople(
          rows.map((person) => ({
            id: person.id,
            full_name: person.full_name,
            department_code: person.department_code,
          })),
        ),
      )
      .catch(() => setPeople([]));
  }, [locale]);

  const move = async (task: Task, status: TaskStatus) => {
    try {
      await updateTaskStatus(task.id, status, locale);
      reload();
    } catch {
      /* The list keeps the last server truth: a refused write is not a state change. */
    }
  };

  const submit = async () => {
    if (draft.title.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await createTask(
        {
          title: draft.title.trim(),
          details: draft.details.trim(),
          assignee_id: assigneeId === "" ? null : Number(assigneeId),
        },
        locale,
      );
      setAssigneeId("");
      setFiles([]);
      setDraft({ title: "", details: "" });
      setComposing(false);
      reload();
    } catch {
      /* The dialog stays open with the draft: nothing typed is lost. */
      setError(copy.createFailed);
    } finally {
      setBusy(false);
    }
  };

  const closeComposer = () => {
    setComposing(false);
    setError(null);
    setDraft({ title: "", details: "" });
    setAssigneeId("");
    setFiles([]);
  };

  if (failed) {
    return (
      <div className="page">
        <PageHeader title={t("tasksTitle")} subtitle={t("tasksSubtitle")} />
        <Banner tone="error" role="alert">{copy.loadFailed}</Banner>
      </div>
    );
  }

  const rows = lists === null ? null : lists[tab];
  const statusLabel = (status: TaskStatus) =>
    status === "DONE" ? copy.statusDone : status === "IN_PROGRESS" ? copy.statusInProgress : copy.statusOpen;

  return (
    <div className="page">
      <PageHeader
        title={t("tasksTitle")}
        subtitle={t("tasksSubtitle")}
        primaryAction={
          <button type="button" className="btn btn-primary" onClick={() => setComposing(true)}>
            {copy.newTask}
          </button>
        }
      />
      <Banner tone="info" role="status">{copy.banner}</Banner>

      <div className="work-surface">
        <div className="section-heading">
          <div className="role-segmented segmented-full" role="tablist" aria-label={t("tasksTitle")}>
            {(["mine", "created"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`role-segmented-option${tab === key ? " is-selected" : ""}`}
                onClick={() => setTab(key)}
              >
                {key === "mine" ? t("taskListMine") : t("taskListCreated")}
              </button>
            ))}
          </div>
        </div>

        {rows === null ? (
          <EmptyState message={t("loading")} />
        ) : rows.length === 0 ? (
          <EmptyState message={tab === "mine" ? t("taskEmptyMine") : t("taskEmptyCreated")} />
        ) : (
          <ul className="compact-list">
            {rows.map((task) => (
              <li className="compact-row" key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  {task.details ? <div className="page-meta">{task.details}</div> : null}
                  <div className="page-meta">
                    {statusLabel(task.status)}
                    {task.due_date ? <> · {copy.due} <bdi dir="ltr">{task.due_date}</bdi></> : null}
                  </div>
                </div>
                <div className="row-actions">
                  {task.status === "OPEN" ? (
                    <button type="button" className="btn btn-secondary" onClick={() => move(task, "IN_PROGRESS")}>
                      {copy.statusInProgress}
                    </button>
                  ) : null}
                  {task.status !== "DONE" ? (
                    <button type="button" className="btn btn-secondary" onClick={() => move(task, "DONE")}>
                      {copy.statusDone}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {composing ? (
        <Dialog
          title={copy.newTask}
          description={copy.dialogDescription}
          onClose={closeComposer}
          dirty={draft.title.trim() !== "" || draft.details.trim() !== ""}
          busy={busy}
        >
          {error ? <Banner tone="error" role="alert">{error}</Banner> : null}
          <div className="form-stack">
            <label className="field">
              <span>{copy.titlePlaceholder}</span>
              <input
                className="input"
                autoFocus
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{copy.detailsPlaceholder}</span>
              <textarea
                className="input"
                rows={3}
                value={draft.details}
                onChange={(event) => setDraft({ ...draft, details: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{copy.assigneeLabel}</span>
              <select
                className="input"
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
              >
                <option value="">{copy.unassigned}</option>
                {people.map((person) => (
                  <option key={person.id} value={String(person.id)}>
                    {person.full_name}
                    {person.department_code ? ` · ${person.department_code}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{copy.attachmentsLabel}</span>
              <input
                className="input"
                type="file"
                multiple
                onChange={(event) => setFiles([...(event.target.files ?? [])])}
              />
              <span className="page-meta">
                {files.length > 0 ? `${files.length} ${copy.filesChosen}` : copy.attachmentsHint}
              </span>
            </label>
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={closeComposer} disabled={busy}>
              {copy.cancel}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || draft.title.trim() === ""}
              title={draft.title.trim() === "" ? copy.titleRequired : undefined}
              onClick={submit}
            >
              {copy.create}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
