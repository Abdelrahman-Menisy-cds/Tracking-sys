import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { Banner, EmptyState } from "../components/ui";
import PageHeader from "../components/layout/PageHeader";
import type { EmployeeDirectoryEntry } from "../mock/data";
import { identityEmployeeId } from "../mock/attendance";
import TaskStatusBar from "../components/tasks/TaskStatusBar";
import TaskDetailBody from "../components/tasks/TaskDetailBody";
import TaskWorkPanel from "../components/tasks/TaskWorkPanel";
import TaskTimeline from "../components/tasks/TaskTimeline";
import AssignTaskDialog from "../components/tasks/AssignTaskDialog";
import type { TaskMock } from "../mock/tasks";

/**
 * /tasks/:taskId — the task detail page. Brief H4's order, top to bottom:
 *
 *   header → status bar → timer card → facts → trail → assign action
 *
 * The status bar sits directly under the page header as the first content;
 * the timer card sits right under it because it is what the user interacts
 * with. The trail stays the LAST content section (H3 moved it there
 * deliberately; «وخلي سجل المهمه اخر حاجه في الصفحه» — do not undo that).
 * The assign button renders only when the viewer holds the assign
 * capability; both the dialog and the context refuse without it.
 */
export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { t, role, employeeDirectory, tasks, taskCapabilityFor, assignTask } = useApp();
  usePageTitle(t("taskDetailTitle"));

  const myId = identityEmployeeId(role);
  const myCapability = taskCapabilityFor(myId);
  const task = useMemo(() => tasks.find((candidate) => candidate.id === taskId) ?? null, [tasks, taskId]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignedNote, setAssignedNote] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const employeeOptions = useMemo(
    () => employeeDirectory.filter((entry) => !["m1", "hr1", "emp-2001", "emp-2002", "emp-2003"].includes(entry.id)),
    [employeeDirectory],
  );
  const managerOptions = useMemo(
    () => employeeDirectory.filter((entry) => ["m1", "hr1", "emp-2001", "emp-2002", "emp-2003"].includes(entry.id)),
    [employeeDirectory],
  );

  if (!taskId || !task) {
    return (
      <div className="page">
        <PageHeader title={t("taskDetailTitle")} breadcrumb={<Link to="/tasks">{t("tasksTitle")}</Link>} />
        <EmptyState message={t("taskEmptyRouted")} />
      </div>
    );
  }

  const openAssign = () => {
    if (!myCapability.can_assign_tasks) {
      setRefused(t("taskCapacityDeniedNote"));
      return;
    }
    setAssignOpen(true);
  };

  return (
    <div className="page">
      <PageHeader title={<bdi>{task.title}</bdi>} subtitle={task.description || undefined} breadcrumb={<Link to="/tasks">{t("tasksTitle")}</Link>} />
      {refused ? <Banner tone="error" role="alert">{refused}</Banner> : null}
      {assignedNote ? <Banner tone="success" role="status">{assignedNote}</Banner> : null}
      {/* Brief H4 — the status bar first, right under the header. */}
      <TaskStatusBar task={task} />
      {/* Brief H4 — the timer card directly under the status bar. */}
      <TaskWorkPanel task={task} />
      <TaskDetailBody task={task} />
      {/* Brief H3 — the trail is the LAST section on the page. */}
      <section className="work-surface section" aria-labelledby="task-trail">
        <h2 id="task-trail">{t("taskTrailHeading")}</h2>
        {/* The trail is append-only — a REASSIGN keeps the previous ASSIGN;
            nothing is overwritten, which is exactly what history demands. */}
        <TaskTimeline events={task.events} />
      </section>
      <div className="form-actions">
        {task.assignee === null ? (
          <button type="button" className="btn btn-secondary" data-testid="detail-assign-open" onClick={openAssign}>
            {t("taskAssignAction")}
          </button>
        ) : null}
      </div>
      {assignOpen ? (
        <AssignTaskDialog
          task={task}
          employees={[...employeeOptions, ...managerOptions] as EmployeeDirectoryEntry[]}
          canAssign={myCapability.can_assign_tasks}
          onClose={(assigned: TaskMock | null) => {
            setAssignOpen(false);
            if (assigned) setAssignedNote(t("taskAssigned"));
          }}
          onAssign={assignTask}
        />
      ) : null}
    </div>
  );
}
