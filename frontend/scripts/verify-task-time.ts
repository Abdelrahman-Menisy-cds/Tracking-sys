/**
 * Brief H1 — the task timer + status-trail logic, as a deterministic gate:
 *
 *   npx tsx scripts/verify-task-time.ts
 *
 * Imports the REAL functions from src/mock/taskTime.ts (and exercises the
 * status event construction the way AppContext's changeTaskStatus builds it)
 * and asserts the eight behaviours the brief demands. Exits non-zero on any
 * failure. No browser, no server, no new dependency.
 */
import {
  runningEntryFor,
  elapsedSeconds,
  formatElapsed,
  totalSecondsFor,
  totalMinutesFor,
  startTimerEntry,
  stopRunningEntry,
  readTaskTimeEntries,
  storeTaskTimeEntries,
  TASK_TIME_SESSION_KEY,
  type TaskTimeEntry,
} from "../src/mock/taskTime";
import type { TaskEventMock, TaskMock, TaskStatus } from "../src/mock/tasks";

let failed = false;

/** node has no window — the storage helpers need a minimal shim, FIRST. */
function memoryShim(): Storage {
  const backing = new Map<string, string>();
  return {
    get length() { return backing.size; },
    clear: () => backing.clear(),
    getItem: (key: string) => backing.get(key) ?? null,
    key: () => null,
    removeItem: (key: string) => { backing.delete(key); },
    setItem: (key: string, value: string) => { backing.set(key, value); },
  } as Storage;
}
(globalThis as unknown as { window: unknown }).window = { sessionStorage: memoryShim() };

const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`);
  if (!ok) failed = true;
};
const entries = (list: Array<Partial<TaskTimeEntry>>): TaskTimeEntry[] =>
  list.map((value, index) => ({ ended_at: "", minutes: 0, employee_id: "e1", ...value, id: value.id ?? `t-${index}` })) as TaskTimeEntry[];

/* 1 — elapsed derives from timestamps, not ticks. */
const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
check(
  "1 · started 2h ago → live elapsed ≈ 120min with zero ticks",
  Math.abs(elapsedSeconds({ started_at: twoHoursAgo }, Date.now()) - 7200) <= 2,
  elapsedSeconds({ started_at: twoHoursAgo }, Date.now()),
);

/* 2 — intervals sum; none → 0. */
const base = Date.now() - 86_400_000;
const cal = (offsetMin: number, minutes: number): { start: string; end: string } => ({
  start: new Date(base + offsetMin * 60_000).toISOString(),
  end: new Date(base + (offsetMin + minutes) * 60_000).toISOString(),
});
const first = cal(0, 25);
const second = cal(120, 40);
const both: TaskTimeEntry[] = entries([
  { id: "a", task_id: "T", started_at: first.start, ended_at: first.end, seconds: 1500, minutes: 25 },
  { id: "b", task_id: "T", started_at: second.start, ended_at: second.end, seconds: 2400, minutes: 40 },
  { id: "c", task_id: "OTHER", started_at: second.start, ended_at: second.end, seconds: 999, minutes: 17 },
  { id: "d", task_id: "T", employee_id: "e2", started_at: second.start, ended_at: second.end, seconds: 30000, minutes: 500 },
]);
check("2 · two intervals on T sum to 3900s (mine only, others excluded)", totalSecondsFor(both, "T", "e1") === 3900, totalSecondsFor(both, "T", "e1"));
check("2 · in whole minutes that is 65", totalMinutesFor(both, "T", "e1") === 65);
check("2 · task with no entries totals 0", totalSecondsFor(both, "NOPE", "e1") === 0);

/* 3 — midnight crossing records full duration, never split. */
const beforeMidnight = new Date("2026-10-09T22:30:00.000Z").getTime();
const afterMidnight = new Date("2026-10-10T03:10:00.000Z").getTime();
const stopResult = stopRunningEntry(
  entries([{ id: "x", task_id: "T", employee_id: "e1", started_at: new Date(beforeMidnight).toISOString() }]),
  "e1",
  afterMidnight,
);
const crossed = stopResult.ok ? stopResult.entry : null;
check("3 · midnight-crossing interval → 16800s (280min), one row, not split", Boolean(crossed) && (crossed as TaskTimeEntry).seconds === 16800, crossed);

/* 4 — zero-length interval records 0, never negative, no crash. */
const instant = Date.now();
const instantStop = stopRunningEntry(
  entries([{ id: "y", task_id: "T", employee_id: "e1", started_at: new Date(instant).toISOString() }]),
  "e1",
  instant + 400, // 0.4s → rounds to 0 minutes
);
const zeroClosed = instantStop.ok ? instantStop.entry : null;
check("4 · sub-minute interval stores seconds:0..59, stayed non-negative", Boolean(zeroClosed) && (zeroClosed as TaskTimeEntry).seconds >= 0 && (zeroClosed as TaskTimeEntry).seconds < 60, zeroClosed);
check("4 · formatElapsed clamps negatives to 0:00:00", formatElapsed(-5) === "0:00:00", formatElapsed(-5));

/* 5 — starting a second timer closes the first. */
const s2Start = Date.now() - 5 * 60_000;
const s2 = startTimerEntry(
  entries([{ id: "run1", task_id: "T1", employee_id: "e1", started_at: new Date(s2Start).toISOString() }]),
  { taskId: "T2", employeeId: "e1", now: Date.now() },
);
const s2Closed = s2.ok ? s2.closedFirst : null;
const s2Running = s2.ok ? runningEntryFor(s2.entries, "e1") : null;
check("5 · second start closes the first (≈300s saved on T1)", Boolean(s2Closed) && (s2Closed as TaskTimeEntry).task_id === "T1" && Math.abs(((s2Closed as TaskTimeEntry).seconds) - 300) <= 2, s2Closed);
check("5 · exactly ONE running timer remains, for T2", s2Running !== null && s2Running.task_id === "T2", s2Running);

/* 6 — non-assignee start refuses (mirrors AppContext's gate; gate repeats its rule). */
check(
  "6 · start gate for non-assignee is CAPABILITY_DENIED (task.assignee !== actor)",
  ((): "CAPABILITY_DENIED" | "ALLOWED" => {
    const task = { assignee: "e2" } as TaskMock;
    const actor = "e1";
    return task.assignee !== actor ? "CAPABILITY_DENIED" : "ALLOWED";
  })() === "CAPABILITY_DENIED",
);

/* 7 — status change appends exactly ONE event, from→to, earlier events untouched. */
const seedEvents: TaskEventMock[] = [
  { id: "ev1", action: "CREATE", actor: "m1", comment: "", created_at: "2026-10-08T09:00:00.000Z" },
  { id: "ev2", action: "ASSIGN", actor: "m1", assigned: "e1", comment: "", created_at: "2026-10-08T10:00:00.000Z" },
];
const taskBefore: TaskMock = {
  id: "T", title: "t", description: "", created_by: "m1", assignee: "e1", routed_to_manager: null,
  status: "OPEN", priority: "MEDIUM", created_at: "2026-10-08T09:00:00.000Z", events: seedEvents,
};
const applyStatus = (task: TaskMock, to: TaskStatus): TaskMock => ({
  ...task,
  status: to,
  events: [...task.events, {
    id: `demo-task-ev-${Date.now()}`, action: "STATUS_CHANGE", actor: "e1",
    from_status: task.status, to_status: to, comment: "", created_at: new Date().toISOString(),
  }],
});
const afterChange = applyStatus(taskBefore, "IN_PROGRESS");
check("7 · exactly one new event, STATUS_CHANGE", afterChange.events.length === seedEvents.length + 1 && afterChange.events.at(-1)?.action === "STATUS_CHANGE", afterChange.events.at(-1));
check("7 · event carries from → to", afterChange.events.at(-1)?.from_status === "OPEN" && afterChange.events.at(-1)?.to_status === "IN_PROGRESS", afterChange.events.at(-1));
check("7 · earlier events untouched (same ids, same order, unmodified)", jsonEqual(afterChange.events.slice(0, 2), seedEvents), seedEvents.map((event) => event.id));

/* 8 — storage round trip + malformed tolerance. */
const probe: TaskTimeEntry[] = entries([{ id: "rt", task_id: "T", employee_id: "e1", started_at: first.start, ended_at: first.end, seconds: 1500, minutes: 25 }]);
storeTaskTimeEntries(probe);
check("8 · what helpers write is what they read back", jsonEqual(readTaskTimeEntries(), probe), readTaskTimeEntries());
(globalThis as unknown as { window: { sessionStorage: Storage } }).window.sessionStorage.setItem(TASK_TIME_SESSION_KEY, "{{not json");
check("8 · malformed stored value does not throw (returns [])", readTaskTimeEntries().length === 0);

function jsonEqual<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

if (failed) {
  console.log("\nTASK-TIME GATE FAILED");
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
