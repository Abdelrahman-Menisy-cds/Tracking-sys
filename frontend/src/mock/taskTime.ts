/**
 * The task timer's pure logic (brief H1) — kept OUT of AppContext on purpose:
 * the gate script imports exactly these functions and asserts the real math,
 * so the browser proof and the deterministic gate exercise the same code.
 *
 * The elapsed time is always DERIVED from timestamps (wall clock), never
 * accumulated from ticks: a throttled background tab or a reload must not
 * lose or drift the time. Nothing here touches the DOM or React.
 */
import type { TaskMutationCode } from "./tasks";

/** One logged work interval. Fields stay top-level — the later timesheet
 *  view must filter by task, by employee and by date range without joins. */
export interface TaskTimeEntry {
  id: string;
  task_id: string;
  employee_id: string;
  started_at: string;
  ended_at: string;
  /** Derived from the two timestamps at save time; seconds precision. */
  seconds: number;
  /** Derived: Math.round(seconds / 60) — kept for the later timesheet's
   *  "minutes" column and any filter that thinks in whole minutes. */
  minutes: number;
}

/** Is there a timer running for this employee right now? (started, not ended) */
export function runningEntryFor(entries: TaskTimeEntry[], employeeId: string): TaskTimeEntry | null {
  const running = entries.filter((entry) => entry.employee_id === employeeId && !entry.ended_at);
  return running.length > 0 ? running[running.length - 1] : null;
}

/** Live elapsed seconds for a running entry, straight off the wall clock. */
export function elapsedSeconds(entry: Pick<TaskTimeEntry, "started_at">, now: number): number {
  const started = Date.parse(entry.started_at);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((now - started) / 1000));
}

/** h:mm:ss — hours unpadded, the rest two digits, per the brief's shape. */
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const two = (value: number): string => String(value).padStart(2, "0");
  return `${hours}:${two(minutes)}:${two(seconds)}`;
}

/** The task's accumulated total — its own ENDED intervals, in seconds. */
export function totalSecondsFor(entries: TaskTimeEntry[], taskId: string, employeeId?: string): number {
  return entries
    .filter((entry) => entry.task_id === taskId && entry.ended_at && (employeeId ? entry.employee_id === employeeId : true))
    .reduce((sum, entry) => sum + entry.seconds, 0);
}

/** The same total in whole minutes, for filters and the later timesheet. */
export function totalMinutesFor(entries: TaskTimeEntry[], taskId: string, employeeId?: string): number {
  return Math.round(totalSecondsFor(entries, taskId, employeeId) / 60);
}

/**
 * Close a running interval. The return carries either the finished entry (with
 * derived minutes — a zero-length or crossing-midnight interval is just a
 * number, nothing special-cased) or a refusal code from the existing contract.
 */
export function stopRunningEntry(
  entries: TaskTimeEntry[],
  employeeId: string,
  now: number,
): { ok: true; entry: TaskTimeEntry; remaining: TaskTimeEntry[] } | { ok: false; code: TaskMutationCode } {
  const running = runningEntryFor(entries, employeeId);
  if (!running) return { ok: false, code: "INVALID_INPUT" };
  const ended = new Date(now).toISOString();
  const seconds = Math.max(0, Math.round((now - Date.parse(running.started_at)) / 1000));
  const closed: TaskTimeEntry = { ...running, ended_at: ended, seconds, minutes: Math.round(seconds / 60) };
  return {
    ok: true,
    entry: closed,
    remaining: entries.map((entry) => (entry.id === running.id ? closed : entry)),
  };
}

/**
 * Start a timer. One running timer per employee: if one is already running it
 * is closed FIRST and returned alongside, so the caller can say so in the UI
 * instead of silently double-counting the day.
 */
export function startTimerEntry(
  entries: TaskTimeEntry[],
  input: { taskId: string; employeeId: string; now: number },
): { ok: true; started: TaskTimeEntry; closedFirst: TaskTimeEntry | null; entries: TaskTimeEntry[] } | { ok: false; code: TaskMutationCode } {
  const closedFirst = runningEntryFor(entries, input.employeeId);
  const started: TaskTimeEntry = {
    id: `task-time-${input.now}`,
    task_id: input.taskId,
    employee_id: input.employeeId,
    started_at: new Date(input.now).toISOString(),
    ended_at: "",
    seconds: 0,
    minutes: 0,
  };
  const next = [
    ...(closedFirst
      ? entries.map((entry) => {
          if (entry.id !== closedFirst.id) return entry;
          const seconds = Math.max(0, Math.round((input.now - Date.parse(entry.started_at)) / 1000));
          return { ...entry, ended_at: new Date(input.now).toISOString(), seconds, minutes: Math.round(seconds / 60) };
        })
      : entries),
    started,
  ];
  return {
    ok: true,
    started,
    closedFirst: closedFirst ? next.find((entry) => entry.id === closedFirst.id) ?? null : null,
    entries: next,
  };
}

/* ---------------- sessionStorage mirror (same shape as AppContext's other overlays) ---------------- */

export const TASK_TIME_SESSION_KEY = "tracking-sys.task-time";

export function readTaskTimeEntries(): TaskTimeEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(TASK_TIME_SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // A hand-edited or stale row must not crash the page: keep only well-shaped
    // entries, silently drop the rest.
    return parsed.filter((value): value is TaskTimeEntry =>
      Boolean(value) && typeof value === "object"
      && typeof (value as TaskTimeEntry).id === "string"
      && typeof (value as TaskTimeEntry).task_id === "string"
      && typeof (value as TaskTimeEntry).employee_id === "string"
      && typeof (value as TaskTimeEntry).started_at === "string"
      && typeof (value as TaskTimeEntry).minutes === "number")
      .map((entry) => ({
        ...entry,
        // Rows written before `seconds` existed keep their minutes; new rows carry both.
        seconds: typeof entry.seconds === "number" ? entry.seconds : Math.round((entry.minutes ?? 0) * 60),
      }) as TaskTimeEntry);
  } catch {
    return [];
  }
}

export function storeTaskTimeEntries(entries: TaskTimeEntry[]): void {
  try {
    window.sessionStorage.setItem(TASK_TIME_SESSION_KEY, JSON.stringify(entries));
  } catch {
    // The session keeps working; only the reload path loses the entries.
  }
}
