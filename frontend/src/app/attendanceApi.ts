/**
 * The attendance API. The day is derived on the server from the active work
 * schedule and the recorded events - the client never computes it, so a schedule
 * change or a corrected event is reflected without a second source of truth.
 */
import { apiRequest } from "./api";

export type AttendanceState =
  | "NO_SCHEDULE"
  | "REST_DAY"
  | "ABSENT_CANDIDATE"
  | "PRESENT";

export interface AttendanceWindow {
  start_time: string;
  end_time: string;
  break_minutes: number;
}

export interface AttendanceEvent {
  id: number;
  kind: "CLOCK_IN" | "CLOCK_OUT";
  occurred_at: string;
  note: string;
}

export interface AttendanceDay {
  date: string;
  schedule: { id: number; name: string; window: AttendanceWindow | null } | null;
  state: AttendanceState;
  events: AttendanceEvent[];
  can_clock_in: boolean;
  can_clock_out: boolean;
}

/** GET /attendance/today - the caller's own day. */
export async function fetchAttendanceToday(locale: "ar" | "en"): Promise<AttendanceDay> {
  const payload = await apiRequest<{ data: AttendanceDay }>("/attendance/today", {
    acceptLanguage: locale,
  });
  return payload.data;
}

/** POST /attendance/clock-in | clock-out - record one event. */
export async function recordAttendanceEvent(
  kind: "clock-in" | "clock-out",
  locale: "ar" | "en",
): Promise<AttendanceEvent> {
  const payload = await apiRequest<{ data: AttendanceEvent }>(`/attendance/${kind}`, {
    acceptLanguage: locale,
    method: "POST",
  });
  return payload.data;
}

/**
 * The states a derived history/snapshot day may carry. The server derives
 * them from the active schedule plus that day's events; the client never
 * computes one. ABSENT_CANDIDATE (the today payload's name for a scheduled
 * day with no events) reads as ABSENT here.
 */
export type AttendanceHistoryState =
  | "PRESENT"
  | "ABSENT"
  | "REST_DAY"
  | "INCOMPLETE"
  | "NO_SCHEDULE";

export interface AttendanceHistoryDay {
  date: string;
  first_clock_in: string | null;
  last_clock_out: string | null;
  worked_minutes: number | null;
  /** The schedule's break applied to worked minutes; null when no window. */
  break_minutes: number | null;
  state: AttendanceHistoryState;
}

export interface AttendanceHistoryMeta {
  page: number;
  page_size: number;
  count: number;
  total_pages: number;
}

export interface AttendanceHistoryQuery {
  from?: string;
  to?: string;
  status?: string;
  page?: number;
}

/**
 * GET /attendance/history - the caller's own derived days.
 *
 * The range defaults to the last 30 days on the server when `from`/`to` are
 * omitted, so an empty filter toolbar asks for a real, bounded window rather
 * than guessing one here.
 */
export async function fetchAttendanceHistory(
  query: AttendanceHistoryQuery,
  locale: "ar" | "en",
): Promise<{ rows: AttendanceHistoryDay[]; meta: AttendanceHistoryMeta }> {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.status && query.status !== "ALL") params.set("status", query.status);
  if (query.page) params.set("page", String(query.page));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const payload = await apiRequest<{ data: AttendanceHistoryDay[]; meta: AttendanceHistoryMeta }>(
    `/attendance/history${suffix}`,
    { acceptLanguage: locale },
  );
  return { rows: payload.data, meta: payload.meta };
}

export interface AttendanceSnapshotEmployee extends AttendanceHistoryDay {
  user: { id: number; full_name: string; email: string };
}

export interface AttendanceSnapshot {
  date: string;
  schedule: { id: number; name: string } | null;
  counts: Record<AttendanceHistoryState, number>;
  employees: AttendanceSnapshotEmployee[];
}

/**
 * GET /attendance/snapshot - HR's whole-company day.
 *
 * HR scope only: a non-HR caller gets the shared 404, which the API layer
 * surfaces as `forbidden`, so the panel can render an honest denial.
 */
export async function fetchAttendanceSnapshot(
  date: string | null,
  locale: "ar" | "en",
): Promise<AttendanceSnapshot> {
  const suffix = date ? `?date=${date}` : "";
  const payload = await apiRequest<{ data: AttendanceSnapshot }>(
    `/attendance/snapshot${suffix}`,
    { acceptLanguage: locale },
  );
  return payload.data;
}
