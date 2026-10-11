import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../../app/AppContext";
import { EmptyState } from "../ui";
import OperationalTable, { type OperationalColumn } from "../data/OperationalTable";
import { formatElapsed } from "../../mock/taskTime";
import { customWindow, thisMonthWindow, thisWeekWindow, todayWindow } from "../../mock/taskTimeWindows";
import { timesheetRows, timesheetTotalSeconds, type TimesheetRow } from "../../mock/taskTimesheet";
import type { TaskTimeEntry } from "../../mock/taskTime";

type PeriodFilter = "today" | "week" | "month" | "custom";

/**
 * Brief H2 — the «تايم شيت» tab: ONLY tasks with logged time, filtered by
 * task name / period / (for a manager) employee, with the total the owner
 * reads first. Every window comes from the pure module `taskTimeWindows` —
 * no date arithmetic is inlined here. Stated rule the owner may disagree
 * with: an interval crossing midnight counts in full under the day it STARTED.
 */
export default function TaskTimesheetSection({ entries }: { entries: TaskTimeEntry[] }) {
  const { t, locale, role, employeeDirectory, tasks } = useApp();
  const isManager = role === "manager" || role === "hr";

  const [nameFilter, setNameFilter] = useState("");
  const [period, setPeriod] = useState<PeriodFilter>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customApplied, setCustomApplied] = useState(false);
  const [employeeFilter, setEmployeeFilter] = useState("ALL");

  const taskTitle = (taskId: string): string | undefined => tasks.find((task) => task.id === taskId)?.title;

  /**
   * Which employees this viewer may see. An employee is scoped to themselves
   * and gets no filter at all; ONLY an entry's own employee_id is trusted.
   */
  const scopeEmployeeId = isManager ? (employeeFilter === "ALL" ? undefined : employeeFilter) : undefined;
  const employeeChoices = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; name: string }[] = [];
    for (const entry of entries) {
      if (!entry.ended_at || seen.has(entry.employee_id)) continue;
      seen.add(entry.employee_id);
      list.push({ id: entry.employee_id, name: employeeDirectory.find((who) => who.id === entry.employee_id)?.name.ar ?? entry.employee_id });
    }
    return list;
  }, [entries, employeeDirectory]);

  const window = useMemo<ReturnType<typeof thisWeekWindow> | null>(() => {
    const now = Date.now();
    if (period === "today") return todayWindow(now);
    if (period === "week") return thisWeekWindow(now);
    if (period === "month") return thisMonthWindow(now);
    if (period === "custom" && customApplied && customFrom && customTo) {
      return customWindow(Date.parse(`${customFrom}T00:00:00`), Date.parse(`${customTo}T00:00:00`));
    }
    return null; // custom picked but not applied yet → show the filtered-empty state
  }, [period, customApplied, customFrom, customTo]);

  const rowsBeforeName = useMemo(
    () => (window ? timesheetRows(entries, window, taskTitle, scopeEmployeeId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, window, scopeEmployeeId, tasks],
  );
  const rows = useMemo(
    () => rowsBeforeName.filter((row) => {
      const query = nameFilter.trim().toLowerCase();
      if (!query) return true;
      const title = taskTitle(row.task_id) ?? "";
      return title.toLowerCase().includes(query);
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowsBeforeName, nameFilter, tasks],
  );
  const totalSeconds = timesheetTotalSeconds(rows);

  const hasAnyLogged = entries.some((entry) => entry.ended_at && taskTitle(entry.task_id) !== undefined);

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
            const who = entries.find((entry) => entry.task_id === row.task_id && entry.ended_at)?.employee_id;
            return <bdi>{employeeDirectory.find((entry) => entry.id === who)?.name.ar ?? who}</bdi>;
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
            // Days coming from entry.started_at; format them as local dates.
            const [y, m, d] = day.split("-").map(Number);
            const shown = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(y, m - 1, d));
            return <bdi key={day} dir={locale === "ar" ? "rtl" : "ltr"}>{shown}</bdi>;
          })}
        </span>
      ),
    },
  ];

  return (
    <section aria-label={t("taskTabTimesheet")} data-testid="timesheet-section">
      <p className="page-meta">{t("taskTimesheetMidnightRule")}</p>

      <div className="filter-toolbar">
        <label className="field">
          <span className="field-label">{t("taskTimesheetFilterTaskName")}</span>
          <input
            className="input"
            type="search"
            data-testid="timesheet-name-filter"
            value={nameFilter}
            onChange={(event) => setNameFilter(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("taskTimesheetFilterPeriod")}</span>
          <select
            className="select"
            data-testid="timesheet-period-filter"
            value={period}
            onChange={(event) => {
              setPeriod(event.target.value as PeriodFilter);
              if (event.target.value !== "custom") setCustomApplied(false);
            }}
          >
            <option value="today">{t("taskTimesheetPeriodToday")}</option>
            <option value="week">{t("taskTimesheetPeriodWeek")}</option>
            <option value="month">{t("taskTimesheetPeriodMonth")}</option>
            <option value="custom">{t("taskTimesheetPeriodCustom")}</option>
          </select>
        </label>
        {isManager ? (
          <label className="field">
            <span className="field-label">{t("taskTimesheetFilterEmployee")}</span>
            <select
              className="select"
              data-testid="timesheet-employee-filter"
              value={employeeFilter}
              onChange={(event) => setEmployeeFilter(event.target.value)}
            >
              <option value="ALL">{employeeChoices.length > 1 ? (locale === "ar" ? "كل الموظفين" : "All employees") : employeeChoices[0]?.name ?? "—"}</option>
              {employeeChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        {period === "custom" ? (
          <div className="field">
            <span className="field-label">{t("taskTimesheetFromLabel")} / {t("taskTimesheetToLabel")}</span>
            <div className="custom-range" data-testid="timesheet-custom-range">
              <input
                className="input"
                type="date"
                data-testid="timesheet-custom-from"
                value={customFrom}
                onChange={(event) => { setCustomFrom(event.target.value); setCustomApplied(false); }}
              />
              <input
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
      </div>

      {window && rows.length > 0 ? (
        <div data-testid="timesheet-total">
          <strong>{t("taskTimesheetTotalLabel")}: </strong>
          <bdi dir="ltr">{formatElapsed(totalSeconds)}</bdi>
        </div>
      ) : null}

      {rows.length === 0 ? (
        hasAnyLogged
          ? <EmptyState message={t("taskTimesheetEmptyFiltered")} />
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
