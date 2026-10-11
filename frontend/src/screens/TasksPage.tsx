import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { Banner, EmptyState } from "../components/ui";
import OperationalTable, { type OperationalColumn } from "../components/data/OperationalTable";
import PageHeader from "../components/layout/PageHeader";
import { formatDateTime } from "../app/useMockList";
import { findDirectoryEntry } from "../mock/data";
import { identityEmployeeId } from "../mock/attendance";
import { TaskDemoBanner, TaskPriorityPill, TaskStatusPill } from "../components/tasks/TaskPills";
import CreateTaskDialog from "../components/tasks/CreateTaskDialog";
import AssignTaskDialog from "../components/tasks/AssignTaskDialog";
import TaskTimesheetSection from "../components/tasks/TaskTimesheetSection";
import type { TaskMock, TaskStatus } from "../mock/tasks";

type TaskTab = "needs" | "mine" | "created" | "timesheet";
type StatusFilter = TaskStatus | "ALL";

/**
 * /tasks — the tasks cycle screen. Scoped sections under tabs: for a manager
 * the needs-assignment queue is the FIRST tab, carries a live count, and an
 * extra warning banner sits above the table when it is non-empty — impossible
 * to miss, as the brief demands. Tabs an identity cannot use do not render.
 */
export default function TasksPage() {
  const { t, locale, role, employeeDirectory, tasks, taskCapabilityFor, createTask, assignTask, taskTimeEntries } = useApp();
  usePageTitle(t("tasksTitle"));

  const myId = identityEmployeeId(role);
  const myCapability = taskCapabilityFor(myId);
  const isManager = role === "manager";

  const employeeOptions = useMemo(
    () => employeeDirectory.filter((entry) => !["m1", "hr1", "emp-2001", "emp-2002", "emp-2003"].includes(entry.id)),
    [employeeDirectory],
  );
  const managerOptions = useMemo(
    () => employeeDirectory.filter((entry) => ["m1", "hr1", "emp-2001", "emp-2002", "emp-2003"].includes(entry.id)),
    [employeeDirectory],
  );

  const myTasks = useMemo(() => tasks.filter((task) => task.assignee === myId), [tasks, myId]);
  const createdTasks = useMemo(() => tasks.filter((task) => task.created_by === myId), [tasks, myId]);
  const needsAssignment = useMemo(
    () => tasks.filter((task) => task.assignee === null && task.routed_to_manager === myId),
    [tasks, myId],
  );
  /**
   * Brief H2 — the timesheet reads the H1 store through the context's live
   * state (the single truth); it stays in sync with any timer just stopped.
   */
  const timeEntries = taskTimeEntries ?? [];

  const [activeTab, setActiveTab] = useState<TaskTab>(isManager ? "needs" : "mine");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<TaskMock | null>(null);
  const [recent, setRecent] = useState<{ task: TaskMock; routed: boolean } | null>(null);

  const hasLoggedTime = timeEntries.length > 0;
  const tabs = useMemo(() => {
    const list: { id: TaskTab; label: string; count: number }[] = [];
    if (isManager) list.push({ id: "needs", label: t("tasksNeedsAssignmentTitle"), count: needsAssignment.length });
    list.push({ id: "mine", label: t("taskListMine"), count: myTasks.length });
    if (myCapability.can_create_tasks) list.push({ id: "created", label: t("taskListCreated"), count: createdTasks.length });
    // Brief H2 — the timesheet tab renders for any identity that can see
    // time: an employee their own logged time, a manager/HR the team's.
    if (hasLoggedTime) list.push({ id: "timesheet", label: t("taskTabTimesheet"), count: 0 });
    return list;
  }, [isManager, myCapability.can_create_tasks, myTasks.length, createdTasks.length, needsAssignment.length, hasLoggedTime, t]);

  const isAssignCapable = myCapability.can_assign_tasks;

  const columnsFor = (section: TaskTab): OperationalColumn<TaskMock>[] => {
    const columns: OperationalColumn<TaskMock>[] = [
      {
        key: "title",
        label: t("taskTitleLabel"),
        render: (task) => (
          <div>
            <Link to={`/tasks/${task.id}`}><bdi>{task.title}</bdi></Link>
            <div className="muted"><TaskStatusPill status={task.status} /></div>
          </div>
        ),
      },
      { key: "priority", label: t("taskPriorityLabel"), render: (task) => <TaskPriorityPill priority={task.priority} /> },
      {
        key: "assignee",
        label: t("taskAssigneeLabel"),
        render: (task) => task.assignee
          ? <bdi>{findDirectoryEntry(task.assignee)?.name[locale] ?? task.assignee}</bdi>
          : <span className="page-meta">{t("taskUnassigned")}</span>,
      },
    ];
    if (section === "needs") {
      columns.push({
        key: "creator",
        label: t("taskCreatedBy"),
        render: (task) => <bdi>{findDirectoryEntry(task.created_by)?.name[locale] ?? task.created_by}</bdi>,
      });
      columns.push({
        key: "action",
        label: t("taskAssignAction"),
        render: (task) => isAssignCapable ? (
          <div className="row-actions">
            <button type="button" className="btn btn-secondary" data-testid={`assign-${task.id}`} onClick={() => setAssignTarget(task)}>
              {t("taskAssignAction")}
            </button>
          </div>
        ) : <span className="page-meta">{t("taskCapacityDeniedNote")}</span>,
      });
    } else {
      columns.push({
        key: "created",
        label: t("taskWillBeCreatedAt"),
        render: (task) => <bdi dir="ltr">{formatDateTime(task.created_at, locale)}</bdi>,
      });
    }
    return columns;
  };

  const visibleTasks = (section: TaskTab): TaskMock[] => {
    const base = section === "needs" ? needsAssignment : section === "mine" ? myTasks : createdTasks;
    return statusFilter === "ALL" ? base : base.filter((task) => task.status === statusFilter);
  };

  const needsAttention = isManager && needsAssignment.length > 0;
  const activeLabel = (id: TaskTab): string => tabs.find((tab) => tab.id === id)?.label ?? t("taskListMine");

  return (
    <div className="page">
      <PageHeader title={t("tasksTitle")} subtitle={t("tasksSubtitle")} />
      <TaskDemoBanner />
      {needsAttention ? (
        <Banner tone="warning" role="status">{`${t("tasksNeedsAssignmentTitle")}: ${needsAssignment.length}`}</Banner>
      ) : null}
      {recent ? (
        <Banner tone="success" role="status">
          {recent.routed ? t("taskCreatedRouted") : t("taskCreated")}
          {" — "}
          <Link to={`/tasks/${recent.task.id}`}><bdi>{recent.task.title}</bdi></Link>
        </Banner>
      ) : null}

      {myCapability.can_create_tasks ? (
        <div className="form-actions">
          <button type="button" className="btn btn-primary" data-testid="create-task-open" onClick={() => setCreateOpen(true)}>
            {t("taskCreate")}
          </button>
        </div>
      ) : (
        <p className="page-meta">{t("taskCapabilityNote")}</p>
      )}

      <div className="role-segmented" role="tablist" aria-label={t("tasksTitle")}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`role-segmented-option${activeTab === tab.id ? " is-selected" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
            <span className="nav-badge" aria-hidden="true">{tab.count}</span>
          </button>
        ))}
      </div>

      <div className="filter-toolbar">
        {activeTab !== "timesheet" ? (
          <>
            <label className="field">
              <span className="field-label">{t("status")}</span>
              <select
                className="select"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="ALL">{locale === "ar" ? "كل الحالات" : "All statuses"}</option>
                {(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as TaskStatus[]).map((status) => (
                  <option key={status} value={status}>{t(status === "OPEN" ? "stOpen" : status === "IN_PROGRESS" ? "stInProgress" : status === "DONE" ? "stDone" : "stCancelled")}</option>
                ))}
              </select>
            </label>
          </>
        ) : null}
      </div>

      {activeTab === "timesheet" ? (
        <TaskTimesheetSection entries={timeEntries} />
      ) : visibleTasks(activeTab).length === 0 ? (
        <EmptyState
          message={activeTab === "needs" ? t("taskEmptyRouted") : activeTab === "mine" ? t("taskEmptyMine") : t("taskEmptyCreated")}
          action={activeTab === "created" && myCapability.can_create_tasks ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>{t("taskCreate")}</button>
          ) : undefined}
        />
      ) : (
        <OperationalTable
          caption={`${activeLabel(activeTab)} · ${t("tasksTableCaption").replace("%s", String(visibleTasks(activeTab).length))}`}
          columns={columnsFor(activeTab)}
          records={visibleTasks(activeTab)}
        />
      )}

      {createOpen ? (
        <CreateTaskDialog
          capability={myCapability}
          employees={employeeOptions}
          managers={managerOptions}
          onClose={(created) => {
            setCreateOpen(false);
            if (created) {
              setRecent({ task: created, routed: !created.assignee && Boolean(created.routed_to_manager) });
              if (created.routed_to_manager === myId) setActiveTab("needs");
              else setActiveTab("created");
            }
          }}
          onCreate={createTask}
        />
      ) : null}
      {assignTarget ? (
        <AssignTaskDialog
          task={assignTarget}
          employees={[...employeeOptions, ...managerOptions]}
          canAssign={isAssignCapable}
          onClose={(assigned) => {
            setAssignTarget(null);
            if (assigned) setRecent({ task: assigned, routed: false });
          }}
          onAssign={assignTask}
        />
      ) : null}
    </div>
  );
}
