import { useEffect, useState } from "react";
import { useApp, usePageTitle } from "../app/AppContext";
import { Banner, EmptyState } from "../components/ui";
import PageHeader from "../components/layout/PageHeader";
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
 */
export default function TasksPage() {
  const { t, locale } = useApp();
  usePageTitle(t("tasksTitle"));

  const [lists, setLists] = useState<{ mine: Task[]; created: Task[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"mine" | "created">("mine");
  const [draft, setDraft] = useState({ title: "", details: "" });
  const [busy, setBusy] = useState(false);

  const copy = {
    newTask: locale === "ar" ? "مهمة جديدة" : "New task",
    titlePlaceholder: locale === "ar" ? "عنوان المهمة" : "Task title",
    detailsPlaceholder: locale === "ar" ? "تفاصيل (اختياري)" : "Details (optional)",
    statusOpen: locale === "ar" ? "مفتوحة" : "Open",
    statusInProgress: locale === "ar" ? "قيد التنفيذ" : "In progress",
    statusDone: locale === "ar" ? "مكتملة" : "Done",
    banner: locale === "ar"
      ? "المهام بتُدار على الخادم: الإنشاء والتكليف وتغيير الحالة كلهم محفوظين."
      : "Tasks are managed by the server: creation, assignment and status changes are all persisted.",
    loadFailed: locale === "ar" ? "تعذّر تحميل المهام. جرّب تحديث الصفحة." : "Could not load the tasks. Try refreshing.",
    due: locale === "ar" ? "الاستحقاق" : "Due",
    titleRequired: locale === "ar" ? "العنوان مطلوب." : "A title is required.",
  };

  const reload = () => {
    setFailed(false);
    fetchTasks(locale)
      .then(setLists)
      .catch(() => setFailed(true));
  };

  useEffect(reload, [locale]);

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
    try {
      await createTask({ title: draft.title.trim(), details: draft.details.trim() }, locale);
      setDraft({ title: "", details: "" });
      reload();
    } catch {
      /* Keep the draft so nothing typed is lost. */
    } finally {
      setBusy(false);
    }
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
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || draft.title.trim() === ""}
            title={draft.title.trim() === "" ? copy.titleRequired : undefined}
            onClick={submit}
          >
            {copy.newTask}
          </button>
        }
      />
      <Banner tone="info" role="status">{copy.banner}</Banner>

      <div className="work-surface">
        <div className="section-heading">
          <h2>{tab === "mine" ? t("taskListMine") : t("taskListCreated")}</h2>
          <div className="segmented" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "mine"}
              className={tab === "mine" ? "is-active" : undefined}
              onClick={() => setTab("mine")}
            >
              {t("taskListMine")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "created"}
              className={tab === "created" ? "is-active" : undefined}
              onClick={() => setTab("created")}
            >
              {t("taskListCreated")}
            </button>
          </div>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>{copy.titlePlaceholder}</span>
            <input
              className="input"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{copy.detailsPlaceholder}</span>
            <input
              className="input"
              value={draft.details}
              onChange={(event) => setDraft({ ...draft, details: event.target.value })}
            />
          </label>
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
    </div>
  );
}
