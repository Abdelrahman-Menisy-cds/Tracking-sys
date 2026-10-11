import { useApp } from "../../app/AppContext";
import { findDirectoryEntry } from "../../mock/data";
import { formatDateTime, formatDate } from "../../app/useMockList";
import { TaskPriorityPill, TaskStatusPill } from "./TaskPills";
import type { TaskMock } from "../../mock/tasks";

/**
 * The task detail — facts, status, assignee, due date. Brief H3 defect 2:
 * the trail («سجل المهمة») moved BELOW the work-time panel («وخلي سجل
 * المهمه اخر حاجه في الصفحه»), so the page renders it as the final section.
 */
export default function TaskDetailBody({ task }: { task: TaskMock }) {
  const { t, locale } = useApp();
  const creator = task.created_by ? findDirectoryEntry(task.created_by) : null;
  const assignee = task.assignee ? findDirectoryEntry(task.assignee) : null;
  const routedToEvent = [...task.events].reverse().find((event) => event.action === "ROUTE_TO_MANAGER");
  const routedTo = task.routed_to_manager ?? routedToEvent?.routed_to ?? null;
  const routedName = routedTo ? findDirectoryEntry(routedTo)?.name[locale] ?? routedTo : null;
  return (
    <div>
      <section className="work-surface section" aria-labelledby="task-facts">
        <h2 id="task-facts">{t("taskDetailTitle")}</h2>
        <dl className="decision-facts">
          <div>
            <dt>{t("taskStatus")}</dt>
            <dd><TaskStatusPill status={task.status} /></dd>
          </div>
          <div>
            <dt>{t("taskPriorityLabel")}</dt>
            <dd><TaskPriorityPill priority={task.priority} /></dd>
          </div>
          <div>
            <dt>{t("taskCreatedBy")}</dt>
            <dd>{creator ? <bdi>{creator.name[locale]}</bdi> : <bdi dir="ltr">{task.created_by}</bdi>}</dd>
          </div>
          <div>
            <dt>{t("taskAssigneeLabel")}</dt>
            <dd>{assignee ? <bdi>{assignee.name[locale]}</bdi> : <span className="page-meta">{t("taskUnassigned")}</span>}</dd>
          </div>
          {routedName ? (
            <div>
              <dt>{t("taskRoutedManager")}</dt>
              <dd><bdi>{routedName}</bdi></dd>
            </div>
          ) : null}
          {task.due_date ? (
            <div>
              <dt>{t("taskDueDateLabel")}</dt>
              <dd><bdi dir="ltr">{formatDate(`${task.due_date}T12:00:00Z`, locale)}</bdi></dd>
            </div>
          ) : null}
          <div>
            <dt>{t("taskWillBeCreatedAt")}</dt>
            <dd><bdi dir="ltr">{formatDateTime(task.created_at, locale)}</bdi></dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
