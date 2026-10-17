/**
 * H39 - the organization work schedules API (HR only, company-scoped).
 *
 * One schedule travels WITH its weekday set: the settings card edits one work
 * week as a single form, so create sends the whole day set in ONE request and
 * the server applies schedule + days atomically (brief H39 phase 1).
 *
 *   GET    /work-schedules        the company's schedules (the active row flagged)
 *   POST   /work-schedules        create with days (422 keeps the envelope's fields)
 *   PATCH  /work-schedules/<id>   edit (unused here - add/edit day set edits are not in the brief)
 *   DELETE /work-schedules/<id>   soft deactivate (unused here for the same reason)
 *
 * `weekday` is 0=Sunday … 6=Saturday - the JS getDay() order the SPA holds,
 * pinned by the backend, so the form's row order is sent straight through.
 */
import { apiRequest, ApiError } from "./api";

/** One weekday row as Django serialises it ("09:00:00.000000" times or null). */
export interface ServerWorkScheduleDay {
  weekday: number;
  is_working_day: boolean;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
}

/** GET/POST body row - the server normalises rest days' leftovers away. */
export interface WorkScheduleDayWrite {
  weekday: number;
  is_working_day: boolean;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
}

export interface ServerWorkSchedule {
  id: number;
  name: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  days: ServerWorkScheduleDay[];
  created_at: string;
  updated_at: string;
}

/** The journal day rows exactly as the create request needs them. */
export interface WorkScheduleWritePayload {
  name: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  days: WorkScheduleDayWrite[];
}

/** What the form holds per weekday row ("09:00" strings, minutes as text). */
export interface ScheduleDayDraft {
  working: boolean;
  from: string;
  to: string;
  breakMinutes: string;
}

/** The form's whole draft: three scalars plus the fixed 7-row week. */
export interface WorkScheduleDraft {
  name: string;
  effectiveFrom: string;
  effectiveTo: string;
  isActive: boolean;
  days: ScheduleDayDraft[];
}

export const WEEKDAY_COUNT = 7;

/** The initial draft: Egypt's standard week pinned by the org timezone (Africa/Cairo) - Sunday..Thursday 09:00-17:00 with a 60-minute break, Friday+Saturday rest. The operator edits every value from here. */
export function emptyScheduleDraft(): WorkScheduleDraft {
  const days = Array.from({ length: WEEKDAY_COUNT }, (_, weekday) => ({
    working: weekday <= 4,
    from: "09:00",
    to: "17:00",
    breakMinutes: "60",
  }));
  for (let weekday = 5; weekday < WEEKDAY_COUNT; weekday++) {
    days[weekday].working = false;
    days[weekday].from = "";
    days[weekday].to = "";
    days[weekday].breakMinutes = "0";
  }
  return { name: "", effectiveFrom: "", effectiveTo: "", isActive: true, days };
}

/** "09:00:00.000000" (or "09:00") -> "09:00"; null when the server sent none. */
export function clockText(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  return match ? `${String(Number(match[1])).padStart(2, "0")}:${match[2]}` : null;
}

/** The draft as the wire payload: rest days ship no times, every row present. */
export function payloadFromDraft(draft: WorkScheduleDraft): WorkScheduleWritePayload {
  return {
    name: draft.name.trim(),
    effective_from: draft.effectiveFrom,
    effective_to: draft.effectiveTo ? draft.effectiveTo : null,
    is_active: draft.isActive,
    days: draft.days.map((row, weekday) => ({
      weekday,
      is_working_day: row.working,
      start_time: row.working ? row.from || null : null,
      end_time: row.working ? row.to || null : null,
      break_minutes: row.working ? Math.max(0, Number(row.breakMinutes) || 0) : 0,
    })),
  };
}

/**
 * The server's per-field refusals, flattened for the form.
 *
 * The envelope's `fields` is scalar-mostly ({name: [..], effective_to: [..]) but
 * day-level refusals arrive as an INDEXED object (probed live, H39 phase 1:
 * {"days": {"0": {"end_time": ["end_time must be after start_time."]}}}), and the
 * weekday-duplicate refusal is a plain sentence under `days`. The record keeps
 * whatever the server sent - the screen maps every piece next to its field.
 */
export interface WorkScheduleIssues {
  /** Scalar-field messages keyed by the server's field name. */
  scalar: Record<string, string[]>;
  /** Per-day-position messages, keyed by the day INDEX (not the weekday). */
  day: Record<number, Record<string, string[]>>;
  /** Sentence-level `days` refusals (duplicates, a missing day set). */
  daysGeneral: string[];
}

export function scheduleFieldIssues(error: unknown): WorkScheduleIssues | null {
  if (!(error instanceof ApiError) || !error.fields) return null;
  const scalar: Record<string, string[]> = {};
  const day: Record<number, Record<string, string[]>> = {};
  const daysGeneral: string[] = [];
  const collect = (value: unknown): string[] =>
    typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  for (const [key, raw] of Object.entries(error.fields as Record<string, unknown>)) {
    if (key === "days") {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        // Indexed per-day shape, position = the day INDEX: "0": {"end_time": [...]}
        // or a bare sentence under a position.
        for (const [index, item] of Object.entries(raw as Record<string, unknown>)) {
          const position = Number(index);
          if (!Number.isInteger(position)) continue;
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const perField: Record<string, string[]> = {};
            for (const [field, value] of Object.entries(item as Record<string, unknown>)) {
              const messages = collect(value);
              if (messages.length) perField[field] = messages;
            }
            if (Object.keys(perField).length) day[position] = perField;
          } else {
            daysGeneral.push(...collect(item));
          }
        }
      } else {
        // List/sentence shape: ["This field is required.", "Each weekday may …"]
        daysGeneral.push(...collect(raw));
      }
    } else {
      const messages = collect(raw);
      if (messages.length) scalar[key] = messages;
    }
  }
  return { scalar, day, daysGeneral };
}

/** GET /work-schedules - the company's rows; an older tenant answers an empty list. */
export function fetchWorkSchedules(locale: string): Promise<ServerWorkSchedule[]> {
  return apiRequest<{ data: ServerWorkSchedule[] }>("/work-schedules", { acceptLanguage: locale })
    .then((payload) => payload.data ?? []);
}

/** POST /work-schedules - create with the whole week. Refusals keep `fields` for the form. */
export function createWorkSchedule(payload: WorkScheduleWritePayload, locale: string): Promise<ServerWorkSchedule> {
  return apiRequest<{ data: ServerWorkSchedule }>("/work-schedules", {
    method: "POST",
    body: payload,
    acceptLanguage: locale,
    // A create is one transaction, not the LLM refresh that needs the 600s
    // budget; a hung write must not hold the dialog open for ten minutes.
    timeoutMs: 20000,
  }).then((payload) => payload.data);
}
