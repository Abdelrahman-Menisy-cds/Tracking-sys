import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../../app/AppContext";
import { formatDate } from "../../app/useMockList";
import { EmptyState } from "../ui";
import OperationalTable, { type OperationalColumn } from "../data/OperationalTable";
import { formatElapsed } from "../../mock/taskTime";
import { timesheetTotalSeconds, type TimesheetRow } from "../../mock/taskTimesheet";
import type { TaskTimeEntry } from "../../mock/taskTime";
import { entryInWindow, type ClockWindow } from "../../mock/taskTimeWindows";
import TaskFilterToolbar, { type TaskFilterChip } from "./TaskFilterToolbar";

type PeriodFilter = "all" | "today" | "week" | "month" | "custom";
type Setter<T> = Dispatch<SetStateAction<T>>;
type Props = {
  entries: TaskTimeEntry[]; rows: TimesheetRow[]; window: ClockWindow | null; allCount: number;
  search: string; setSearch: Setter<string>;
  period: PeriodFilter; setPeriod: Setter<PeriodFilter>;
  employeeFilter: string; setEmployeeFilter: Setter<string>;
  employeeChoices: { id: string; name: string }[];
  customFrom: string; setCustomFrom: Setter<string>;
  customTo: string; setCustomTo: Setter<string>;
  customApplied: boolean; setCustomApplied: Setter<boolean>;
  chips: TaskFilterChip[]; clearAll: () => void;
};

/**
 * Brief H2 — the «تايم شيت» tab: ONLY tasks with logged time, filtered by
 * task name / period / (for a manager) employee, with the total the owner
 * reads first. Every window comes from the pure module `taskTimeWindows` —
 * no date arithmetic is inlined here. Stated rule the owner may disagree
 * with: an interval crossing midnight counts in full under the day it STARTED.
 */
export default function TaskTimesheetSection({ entries, rows, window, allCount, search, setSearch, period, setPeriod, employeeFilter, setEmployeeFilter, employeeChoices, customFrom, setCustomFrom, customTo, setCustomTo, setCustomApplied, chips, clearAll }: Props) {
  const { t, locale, role, employeeDirectory, tasks } = useApp();
  const isManager = role === "manager" || role === "hr";

  const taskTitle = (taskId: string): string | undefined => tasks.find((task) => task.id === taskId)?.title;

  const totalSeconds = timesheetTotalSeconds(rows);

  const hasAnyLogged = allCount > 0;

  const columns: OperationalColumn<TimesheetRow>[] = [
    {
      key: "task",
      label: t("taskTimesheetTaskLabel"),
      render: (row) => (
        <Link to={`/tasks/${row.task_id}`}>
          <bdi>{taskTitle(row.task_id)}</bdi>
        </Link>
      ),
    },
    ...(isManager
      ? [{
          key: "employee",
          label: t("taskTimesheetEmployeeLabel"),
          render: (row: TimesheetRow) => {
            const ids = [...new Set(entries.filter((entry) => entry.task_id === row.task_id && entry.ended_at && window && entryInWindow(entry, window) && (employeeFilter === "ALL" || entry.employee_id === employeeFilter)).map((entry) => entry.employee_id))];
            return <span>{ids.map((id, index) => <span key={id}>{index > 0 ? (locale === "ar" ? "، " : ", ") : null}<bdi>{employeeDirectory.find((entry) => entry.id === id)?.name[locale] ?? id}</bdi></span>)}</span>;
          },
        } satisfies OperationalColumn<TimesheetRow>]
      : []),
    {
      key: "duration",
      label: t("taskTimesheetDurationLabel"),
      render: (row) => <bdi dir="ltr">{formatElapsed(row.seconds)}</bdi>,
    },
    {
      key: "days",
      label: t("taskTimesheetDaysLabel"),
      render: (row) => (
        <span className="days-list">
          {row.days.map((day) => {
            // Days coming from entry.started_at; format them as local dates
            // through the ONE shared path (brief H3).
            const shown = formatDate(`${day}T12:00:00Z`, locale);
            return <bdi key={day} dir={locale === "ar" ? "rtl" : "ltr"}>{shown}</bdi>;
          })}
        </span>
      ),
    },
  ];

  return (
    <section aria-label={t("taskTabTimesheet")} data-testid="timesheet-section">
      <TaskFilterToolbar chips={chips} shown={rows.length} total={allCount} onClear={clearAll}>
        <div className="field tasks-search-field">
          <label className="field-label" htmlFor="timesheet-name-filter">{t("taskTimesheetFilterTaskName")}</label>
          <div className="tasks-search-control">
            <input
              id="timesheet-name-filter"
              className="input"
              type="search"
              data-testid="timesheet-name-filter"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search ? <button type="button" className="tasks-search-clear" aria-label={t("taskFilterClearSearch")} onClick={() => setSearch("")}>×</button> : null}
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="timesheet-period-filter">{t("taskTimesheetFilterPeriod")}</label>
          <select
            id="timesheet-period-filter"
            className="select"
            data-testid="timesheet-period-filter"
            value={period}
            onChange={(event) => {
              setPeriod(event.target.value as PeriodFilter);
              if (event.target.value !== "custom") setCustomApplied(false);
            }}
          >
            <option value="all">{t("taskTimesheetPeriodAll")}</option>
            <option value="today">{t("taskTimesheetPeriodToday")}</option>
            <option value="week">{t("taskTimesheetPeriodWeek")}</option>
            <option value="month">{t("taskTimesheetPeriodMonth")}</option>
            <option value="custom">{t("taskTimesheetPeriodCustom")}</option>
          </select>
        </div>
        {isManager ? (
          <div className="field">
            <label className="field-label" htmlFor="timesheet-employee-filter">{t("taskTimesheetFilterEmployee")}</label>
            <select
              id="timesheet-employee-filter"
              className="select"
              data-testid="timesheet-employee-filter"
              value={employeeFilter}
              onChange={(event) => setEmployeeFilter(event.target.value)}
            >
              <option value="ALL">{t("taskFilterAllEmployees")}</option>
              {employeeChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.name}</option>
              ))}
            </select>
          </div>
        ) : null}
        {period === "custom" ? (
          <div className="field">
            <span className="field-label">{t("taskTimesheetPeriodCustom")}</span>
            <div className="custom-range" data-testid="timesheet-custom-range">
              <label className="field-label" htmlFor="timesheet-custom-from">{t("taskTimesheetFromLabel")}</label>
              <input
                id="timesheet-custom-from"
                className="input"
                type="date"
                data-testid="timesheet-custom-from"
                value={customFrom}
                onChange={(event) => { setCustomFrom(event.target.value); setCustomApplied(false); }}
              />
              <label className="field-label" htmlFor="timesheet-custom-to">{t("taskTimesheetToLabel")}</label>
              <input
                id="timesheet-custom-to"
                className="input"
                type="date"
                data-testid="timesheet-custom-to"
                value={customTo}
                onChange={(event) => { setCustomTo(event.target.value); setCustomApplied(false); }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="timesheet-custom-apply"
                disabled={!customFrom || !customTo}
                onClick={() => {
                  if (customFrom && customTo && Date.parse(customFrom) <= Date.parse(customTo)) setCustomApplied(true);
                  else setCustomApplied(false);
                }}
              >
                {t("taskTimesheetApplyCustom")}
              </button>
            </div>
          </div>
        ) : null}
      </TaskFilterToolbar>
      <p className="page-meta">{t("taskTimesheetMidnightRule")}</p>

      {rows.length > 0 ? (
        <div data-testid="timesheet-total">
          <strong>{t("taskTimesheetTotalLabel")}: </strong>
          <bdi dir="ltr">{formatElapsed(totalSeconds)}</bdi>
        </div>
      ) : null}

      {rows.length === 0 ? (
        hasAnyLogged
          ? <EmptyState message={t("taskTimesheetEmptyFiltered")} action={<button type="button" className="btn btn-secondary" onClick={clearAll}>{t("taskFiltersClearAll")}</button>} />
          : <EmptyState message={t("taskTimesheetEmptyNothing")} />
      ) : (
        <OperationalTable
          caption={`${t("taskTabTimesheet")} · ${rows.length}`}
          columns={columns}
          records={recordsFrom(rows)}
        />
      )}
    </section>
  );
}

/** OperationalTable wants a stable `id` on each record. */
function recordsFrom(rows: TimesheetRow[]): (TimesheetRow & { id: string })[] {
  return rows.map((row) => ({ ...row, id: row.task_id }));
}
