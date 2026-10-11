import { useMemo, useRef, useState, type KeyboardEvent } from "react";
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
import TaskFilterToolbar, { type TaskFilterChip } from "../components/tasks/TaskFilterToolbar";
import { customWindow, thisMonthWindow, thisWeekWindow, todayWindow } from "../mock/taskTimeWindows";
import { timesheetRows } from "../mock/taskTimesheet";
import type { TaskMock, TaskStatus } from "../mock/tasks";

type TaskTab = "needs" | "mine" | "created" | "timesheet";
type StatusFilter = TaskStatus | "ALL";
type PeriodFilter = "all" | "today" | "week" | "month" | "custom";

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
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<PeriodFilter>("today");
  const [employeeFilter, setEmployeeFilter] = useState("ALL");
  const [taskEmployeeFilter, setTaskEmployeeFilter] = useState("ALL");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customApplied, setCustomApplied] = useState(false);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<TaskMock | null>(null);
  const [recent, setRecent] = useState<{ task: TaskMock; routed: boolean } | null>(null);

  const hasLoggedTime = timeEntries.length > 0;
  const isTeamViewer = role === "manager" || role === "hr";
  const employeeChoices = useMemo(() => {
    const ids = [...new Set(timeEntries.filter((entry) => entry.ended_at).map((entry) => entry.employee_id))];
    return ids.map((id) => ({ id, name: employeeDirectory.find((who) => who.id === id)?.name[locale] ?? id }));
  }, [timeEntries, employeeDirectory, locale]);
  const window = useMemo(() => {
    const now = Date.now();
    if (period === "all") return { fromMs: -Infinity, toMs: Infinity };
    if (period === "today") return todayWindow(now);
    if (period === "week") return thisWeekWindow(now);
    if (period === "month") return thisMonthWindow(now);
    if (customApplied && customFrom && customTo) return customWindow(Date.parse(`${customFrom}T00:00:00`), Date.parse(`${customTo}T00:00:00`));
    return null;
  }, [period, customApplied, customFrom, customTo]);
  const timeTitle = (id: string) => tasks.find((task) => task.id === id)?.title;
  const timeScope = isTeamViewer ? (employeeFilter === "ALL" ? undefined : employeeFilter) : myId;
  const allTimeRows = timesheetRows(timeEntries, { fromMs: -Infinity, toMs: Infinity }, timeTitle, isTeamViewer ? undefined : myId);
  const filteredTimeRows = window ? timesheetRows(timeEntries, window, timeTitle, timeScope)
    .filter((row) => (timeTitle(row.task_id) ?? "").toLowerCase().includes(search.trim().toLowerCase())) : [];
  const matchesTask = (task: TaskMock) => {
    if (statusFilter !== "ALL" && task.status !== statusFilter) return false;
    if (isTeamViewer && taskEmployeeFilter !== "ALL" && task.assignee !== taskEmployeeFilter) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [task.title, findDirectoryEntry(task.created_by)?.name[locale], task.assignee ? findDirectoryEntry(task.assignee)?.name[locale] : ""]
      .some((value) => value?.toLowerCase().includes(query));
  };
  const tabs = useMemo(() => {
    const list: { id: TaskTab; label: string; count: number }[] = [];
    if (isManager) list.push({ id: "needs", label: t("tasksNeedsAssignmentTitle"), count: needsAssignment.filter(matchesTask).length });
    list.push({ id: "mine", label: t("taskListMine"), count: myTasks.filter(matchesTask).length });
    if (myCapability.can_create_tasks) list.push({ id: "created", label: t("taskListCreated"), count: createdTasks.filter(matchesTask).length });
    // Brief H2 — the timesheet tab renders for any identity that can see
    // time: an employee their own logged time, a manager/HR the team's.
    if (hasLoggedTime) list.push({ id: "timesheet", label: t("taskTabTimesheet"), count: filteredTimeRows.length });
    return list;
  // Counts intentionally derive from the same filter predicates as the active list.
  }, [isManager, isTeamViewer, myCapability.can_create_tasks, myTasks, createdTasks, needsAssignment, hasLoggedTime, filteredTimeRows.length, search, statusFilter, taskEmployeeFilter, locale, t]);

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
        render: (task) => formatDateTime(task.created_at, locale),
      });
    }
    return columns;
  };

  const visibleTasks = (section: TaskTab): TaskMock[] => {
    const base = section === "needs" ? needsAssignment : section === "mine" ? myTasks : createdTasks;
    return base.filter(matchesTask);
  };

  const baseTasks = activeTab === "needs" ? needsAssignment : activeTab === "mine" ? myTasks : createdTasks;
  const statusLabel = (status: TaskStatus) => t(status === "OPEN" ? "stOpen" : status === "IN_PROGRESS" ? "stInProgress" : status === "DONE" ? "stDone" : "stCancelled");
  const clearAll = () => {
    setSearch(""); setStatusFilter("ALL"); setPeriod("all"); setEmployeeFilter("ALL"); setTaskEmployeeFilter("ALL");
    setCustomFrom(""); setCustomTo(""); setCustomApplied(false);
  };
  const chips: TaskFilterChip[] = [];
  if (search.trim()) chips.push({ key: "search", label: `${t("taskFilterSearch")}: ${search.trim()}`, onRemove: () => setSearch("") });
  if (activeTab !== "timesheet" && statusFilter !== "ALL") chips.push({ key: "status", label: `${t("status")}: ${statusLabel(statusFilter)}`, onRemove: () => setStatusFilter("ALL") });
  if (activeTab !== "timesheet" && isTeamViewer && taskEmployeeFilter !== "ALL") chips.push({ key: "task-employee", label: `${t("taskTimesheetFilterEmployee")}: ${employeeDirectory.find((entry) => entry.id === taskEmployeeFilter)?.name[locale] ?? taskEmployeeFilter}`, onRemove: () => setTaskEmployeeFilter("ALL") });
  if (activeTab === "timesheet") {
    if (period !== "all") chips.push({ key: "period", label: `${t("taskTimesheetFilterPeriod")}: ${t(period === "today" ? "taskTimesheetPeriodToday" : period === "week" ? "taskTimesheetPeriodWeek" : period === "month" ? "taskTimesheetPeriodMonth" : "taskTimesheetPeriodCustom")}`, onRemove: () => { setPeriod("all"); setCustomFrom(""); setCustomTo(""); setCustomApplied(false); } });
    if (employeeFilter !== "ALL") chips.push({ key: "employee", label: `${t("taskTimesheetFilterEmployee")}: ${employeeChoices.find((choice) => choice.id === employeeFilter)?.name ?? employeeFilter}`, onRemove: () => setEmployeeFilter("ALL") });
  }
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const forward = locale === "ar" ? "ArrowLeft" : "ArrowRight";
    const backward = locale === "ar" ? "ArrowRight" : "ArrowLeft";
    let next = index;
    if (event.key === forward) next = (index + 1) % tabs.length;
    else if (event.key === backward) next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActiveTab(tabs[index].id); return; }
    else return;
    event.preventDefault(); setActiveTab(tabs[next].id); tabRefs.current[tabs[next].id]?.focus();
  };

  const needsAttention = isManager && needsAssignment.length > 0;
  const activeLabel = (id: TaskTab): string => tabs.find((tab) => tab.id === id)?.label ?? t("taskListMine");

  return (
    <div className="page">
      <PageHeader title={t("tasksTitle")} subtitle={t("tasksSubtitle")} primaryAction={myCapability.can_create_tasks ? (
        <button type="button" className="btn btn-primary" data-testid="create-task-open" onClick={() => setCreateOpen(true)}>{t("taskCreate")}</button>
      ) : undefined} />
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

      <div className="role-segmented tasks-tab-strip" role="tablist" aria-label={t("tasksTitle")}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tasks-tab-${tab.id}`}
            aria-controls="tasks-tabpanel"
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            ref={(node) => { tabRefs.current[tab.id] = node; }}
            className={`role-segmented-option${activeTab === tab.id ? " is-selected" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => onTabKeyDown(event, tabs.indexOf(tab))}
          >
            <span>{tab.label}</span>
            <span className="nav-badge" aria-label={t(tab.id === "timesheet" ? "taskFilterEntriesCount" : "taskFilterTasksCount").replace("%s", String(tab.count))}>{tab.count}</span>
          </button>
        ))}
      </div>

      <div id="tasks-tabpanel" role="tabpanel" aria-labelledby={`tasks-tab-${activeTab}`} tabIndex={0}>
      {activeTab === "timesheet" ? (
        <TaskTimesheetSection entries={timeEntries} rows={filteredTimeRows} window={window} allCount={allTimeRows.length} search={search} setSearch={setSearch} period={period} setPeriod={setPeriod} employeeFilter={employeeFilter} setEmployeeFilter={setEmployeeFilter} employeeChoices={employeeChoices} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} customApplied={customApplied} setCustomApplied={setCustomApplied} chips={chips} clearAll={clearAll} />
      ) : <>
        <TaskFilterToolbar chips={chips} shown={visibleTasks(activeTab).length} total={baseTasks.length} onClear={clearAll}>
          <div className="field tasks-search-field">
            <label className="field-label" htmlFor="tasks-search">{t("taskFilterSearch")}</label>
            <div className="tasks-search-control"><input id="tasks-search" className="input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
              {search ? <button type="button" className="tasks-search-clear" aria-label={t("taskFilterClearSearch")} onClick={() => setSearch("")}>×</button> : null}</div>
          </div>
          <div className="field"><label className="field-label" htmlFor="tasks-status-filter">{t("status")}</label>
            <select id="tasks-status-filter" className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="ALL">{t("taskFilterAllStatuses")}</option>
              {(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as TaskStatus[]).map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
            </select>
          </div>
          {isTeamViewer ? <div className="field"><label className="field-label" htmlFor="tasks-employee-filter">{t("taskTimesheetFilterEmployee")}</label>
            <select id="tasks-employee-filter" data-testid="tasks-employee-filter" className="select" value={taskEmployeeFilter} onChange={(event) => setTaskEmployeeFilter(event.target.value)}>
              <option value="ALL">{t("taskFilterAllEmployees")}</option>
              {employeeDirectory.map((entry) => <option key={entry.id} value={entry.id}>{entry.name[locale]}</option>)}
            </select>
          </div> : null}
        </TaskFilterToolbar>
      {visibleTasks(activeTab).length === 0 ? (
        <EmptyState
          message={baseTasks.length > 0 ? t("taskFilterEmpty") : activeTab === "needs" ? t("taskEmptyRouted") : activeTab === "mine" ? t("taskEmptyMine") : t("taskEmptyCreated")}
          action={baseTasks.length > 0 ? <button type="button" className="btn btn-secondary" onClick={clearAll}>{t("taskFiltersClearAll")}</button> : activeTab === "created" && myCapability.can_create_tasks ? (
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
      </>}
      </div>

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
