import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { Banner, EmptyState } from "../components/ui";
import PageHeader from "../components/layout/PageHeader";
import type { EmployeeDirectoryEntry } from "../mock/data";
import { identityEmployeeId } from "../mock/attendance";
import TaskDetailBody from "../components/tasks/TaskDetailBody";
import TaskWorkPanel from "../components/tasks/TaskWorkPanel";
import AssignTaskDialog from "../components/tasks/AssignTaskDialog";
import type { TaskMock } from "../mock/tasks";

/**
 * /tasks/:taskId — the task detail page: facts, the append-only trail, and the
 * assign action. The assign button renders only when the viewer holds the
 * assign capability; the dialog and the context both refuse without it, so the
 * mirror never lies and never decides on its own.
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
      <TaskDetailBody task={task} />
      {/* Brief H1 — status control + work timer, right beside the facts. */}
      <TaskWorkPanel task={task} />
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
