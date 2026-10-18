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
