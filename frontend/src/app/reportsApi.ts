/**
 * H35 - the reports API (manager/HR, read-only, server-scoped).
 *
 * One category vocabulary with the backend (review.reports.ALLOWED_CATEGORIES):
 * requests | timesheets | attendance | people. Every endpoint answers
 * {data, meta} where meta carries the SERVER-authoritative scope, org
 * timezone and effective date window - the screen renders meta, it never
 * re-derives scope or defaults locally.
 *
 * Filters (review.reports contract): from/to (ISO dates, inclusive; the
 * attendance report defaults to the current org week when none are given),
 * department/employee (ids; an id outside the caller's scope simply narrows
 * to nothing - that narrowing happens on the server), status (repeatable).
 * The client sends what the operator picked; it adds NO filters of its own
 * and never filters data by role.
 */
import { API_BASE, apiRequest, ApiError } from "./api";

export type ReportCategory = "requests" | "timesheets" | "attendance" | "people";

export const REPORT_CATEGORIES: ReportCategory[] = ["requests", "timesheets", "attendance", "people"];

/** The filter state one screen instance holds; empty string/undefined = unset. */
export type ReportFilters = {
  from: string;
  to: string;
  department: string;
  employee: string;
  status: string;
};

export const EMPTY_REPORT_FILTERS: ReportFilters = { from: "", to: "", department: "", employee: "", status: "" };

/** rows/totals/dashboard/csv answer this meta block (review/report_views.py). */
export interface ReportMeta {
  report: string;
  scope: string;
  org_timezone: string;
  date_from: string | null;
  date_to: string | null;
  filters_applied: Record<string, unknown>;
  row_count: number;
  row_limit: number;
  truncated?: boolean;
  generated_at_utc?: string;
}

/** GET /reports/requests/rows - review.serializers.report_rows_for("requests"). */
export interface ServerReportRequestRow {
  id: string;
  requester_id: string;
  requester_name: string;
  request_type: string;
  title: string;
  status: string;
  version: number;
  submitted_at: string | null;
  created_at: string;
}

/** GET /reports/timesheets/rows. */
export interface ServerReportTimesheetRow {
  id: string;
  employee_id: string;
  employee_name: string;
  week_start: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

/** GET /reports/attendance/rows - one employee-DAY row, derived status. */
export interface ServerReportAttendanceRow {
  id: string;
  employee_id: string;
  employee_name: string;
  work_date: string;
  status: "PRESENT" | "INCOMPLETE";
  duration_minutes: number;
  unpaid_break_minutes: number;
  timesheet_id: string;
  timesheet_status: string;
}

/** GET /reports/people/rows - one department bucket ("unassigned" possible). */
export interface ServerReportPeopleRow {
  id: string;
  department_id: string | null;
  department_code: string;
  department_name: string;
  manager_id: string | null;
  manager_name: string;
  headcount: number;
}

export type ReportRow =
  | ServerReportRequestRow
  | ServerReportTimesheetRow
  | ServerReportAttendanceRow
  | ServerReportPeopleRow;

/** attendance per-employee block - the month closing when the window is a month. */
export interface AttendancePerEmployee {
  employee_id: string;
  employee_name: string;
  employee_email: string;
  present_days: number;
  incomplete_days: number;
  total_worked_minutes: number;
  total_unpaid_break_minutes: number;
}

/** Status-vocabulary totals (requests/timesheets; timesheets /dashboard adds minutes). */
export interface StatusReportTotals {
  total: number;
  counts_by_status: Record<string, number>;
  total_worked_minutes?: number;
  total_unpaid_break_minutes?: number;
}

/** attendance /totals: day counts by derived status + per-employee closing. */
export interface AttendanceReportTotals {
  total: number;
  counts_by_status: Record<string, number>;
  per_employee: AttendancePerEmployee[];
}

/** people /totals: current-state headcounts inside the caller's scope. */
export interface PeopleReportTotals {
  total: number;
  departments: number;
  managers: number;
}

export type ReportTotals = StatusReportTotals | AttendanceReportTotals | PeopleReportTotals;

export function isAttendanceTotals(data: ReportTotals): data is AttendanceReportTotals {
  return Array.isArray((data as AttendanceReportTotals).per_employee);
}

export function isPeopleTotals(data: ReportTotals): data is PeopleReportTotals {
  return (
    typeof (data as PeopleReportTotals).departments === "number" &&
    !("counts_by_status" in data)
  );
}

/** The query string exactly as the backend contract names the params. */
export function reportQueryString(filters: ReportFilters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.department) params.set("department", filters.department);
  if (filters.employee) params.set("employee", filters.employee);
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** GET /reports/{category}/rows - bounded JSON rows (10k cap, meta.truncated). */
export function fetchReportRows(
  category: ReportCategory,
  filters: ReportFilters,
  locale: string,
): Promise<{ data: ReportRow[]; meta: ReportMeta }> {
  return apiRequest<{ data: ReportRow[]; meta: ReportMeta }>(
    `/reports/${category}/rows${reportQueryString(filters)}`,
    { acceptLanguage: locale },
  );
}

/** GET /reports/{category}/totals - or /dashboard for the minute aggregates. */
export function fetchReportTotals(
  category: ReportCategory,
  filters: ReportFilters,
  locale: string,
  kind: "totals" | "dashboard" = "totals",
): Promise<{ data: ReportTotals; meta: ReportMeta }> {
  return apiRequest<{ data: ReportTotals; meta: ReportMeta }>(
    `/reports/${category}/${kind}${reportQueryString(filters)}`,
    { acceptLanguage: locale },
  );
}

function errorFromResponse(status: number, payload: unknown): ApiError {
  const envelope = payload as { error?: { code?: string; message?: string; fields?: Record<string, string[]> } } | null;
  const message = envelope?.error?.message ?? `Request failed (${status}).`;
  const fields = envelope?.error?.fields;
  const code = envelope?.error?.code;
  if (status === 401) return new ApiError("unauthenticated", status, message, fields, code);
  if (status === 403 || status === 404) return new ApiError("forbidden", status, message, fields, code);
  if (status >= 500) return new ApiError("server", status, message, fields, code);
  return new ApiError("invalid", status, message, fields, code);
}

/**
 * GET /reports/{category}/csv - the SAME rows as /rows as a file download.
 *
 * The shared client parses JSON bodies; a download needs the raw bytes, so
 * this call goes through fetch directly (same origin, same session cookie;
 * GET carries no CSRF requirement). Rejections keep the backend's error
 * envelope so the screen can show the server's own line (e.g. the 422
 * row-limit refusal - never a partial file).
 */
export async function downloadReportCsv(
  category: ReportCategory,
  filters: ReportFilters,
  locale: string,
): Promise<string> {
  const response = await fetch(`${API_BASE}/reports/${category}/csv${reportQueryString(filters)}`, {
    credentials: "include",
    headers: { Accept: "text/csv, application/json", "Accept-Language": locale },
  });
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      /* a non-JSON error body is not worth guessing at */
    }
    throw errorFromResponse(response.status, payload);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const named = /filename="([^"]+)"/.exec(disposition);
  const filename = named?.[1] ?? `${category}_report.csv`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}
