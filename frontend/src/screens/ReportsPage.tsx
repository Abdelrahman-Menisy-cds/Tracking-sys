import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useServerData } from "../app/useServerData";
import { ApiError } from "../app/api";
import { formatDate, formatDateTime, formatMinutes, weekInterval } from "../app/format";
import { listDepartments, listEmployees, type ServerDepartment, type ServerEmployee } from "../app/orgApi";
import {
  downloadReportCsv,
  EMPTY_REPORT_FILTERS,
  fetchReportRows,
  fetchReportTotals,
  isAttendanceTotals,
  isPeopleTotals,
  REPORT_CATEGORIES,
  type ReportCategory,
  type ReportFilters,
  type ReportMeta,
  type ReportRow,
  type ReportTotals,
} from "../app/reportsApi";
import type { RequestStatusType, TimesheetStatusType } from "../app/serverTypes";
import type { Dict } from "../i18n/dict";
import {
  Banner,
  EmptyState,
  ErrorState,
  RequestStatusPill,
  SkeletonRows,
  StatusPill,
  TimesheetStatusPill,
} from "../components/ui";
import OperationalTable, { type OperationalColumn } from "../components/data/OperationalTable";
import PageHeader from "../components/layout/PageHeader";

/**
 * H35 - ONE reports screen for manager AND HR.
 *
 * The route is open to both roles; the DATA differs because the server scopes
 * it (a manager's rows are their department/reports, HR's are their company).
 * This screen never filters by role: it renders what the server answers,
 * including the honest denied state when the caller is neither (a 403 from
 * the report endpoints is the server's own word).
 *
 * Every category renders the same shape: filters (from/to, department,
 * employee, status where a vocabulary exists) → a totals strip from
 * /totals or /dashboard → a CSS-only chart → a table of /rows → a CSV
 * download of the SAME rows. An empty window renders "لا توجد بيانات في هذه
 * الفترة" - never fabricated rows.
 *
 * Dropdown sources: /departments and /employees are HR-only endpoints. When
 * they answer, they feed the pickers; when they refuse (a manager), the
 * employee picker falls back to the ids+names ALREADY present in the
 * server-scoped report rows - still real server data, still inside scope.
 * The department picker simply does not render without server options.
 */

const REQUEST_STATUSES: RequestStatusType[] = [
  "DRAFT",
  "PENDING_MANAGER",
  "PENDING_HR",
  "APPROVED",
  "REJECTED",
  "RETURNED",
  "CANCELLED",
];
const TIMESHEET_STATUSES: TimesheetStatusType[] = ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED", "REJECTED"];
const ATTENDANCE_STATUSES = ["PRESENT", "INCOMPLETE"] as const;

const REQUEST_STATUS_SET = new Set<string>(REQUEST_STATUSES);
const TIMESHEET_STATUS_SET = new Set<string>(TIMESHEET_STATUSES);

const STATUS_DICT_KEY: Record<string, keyof Dict> = {
  DRAFT: "stDraft",
  PENDING_MANAGER: "stPendingManager",
  PENDING_HR: "stPendingHr",
  APPROVED: "stApproved",
  REJECTED: "stRejected",
  RETURNED: "stReturned",
  CANCELLED: "stCancelled",
  SUBMITTED: "stSubmitted",
};

type RowsResult = { denied: true } | { denied: false; data: ReportRow[]; meta: ReportMeta };
type TotalsResult = { denied: true } | { denied: false; data: ReportTotals; meta: ReportMeta };
type CsvState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "done"; filename: string }
  | { phase: "error"; message: string };

function statusLabelForVocabulary(status: string, t: (key: keyof Dict) => string): string {
  const key = STATUS_DICT_KEY[status];
  if (key) return t(key);
  if (status === "PRESENT") return t("reportStatusPresent");
  if (status === "INCOMPLETE") return t("reportStatusIncomplete");
  return status;
}

/** True when the effective window covers exactly one calendar month - the
 *  month-closing shape the attendance totals are documented to serve. */
function isMonthWindow(from: string | null, to: string | null): boolean {
  if (!from || !to) return false;
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  if (start.getUTCFullYear() !== end.getUTCFullYear() || start.getUTCMonth() !== end.getUTCMonth()) return false;
  if (start.getUTCDate() !== 1) return false;
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  return end.getUTCDate() === lastDay;
}

const CHART_TOP = 20;

export default function ReportsPage() {
  const { t, locale } = useApp();
  const [tab, setTab] = useState<ReportCategory>("requests");
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_REPORT_FILTERS);
  const [csvState, setCsvState] = useState<CsvState>({ phase: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);

  /** One stable key per filter state, so server data refetches only on real changes. */
  const filtersKey = JSON.stringify(filters);

  usePageTitle(t("navReports"));

  useEffect(() => {
    // The status vocabulary is per category; a value picked on one tab must
    // never leak into another tab's request (the server would 422 it).
    setCsvState({ phase: "idle" });
    setFilters((current) => (current.status === "" ? current : { ...current, status: "" }));
  }, [tab]);

  const rowsState = useServerData<RowsResult>(
    async () => {
      try {
        const payload = await fetchReportRows(tab, filters, locale);
        return { denied: false as const, data: payload.data, meta: payload.meta };
      } catch (error) {
        // The server answers 403 for a caller that is neither manager nor HR.
        // That is not a network failure - it is the honest answer this screen
        // renders, with no invented rows around it.
        if (error instanceof ApiError && error.kind === "forbidden") return { denied: true as const };
        throw error;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, tab, filtersKey],
  );
  const totalsState = useServerData<TotalsResult>(
    async () => {
      try {
        // timesheets /dashboard carries the minute aggregates on top of the counts.
        const kind = tab === "requests" || tab === "timesheets" ? "dashboard" : "totals";
        const payload = await fetchReportTotals(tab, filters, locale, kind);
        return { denied: false as const, data: payload.data, meta: payload.meta };
      } catch (error) {
        if (error instanceof ApiError && error.kind === "forbidden") return { denied: true as const };
        throw error;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, tab, filtersKey],
  );

  const departmentsState = useServerData<ServerDepartment[] | null>(
    // HR-only endpoint; a manager gets a refusal -> null -> the picker hides.
    () => listDepartments(locale).catch(() => null),
    [locale],
  );
  const employeesState = useServerData<ServerEmployee[] | null>(
    () => listEmployees(locale).catch(() => null),
    [locale],
  );

  const employeeOptions = useMemo<{ value: string; label: string }[]>(() => {
    // Cascading: the employee list answers to the department filter. Picking a
    // department and then being offered people from other departments is the
    // inconsistent state this prevents.
    const department = filters.department;
    if (employeesState.phase === "ready" && employeesState.data) {
      return employeesState.data
        .filter((employee) => !department || String(employee.department_id) === department)
        .map((employee) => ({
          value: String(employee.id),
          label: employee.full_name || employee.email,
        }));
    }
    // Fallback: the people already visible in the server-scoped rows.
    const seen = new Map<string, string>();
    if (rowsState.phase === "ready" && !rowsState.data.denied) {
      for (const row of rowsState.data.data) {
        if ("employee_id" in row) seen.set(row.employee_id, row.employee_name);
        else if ("requester_id" in row) seen.set(row.requester_id, row.requester_name);
      }
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label: label || value }));
  }, [employeesState, rowsState, filters.department]);

  // A dependent filter cannot keep a value its parent excludes: narrowing the
  // department to HR must drop an employee picked from another department, or
  // the query would ask for a contradiction and answer with nothing.
  useEffect(() => {
    if (!filters.department || !filters.employee) return;
    if (employeesState.phase !== "ready" || !employeesState.data) return;
    const stillInScope = employeesState.data.some(
      (employee) =>
        String(employee.id) === filters.employee &&
        String(employee.department_id) === filters.department,
    );
    if (!stillInScope) setFilters((current) => ({ ...current, employee: "" }));
  }, [filters.department, filters.employee, employeesState]);

  // from/to are one range, not two independent fields. An end before the start
  // is an empty range that looks like a bug; clamp it to a single day instead.
  // ISO dates compare lexically, so this needs no parsing.
  useEffect(() => {
    if (filters.from && filters.to && filters.from > filters.to) {
      setFilters((current) => ({ ...current, to: current.from }));
    }
  }, [filters.from, filters.to]);

  const departmentOptions = useMemo<{ value: string; label: string }[]>(() => {
    if (departmentsState.phase !== "ready" || !departmentsState.data) return [];
    return departmentsState.data.map((department) => ({
      value: String(department.id),
      label: (locale === "ar" ? department.name_ar || department.name_en : department.name_en || department.name_ar) || department.code,
    }));
  }, [departmentsState, locale]);

  const rowsResult = rowsState.phase === "ready" && !rowsState.data.denied ? rowsState.data : null;
  const totalsResult = totalsState.phase === "ready" && !totalsState.data.denied ? totalsState.data : null;
  const denied = rowsState.phase === "ready" && rowsState.data.denied;
  const anyLoading = rowsState.phase === "loading" || totalsState.phase === "loading";
  const anyError = rowsState.phase === "error" || totalsState.phase === "error";

  const selectTab = (next: ReportCategory) => {
    setTab(next);
    window.setTimeout(() => headingRef.current?.focus(), 0);
  };

  const exportCsv = async () => {
    setCsvState({ phase: "busy" });
    try {
      const filename = await downloadReportCsv(tab, filters, locale);
      setCsvState({ phase: "done", filename });
    } catch (error) {
      setCsvState({
        phase: "error",
        message: error instanceof ApiError && error.message ? error.message : t("reportCsvError"),
      });
    }
  };

  const categoryLabel = (category: ReportCategory) =>
    category === "requests"
      ? t("reportCategoryRequests")
      : category === "timesheets"
        ? t("reportCategoryTimesheets")
        : category === "attendance"
          ? t("reportCategoryAttendance")
          : t("reportCategoryPeople");

  return (
    <div className="page">
      <PageHeader title={t("navReports")} subtitle={t("reportsSubtitle")} />
      <h2 className="visually-hidden" ref={headingRef} tabIndex={-1} data-reports-heading>
        {t("navReports")}
      </h2>
      <div className="work-surface review-queue">
        <div
          className="review-tabs"
          role="tablist"
          aria-label={t("navReports")}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const forward = locale === "ar" ? "ArrowLeft" : "ArrowRight";
            const index = REPORT_CATEGORIES.indexOf(tab);
            const nextIndex = event.key === forward
              ? (index + 1) % REPORT_CATEGORIES.length
              : (index + REPORT_CATEGORIES.length - 1) % REPORT_CATEGORIES.length;
            selectTab(REPORT_CATEGORIES[nextIndex]);
            (event.currentTarget.querySelector(`[data-tab="${REPORT_CATEGORIES[nextIndex]}"]`) as HTMLElement | null)?.focus();
          }}
        >
          {REPORT_CATEGORIES.map((category) => (
            <button
              key={category}
              role="tab"
              data-tab={category}
              id={`tab-reports-${category}`}
              aria-selected={tab === category}
              aria-controls="panel-reports"
              tabIndex={tab === category ? 0 : -1}
              className="review-tab"
              onClick={() => selectTab(category)}
            >
              {categoryLabel(category)}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="panel-reports" aria-labelledby={`tab-reports-${tab}`}>
          {denied ? (
            <>
              <Banner tone="warning" role="alert">{t("reportDenied")}</Banner>
              <EmptyState message={t("reportDeniedScope")} />
            </>
          ) : (
            <>
              <FilterPanel
                filters={filters}
                onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
                onReset={() => setFilters(EMPTY_REPORT_FILTERS)}
                departmentOptions={departmentOptions}
                employeeOptions={employeeOptions}
                vocabulary={statusVocabulary(tab)}
              />
              {csvState.phase === "done" ? (
                <Banner tone="success">
                  {locale === "ar"
                    ? <>تم تنزيل ملف التصدير: <bdi dir="ltr">{csvState.filename}</bdi></>
                    : <>Export downloaded: <bdi dir="ltr">{csvState.filename}</bdi></>}
                </Banner>
              ) : null}
              {csvState.phase === "error" ? <Banner tone="error" role="alert">{csvState.message}</Banner> : null}
              {totalsResult ? <PeriodScopeLine meta={totalsResult.meta} /> : null}
              {tab === "attendance" && totalsResult && isMonthWindow(totalsResult.meta.date_from, totalsResult.meta.date_to) ? (
                <Banner tone="info">{t("reportMonthClosing")}</Banner>
              ) : null}
              {totalsResult ? <TotalsStrip totals={totalsResult.data} locale={locale} /> : null}
              {anyError ? (
                <ErrorState
                  onRetry={() => {
                    if (rowsState.phase === "error") rowsState.retry();
                    else if (totalsState.phase === "error") totalsState.retry();
                  }}
                />
              ) : null}
              {anyLoading ? <SkeletonRows rows={3} /> : null}
              {rowsResult?.meta.truncated ? <Banner tone="warning">{t("reportTruncated")}</Banner> : null}
              {rowsResult ? (
                <CategoryPanel
                  category={tab}
                  rows={rowsResult.data}
                  totals={totalsResult ? totalsResult.data : null}
                  onExport={exportCsv}
                  csvBusy={csvState.phase === "busy"}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function statusVocabulary(category: ReportCategory): readonly string[] {
  if (category === "requests") return REQUEST_STATUSES;
  if (category === "timesheets") return TIMESHEET_STATUSES;
  if (category === "attendance") return ATTENDANCE_STATUSES;
  return [];
}

function PeriodScopeLine({ meta }: { meta: ReportMeta }) {
  const { t, locale } = useApp();
  return (
    <p className="muted report-meta-line">
      {t("reportPeriodLabel")}:{" "}
      <bdi dir="ltr">
        {meta.date_from ? formatDate(meta.date_from, locale) : t("reportPeriodAll")}
        {" → "}
        {meta.date_to ? formatDate(meta.date_to, locale) : t("reportPeriodAll")}
      </bdi>
      {" · "}
      {t("reportScopeLabel")}: <bdi dir="ltr">{meta.scope}</bdi>
      {" · "}
      {t("reportOrgTimezone")}: <bdi dir="ltr">{meta.org_timezone}</bdi>
    </p>
  );
}

function FilterPanel({
  filters,
  onChange,
  onReset,
  departmentOptions,
  employeeOptions,
  vocabulary,
}: {
  filters: ReportFilters;
  onChange: (patch: Partial<ReportFilters>) => void;
  onReset: () => void;
  departmentOptions: { value: string; label: string }[];
  employeeOptions: { value: string; label: string }[];
  vocabulary: readonly string[];
}) {
  const { t, locale } = useApp();
  return (
    <div className="filter-panel">
      <div className="filter-panel-heading">
        <h2>{t("reportFiltersHeading")}</h2>
        <button className="btn btn-secondary" onClick={onReset}>{t("reportFilterReset")}</button>
      </div>
      <div className="filter-toolbar">
        <label className="field" htmlFor="report-filter-from">
          <span className="field-label">{t("reportFilterFrom")}</span>
          <input
            id="report-filter-from"
            className="input"
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => onChange({ from: event.target.value })}
          />
        </label>
        <label className="field" htmlFor="report-filter-to">
          <span className="field-label">{t("reportFilterTo")}</span>
          <input
            id="report-filter-to"
            className="input"
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => onChange({ to: event.target.value })}
          />
        </label>
        {departmentOptions.length ? (
          <label className="field" htmlFor="report-filter-department">
            <span className="field-label">{t("reportFilterDepartment")}</span>
            {/* ds-allow-native-select: dynamic-option picker; listbox rewrite is deferred */}
            <select
              id="report-filter-department"
              className="select"
              value={filters.department}
              onChange={(event) => onChange({ department: event.target.value })}
            >
              <option value="">{t("reportFilterAll")}</option>
              {departmentOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        {employeeOptions.length ? (
          <label className="field" htmlFor="report-filter-employee">
            <span className="field-label">{t("reportFilterEmployee")}</span>
            {/* ds-allow-native-select: dynamic-option picker; listbox rewrite is deferred */}
            <select
              id="report-filter-employee"
              className="select"
              value={filters.employee}
              onChange={(event) => onChange({ employee: event.target.value })}
            >
              <option value="">{t("reportFilterAll")}</option>
              {employeeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        {vocabulary.length ? (
          <label className="field" htmlFor="report-filter-status">
            <span className="field-label">{t("reportFilterStatus")}</span>
            {/* ds-allow-native-select: dynamic-option picker; listbox rewrite is deferred */}
            <select
              id="report-filter-status"
              className="select"
              value={filters.status}
              onChange={(event) => onChange({ status: event.target.value })}
            >
              <option value="">{t("reportFilterAll")}</option>
              {vocabulary.map((status) => (
                <option key={status} value={status}>{statusLabelForVocabulary(status, t)}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <p className="muted">{locale === "ar"
        ? "الفلاتر تُرسل إلى الخادم كما هي؛ مُعرّف قسم أو موظف خارج نطاقك يفرّغ النتائج ولا يُخطئ."
        : "Filters go to the server as-is; a department or employee id outside your scope narrows to nothing instead of erroring."}</p>
    </div>
  );
}

function SummaryStrip({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="summary-strip section">
      {items.map((item) => (
        <div className="summary-item" key={item.label}>
          <span className="summary-label">{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function TotalsStrip({ totals, locale }: { totals: ReportTotals; locale: "ar" | "en" }) {
  const { t } = useApp();
  const items: { label: string; value: string }[] = [{ label: t("reportTotalsTotal"), value: String(totals.total) }];
  if (isPeopleTotals(totals)) {
    items.push(
      { label: t("reportPeopleDepartments"), value: String(totals.departments) },
      { label: t("reportPeopleManagers"), value: String(totals.managers) },
    );
    return <SummaryStrip items={items} />;
  }
  for (const [status, count] of Object.entries(totals.counts_by_status)) {
    items.push({ label: statusLabelForVocabulary(status, t), value: String(count) });
  }
  if (isAttendanceTotals(totals)) {
    const worked = totals.per_employee.reduce((sum, row) => sum + row.total_worked_minutes, 0);
    const breaks = totals.per_employee.reduce((sum, row) => sum + row.total_unpaid_break_minutes, 0);
    items.push(
      { label: t("reportWorkedLabel"), value: formatMinutes(worked, locale) },
      { label: t("breakTime"), value: formatMinutes(breaks, locale) },
    );
  } else if (typeof totals.total_worked_minutes === "number") {
    items.push(
      { label: t("totalHours"), value: formatMinutes(totals.total_worked_minutes, locale) },
      { label: t("breakTime"), value: formatMinutes(totals.total_unpaid_break_minutes ?? 0, locale) },
    );
  }
  return <SummaryStrip items={items} />;
}

/** CSS-only horizontal bars - no chart dependency, values always printed. */
function ChartSection({ category, totals, rows }: { category: ReportCategory; totals: ReportTotals | null; rows: ReportRow[] }) {
  const { t } = useApp();
  let bars: { label: string; value: number }[] = [];
  let stacked: { label: string; present: number; incomplete: number }[] | null = null;
  let capped = false;
  if (category === "attendance" && totals && isAttendanceTotals(totals)) {
    const sorted = [...totals.per_employee].sort(
      (left, right) => right.present_days + right.incomplete_days - (left.present_days + left.incomplete_days),
    );
    capped = sorted.length > CHART_TOP;
    stacked = sorted.slice(0, CHART_TOP).map((row) => ({
      label: row.employee_name || row.employee_email,
      present: row.present_days,
      incomplete: row.incomplete_days,
    }));
  } else if (category === "people") {
    bars = rows
      .filter((row): row is Extract<ReportRow, { headcount: number }> => "headcount" in row)
      .map((row) => ({ label: row.department_name || t("reportPeopleUnassigned"), value: row.headcount }));
  } else if (totals && !isPeopleTotals(totals)) {
    bars = Object.entries(totals.counts_by_status).map(([status, count]) => ({
      label: statusLabelForVocabulary(status, t),
      value: count,
    }));
  }
  if (!bars.length && !stacked) return null;
  const maxValue = Math.max(
    1,
    ...bars.map((bar) => bar.value),
    ...(stacked ?? []).map((row) => row.present + row.incomplete),
  );
  return (
    <section className="section" aria-labelledby="reports-chart-heading">
      <div className="section-heading">
        <h2 id="reports-chart-heading">{t("reportChartHeading")}</h2>
      </div>
      {capped ? <p className="muted">{t("reportChartTop")}</p> : null}
      <ul className="report-chart">
        {bars.map((bar) => (
          <li key={bar.label}>
            <span className="report-chart-label">{bar.label}</span>
            <span className="report-chart-track" aria-hidden="true">
              <span className="report-chart-bar" style={{ inlineSize: `${(bar.value / maxValue) * 100}%` }} />
            </span>
            <span className="report-chart-value"><bdi dir="ltr">{bar.value}</bdi></span>
          </li>
        ))}
        {(stacked ?? []).map((row) => (
          <li key={row.label}>
            <span className="report-chart-label"><bdi>{row.label}</bdi></span>
            <span className="report-chart-track" aria-hidden="true">
              <span className="report-chart-bar report-chart-bar-success" style={{ inlineSize: `${(row.present / maxValue) * 100}%` }} />
              <span className="report-chart-bar report-chart-bar-warning" style={{ inlineSize: `${(row.incomplete / maxValue) * 100}%` }} />
            </span>
            <span className="report-chart-value"><bdi dir="ltr">{row.present + row.incomplete}</bdi></span>
          </li>
        ))}
      </ul>
      {stacked ? (
        <p className="report-legend">
          <span><span className="report-chart-bar report-chart-bar-success" aria-hidden="true" /> {t("reportStatusPresent")}</span>
          <span><span className="report-chart-bar report-chart-bar-warning" aria-hidden="true" /> {t("reportStatusIncomplete")}</span>
        </p>
      ) : null}
    </section>
  );
}

function CategoryPanel({
  category,
  rows,
  totals,
  onExport,
  csvBusy,
}: {
  category: ReportCategory;
  rows: ReportRow[];
  totals: ReportTotals | null;
  onExport: () => void;
  csvBusy: boolean;
}) {
  const { t, locale } = useApp();
  if (rows.length === 0) {
    return <EmptyState message={t("reportEmptyPeriod")} />;
  }
  return (
    <>
      <ChartSection category={category} totals={totals} rows={rows} />
      <section className="section" aria-labelledby="reports-table-heading">
        <div className="section-heading">
          <h2 id="reports-table-heading">{t("reportTableHeading")}</h2>
          <div className="row-actions">
            <button className="btn btn-secondary" disabled={csvBusy} onClick={onExport}>
              {csvBusy ? t("reportCsvBusy") : t("reportCsvButton")}
            </button>
          </div>
        </div>
        {category === "requests" ? <RequestsTable rows={rows as Extract<ReportRow, { requester_id: string }>[]} locale={locale} /> : null}
        {category === "timesheets" ? <TimesheetsTable rows={rows as Extract<ReportRow, { week_start: string }>[]} locale={locale} /> : null}
        {category === "attendance" ? <AttendanceTable rows={rows as Extract<ReportRow, { work_date: string }>[]} locale={locale} /> : null}
        {category === "people" ? <PeopleTable rows={rows as Extract<ReportRow, { headcount: number }>[]} locale={locale} /> : null}
      </section>
    </>
  );
}

function RequestsTable({ rows, locale }: { rows: Extract<ReportRow, { requester_id: string }>[]; locale: "ar" | "en" }) {
  const { t } = useApp();
  const columns: OperationalColumn<Extract<ReportRow, { requester_id: string }>>[] = [
    {
      key: "title",
      label: t("requestTitle"),
      render: (row) => (
        <div>
          <Link to={`/reviews/requests/${row.id}`}><bdi>{row.title}</bdi></Link>
          <div className="muted"><bdi>{row.request_type}</bdi></div>
        </div>
      ),
    },
    { key: "employee", label: t("employee"), render: (row) => <bdi>{row.requester_name}</bdi> },
    {
      key: "status",
      label: t("status"),
      render: (row) =>
        REQUEST_STATUS_SET.has(row.status)
          ? <RequestStatusPill status={row.status as RequestStatusType} />
          : <span>{row.status}</span>,
    },
    {
      key: "submitted",
      label: t("submittedAt"),
      render: (row) => (row.submitted_at ? formatDateTime(row.submitted_at, locale) : <span className="muted">-</span>),
    },
  ];
  return (
    <OperationalTable
      caption={locale === "ar" ? `طلبات ضمن نطاقك على الخادم: ${rows.length}` : `Requests within your server scope: ${rows.length}`}
      columns={columns}
      records={rows}
    />
  );
}

function TimesheetsTable({ rows, locale }: { rows: Extract<ReportRow, { week_start: string }>[]; locale: "ar" | "en" }) {
  const { t } = useApp();
  const columns: OperationalColumn<Extract<ReportRow, { week_start: string }>>[] = [
    {
      key: "week",
      label: t("week"),
      render: (row) => <Link to={`/reviews/timesheets/${row.id}`}>{weekInterval(row.week_start, locale)}</Link>,
    },
    { key: "employee", label: t("employee"), render: (row) => <bdi>{row.employee_name}</bdi> },
    {
      key: "status",
      label: t("status"),
      render: (row) =>
        TIMESHEET_STATUS_SET.has(row.status)
          ? <TimesheetStatusPill status={row.status as TimesheetStatusType} />
          : <span>{row.status}</span>,
    },
    {
      key: "updated",
      label: locale === "ar" ? "آخر تحديث" : "Last update",
      render: (row) => formatDateTime(row.updated_at, locale),
    },
  ];
  return (
    <OperationalTable
      caption={locale === "ar" ? `سجلات وقت ضمن نطاقك على الخادم: ${rows.length}` : `Timesheets within your server scope: ${rows.length}`}
      columns={columns}
      records={rows}
    />
  );
}

function AttendanceTable({ rows, locale }: { rows: Extract<ReportRow, { work_date: string }>[]; locale: "ar" | "en" }) {
  const { t } = useApp();
  const columns: OperationalColumn<Extract<ReportRow, { work_date: string }>>[] = [
    {
      key: "date",
      label: locale === "ar" ? "يوم العمل" : "Work day",
      render: (row) => formatDate(row.work_date, locale),
    },
    { key: "employee", label: t("employee"), render: (row) => <bdi>{row.employee_name}</bdi> },
    {
      key: "status",
      label: t("status"),
      render: (row) =>
        row.status === "PRESENT"
          ? <StatusPill tone="success" label={t("reportStatusPresent")} icon="approved" />
          : <StatusPill tone="warning" label={t("reportStatusIncomplete")} icon="draft" />,
    },
    { key: "worked", label: t("totalHours"), render: (row) => formatMinutes(row.duration_minutes, locale) },
    { key: "breaks", label: t("breakTime"), render: (row) => formatMinutes(row.unpaid_break_minutes, locale) },
    {
      key: "sheet",
      label: locale === "ar" ? "حالة السجل" : "Sheet status",
      render: (row) => <span className="muted">{statusLabelForVocabulary(row.timesheet_status, t)}</span>,
    },
  ];
  return (
    <OperationalTable
      caption={locale === "ar" ? `أيام مسجّلة ضمن النطاق: ${rows.length}` : `Recorded days within scope: ${rows.length}`}
      columns={columns}
      records={rows}
    />
  );
}

function PeopleTable({ rows, locale }: { rows: Extract<ReportRow, { headcount: number }>[]; locale: "ar" | "en" }) {
  const { t } = useApp();
  const columns: OperationalColumn<Extract<ReportRow, { headcount: number }>>[] = [
    {
      key: "department",
      label: t("reportFilterDepartment"),
      render: (row) =>
        row.department_id ? (
          <div>
            <bdi>{row.department_name}</bdi>
            {row.department_code ? <div className="muted"><bdi dir="ltr">{row.department_code}</bdi></div> : null}
          </div>
        ) : (
          <span className="muted">{t("reportPeopleUnassigned")}</span>
        ),
    },
    {
      key: "manager",
      label: locale === "ar" ? "المدير" : "Manager",
      render: (row) => (row.manager_name ? <bdi>{row.manager_name}</bdi> : <span className="muted">-</span>),
    },
    { key: "headcount", label: t("reportPeopleHeadcount"), render: (row) => <bdi dir="ltr">{row.headcount}</bdi> },
  ];
  return (
    <OperationalTable
      caption={locale === "ar" ? `الأقسام ضمن نطاقك على الخادم: ${rows.length}` : `Departments within your server scope: ${rows.length}`}
      columns={columns}
      records={rows}
    />
  );
}
