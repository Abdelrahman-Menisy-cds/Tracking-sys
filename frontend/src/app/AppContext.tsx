import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Locale, Role } from "../i18n/dict";
import { dict, type Dict } from "../i18n/dict";
import { getIdentity, type ServerIdentity } from "./api";
import {
  demoUser,
  myRequests,
  myTimesheets,
  notifications,
  stateDemoControl,
  teamRequests,
  teamTimesheets,
  createAnnouncementFixture,
  employeeDirectory as employeeDirectoryFixture,
  mergeEmployeeFilePatch,
  visibleEmployeeFile,
  announcements as announcementFixture,
  type AnnouncementMock,
  type AnnouncementChannel,
  type AnnouncementStatus,
  type EmployeeDirectoryEntry,
  type EmployeeFilePatch,
  type NotificationMock,
  type RequestEventMock,
  type RequestMock,
  type RequestStatus,
  type TimeEntryMock,
  type TimesheetMock,
  type TimesheetStatus,
} from "../mock/data";
import {
  attendanceEventsByIdentity,
  directoryEventsByIdentity,
  attendanceSchedules,
  deriveAttendanceDays,
  directoryLeaveBalances,
  fixtureAttendanceDays,
  identityEmployeeId,
  isPublicHoliday,
  leaveBalanceSummary as deriveLeaveBalanceSummary,
  mergeAttendanceDays,
  publicHolidays,
  publicHolidaysInRange,
  resolveScheduleFixture,
  type AttendanceDay,
  type LeaveAdjustment,
  type AttendanceEvent,
  type AttendanceEventKind,
  type AttendanceMutationResult,
  type LeaveBalance,
  type WorkSchedule,
} from "../mock/attendance";
import {
  DEFAULT_TASK_CAPABILITY,
  allDemoTasks,
  taskCapabilitiesById,
  type TaskCapability,
  type TaskEventMock,
  type TaskMock,
  type TaskMutationResult,
  type TaskPriority,
  type TaskStatus,
} from "../mock/tasks";
/* ===== Brief H1 — task time tracking; one contiguous block below the tasks cycle ===== */
import {
  elapsedSeconds as elapsedSecondsOf,
  formatElapsed as formatElapsedOf,
  readTaskTimeEntries,
  runningEntryFor,
  startTimerEntry,
  stopRunningEntry,
  storeTaskTimeEntries,
  totalSecondsFor,
  type TaskTimeEntry,
} from "../mock/taskTime";

export type Appearance = "system" | "light" | "dark";

const LOCALE_STORAGE_KEY = "tracking-sys.locale";
const APPEARANCE_STORAGE_KEY = "tracking-sys.appearance";
/**
 * HR's employee-file edits (piece 1 of the brief) — an in-browser OVERLAY over
 * the read-only directory fixture, keyed by employee id.
 *
 * Storage contract, exactly as the brief draws it: directory data is not a
 * device preference, so `localStorage` is never touched. Edits live in React
 * state, and are MIRRORED to `sessionStorage` only so a mid-session reload
 * keeps showing what HR saved — they still die when the browser session ends,
 * which is what "in-session override" means here and the demo boundary copy
 * says so on the page itself.
 */
const FILE_OVERRIDES_SESSION_KEY = "tracking-sys.file-overrides";

function readFileOverrides(): Record<string, EmployeeFilePatch> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(FILE_OVERRIDES_SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, EmployeeFilePatch>;
  } catch {
    return {};
  }
}

function storeFileOverrides(overrides: Record<string, EmployeeFilePatch>): void {
  try {
    window.sessionStorage.setItem(FILE_OVERRIDES_SESSION_KEY, JSON.stringify(overrides));
  } catch {
    // The override keeps working for this session when storage is unavailable;
    // it just will not survive a reload, which the demo boundary copy states.
  }
}

/**
 * Brief E — the per-employee task capability flags mirror to session storage
 * the same way. The demos advertises "tasks live in session memory" on the
 * page; the flags must not silently contradict that by resetting to fixture
 * values on a reload while the tasks themselves survive, so the overlay
 *outlives it too — same mechanism, same scope, nothing in localStorage.
 */
const TASK_CAPABILITY_SESSION_KEY = "tracking-sys.task-capabilities";

function readTaskCapabilityOverrides(): Record<string, TaskCapability> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(TASK_CAPABILITY_SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, TaskCapability>;
  } catch {
    return {};
  }
}

function storeTaskCapabilityOverrides(overrides: Record<string, TaskCapability>): void {
  try {
    window.sessionStorage.setItem(TASK_CAPABILITY_SESSION_KEY, JSON.stringify(overrides));
  } catch {
    // Same contract as the file overlay: this session keeps the values either way.
  }
}

/**
 * Brief E — the tasks themselves mirror to session storage too. The demo
 * banner already PROMISES «تُحفظ في ذاكرة الجلسة فقط وتُستعاد عند إعادة
 * التحميل» ("kept in session memory, restored on reload"), and the
 * route-to-manager cycle is multi-identity: an employee creates, a manager
 * then signs in to assign. Between those two sign-ins the app reloads The
 * page — without this mirror the promise is false and the routed task never
 * reaches the manager's queue. Same mechanism, same session scope as the
 * flag and file overlays; nothing durable, nothing in localStorage.
 */
const TASKS_SESSION_KEY = "tracking-sys.tasks";

function isTaskLike(value: unknown): value is TaskMock {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && typeof candidate.title === "string"
    && typeof candidate.created_by === "string"
    && Array.isArray(candidate.events);
}

function readSessionTasks(): TaskMock[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(TASKS_SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // A stale or hand-edited entry must never crash the app: keep only rows
    // shaped like a task, and silently ignore the rest.
    return parsed.filter(isTaskLike);
  } catch {
    return [];
  }
}

function storeSessionTasks(tasks: TaskMock[]): void {
  try {
    window.sessionStorage.setItem(TASKS_SESSION_KEY, JSON.stringify(tasks));
  } catch {
    // The session keeps the tasks either way; only the reload path loses them.
  }
}

/**
 * The seed on first load of a session: the fixture tasks PLUS anything the
 * session already created (so a reload in the same tab keeps the report).
 * A new session starts clean from the fixtures, which is the "session
 * memory" contract the banner describes.
 */
function initialSessionTasks(): TaskMock[] {
  const sessionTasks = readSessionTasks();
  const sessionById = new Map(sessionTasks.map((task) => [task.id, task]));
  const fixtureIds = new Set(allDemoTasks.map((task) => task.id));
  // Session copies of fixture tasks OVERRIDE the fixture row: an assignee
  // change made earlier in the session must survive a reload, otherwise a
  // reassignment silently reverts to the seeded assignee.
  const fixtures = cloneFixture(allDemoTasks).map((task) => sessionById.get(task.id) ?? task);
  const extras = sessionTasks.filter((task) => !fixtureIds.has(task.id));
  return [...fixtures, ...extras];
}

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return "ar";
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return value === "ar" || value === "en" ? value : "ar";
  } catch {
    return "ar";
  }
}

function readStoredAppearance(): Appearance {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return value === "system" || value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function storePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences still work for this session when persistent storage is unavailable.
  }
}
export type DemoFixture = "ready" | "loading" | "empty" | "error" | "conflict" | "unknown";
export type ReviewDecision = "APPROVE" | "REJECT" | "RETURN";
export type DemoIdentity = Role;
export type DemoMutationIssue = "conflict" | "unknown" | "missing";

/**
 * This Vite mode is the explicit mock-fixture boundary. It is not an
 * authorization mechanism. A production/API build must replace this provider
 * with server-resolved identity, capabilities, scoped queries and mutations.
 */
export const DEMO_MODE = import.meta.env.MODE === "demo";

/** The server's role string -> the app's role. The server is authoritative. */
function roleFromServer(role: string): DemoIdentity {
  const normalised = role.trim().toLowerCase();
  if (normalised === "hr") return "hr";
  if (normalised === "manager") return "manager";
  return "employee";
}

export interface DemoCapabilities {
  canReview: boolean;
  canClock: boolean;
  canViewTeamAttendance: boolean;
  canResolveExceptions: boolean;
  canApproveCorrections: boolean;
  canSetScheduleForReports: boolean;
  canSetOrgSchedule: boolean;
  canManageLeaveBalance: boolean;
  canViewOrgAttendance: boolean;
  canManageDirectory: boolean;
  canManageHolidays: boolean;
  canSendAnnouncements: boolean;
}

interface AppState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: keyof Dict) => string;
  dir: "rtl" | "ltr";
  /** Fixture identity only; never authentication or authorization. */
  role: DemoIdentity;
  setRole: (role: DemoIdentity) => void;
  /** The server-side account when there is a session; null in the demo build. */
  serverAccount: ServerIdentity | null;
  /** False until the boot-time session probe has answered. Guards must wait on it. */
  sessionChecked: boolean;
  /** Adopt a signed-in session (role + account). Used by the login screen. */
  adoptSession: (identity: ServerIdentity) => void;
  /** Fixture capabilities stand in for a server response only in demo mode. */
  capabilities: DemoCapabilities;
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
  resolvedTheme: "light" | "dark";
  myRequestItems: RequestMock[];
  teamRequestItems: RequestMock[];
  myTimesheetItems: TimesheetMock[];
  teamTimesheetItems: TimesheetMock[];
  notificationItems: NotificationMock[];
  attendanceEvents: AttendanceEvent[];
  attendanceDays: AttendanceDay[];
  leaveBalances: LeaveBalance[];
  schedules: WorkSchedule[];
  /** Full directory with the OVERLAY applied (HR file edits keyed by id). */
  employeeDirectory: EmployeeDirectoryEntry[];
  saveEmployeeFile: (employeeId: string, patch: EmployeeFilePatch) => AttendanceMutationResult<EmployeeDirectoryEntry>;
  /** View-filtered copy of a file (HR-only fields removed for non-HR). */
  visibleEmployeeFile: typeof import("../mock/data").visibleEmployeeFile;
  publicHolidays: typeof import("../mock/attendance").publicHolidays;
  isPublicHoliday: (date: string) => boolean;
  publicHolidaysInRange: (from: string, to: string) => typeof import("../mock/attendance").publicHolidays;
  directoryLeaveBalances: LeaveBalance[];
  announcementItems: AnnouncementMock[];
  sendAnnouncement: (input: { subject: string; body: string; channel: AnnouncementChannel; audience: "ALL" | "SELECTED"; recipientIds: string[] }) => AttendanceMutationResult<AnnouncementMock>;
  settleAnnouncement: (announcementId: string, status: Exclude<AnnouncementStatus, "PENDING">) => AttendanceMutationResult<AnnouncementMock>;
  clockIn: (occurredAt?: string, note?: string) => AttendanceMutationResult<AttendanceEvent>;
  clockOut: (occurredAt?: string, note?: string) => AttendanceMutationResult<AttendanceEvent>;
  submitAttendanceCorrection: (input: { workDate: string; inAt: string; outAt?: string; reason: string }) => AttendanceMutationResult;
  resolveAttendanceException: (workDate: string, status: AttendanceDay["status"], reason: string) => AttendanceMutationResult;
  setWorkSchedule: (schedule: WorkSchedule) => AttendanceMutationResult;
  /**
   * Drop a schedule so the layer beneath it applies again (EMPLOYEE → TEAM →
   * ORGANIZATION). Removal is the only way back: rewriting an exception with the
   * organization's own numbers would leave it an exception — a different id —
   * and the employee would still be marked as overridden.
   */
  removeWorkSchedule: (scheduleId: string) => AttendanceMutationResult;
  /** Adjust ONE employee's balance — the employee the dialog was opened for. */
  adjustLeaveBalance: (employee: string, leaveType: LeaveBalance["leave_type"], days: number, reason: string) => AttendanceMutationResult;
  resolveScheduleFor: (employee: string, date: string) => WorkSchedule | null;
  leaveBalanceSummary: (balance: LeaveBalance) => ReturnType<typeof deriveLeaveBalanceSummary>;
  markNotificationRead: (notificationId: string) => void;
  removeNotification: (notificationId: string) => void;
  clearNotifications: () => void;
  saveDemoRequest: (input: { typeId: number; title: string; details: string; submit: boolean }) => Promise<RequestMock>;
  submitDemoTimesheet: (timesheetId: string, entries: TimeEntryMock[]) => Promise<TimesheetMock>;
  decideDemoRequest: (requestId: string, decision: ReviewDecision, comment: string, expectedVersion: number) => Promise<RequestMock>;
  decideDemoTimesheet: (timesheetId: string, decision: ReviewDecision, comment: string, expectedVersion: number) => Promise<TimesheetMock>;
  /* ===== Brief C — tasks cycle (create / assign / route-to-manager) ===== */
  /** Every task the demo knows; screens scope it by identity. */
  tasks: TaskMock[];
  /** Per-employee task flags (overlays fold in); the single read path. */
  taskCapabilityFor: (employeeId: string) => TaskCapability;
  /** Manager/HR write of the two flags — capability-checked like the rest. */
  setTaskCapabilities: (employeeId: string, flags: Partial<TaskCapability>) => TaskMutationResult;
  createTask: (input: { title: string; description: string; priority: TaskPriority; dueDate: string | null; assignee: string | null; routeTo: string | null }) => TaskMutationResult<TaskMock>;
  /** Set (or clear) the assignee; every change appends to the trail. */
  assignTask: (taskId: string, to: string | null) => TaskMutationResult<TaskMock>;
  /* ===== Brief H1 — status control + per-task work timer ===== */
  /** Append a STATUS_CHANGE trail event; assignee and creator/manager only. */
  changeTaskStatus: (taskId: string, to: TaskStatus) => TaskMutationResult<TaskMock>;
  /** The signed-in employee's work intervals, running one included (ended_at: ""). */
  taskTimeEntries: TaskTimeEntry[];
  /** Start this task's timer for the signed-in employee; closes any running one first. */
  startTaskTimer: (taskId: string) => TaskMutationResult<{ started: TaskTimeEntry; closedFirst: TaskTimeEntry | null }>;
  /** Stop the signed-in employee's running timer and save its minutes. */
  stopTaskTimer: () => TaskMutationResult<TaskTimeEntry>;
  /** Sum of an employee's SAVED intervals on a task (running one excluded). */
  taskTimeTotalSeconds: (taskId: string, employeeId: string) => number;
  /** Live elapsed seconds for an employee's running timer, from the wall clock. */
  taskTimeElapsedSeconds: (employeeId: string, now: number) => number;
  /** The running interval for an employee, if any. */
  taskTimeRunningFor: (employeeId: string) => TaskTimeEntry | null;
  /** h:mm:ss formatting shared by the screen and any later timesheet view. */
  taskTimeFormatElapsed: (totalSeconds: number) => string;
  setDemoFixture: (fixture: DemoFixture) => void;
  isDemoMode: boolean;
}

type IdentityState = {
  myRequestItems: RequestMock[];
  myTimesheetItems: TimesheetMock[];
  teamRequestItems: RequestMock[];
  teamTimesheetItems: TimesheetMock[];
  notificationItems: NotificationMock[];
  attendanceEvents: AttendanceEvent[];
  attendanceDays: AttendanceDay[];
  schedules: WorkSchedule[];
};

const AppContext = createContext<AppState | null>(null);

function systemTheme(): "light" | "dark" {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function demoDelay(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 450));
}

function cloneFixture<T>(value: T): T {
  return structuredClone(value);
}

function initialIdentityState(identity: DemoIdentity): IdentityState {
  const fixtureUser = demoUser[identity];
  const personalRequests = cloneFixture(myRequests).map((request) => ({
    ...request,
    requester_id: `demo-${identity}`,
    requester_name: fixtureUser.name,
  }));
  const personalTimesheets = cloneFixture(myTimesheets).map((sheet) => ({
    ...sheet,
    employee_name: fixtureUser.name,
  }));

  return {
    myRequestItems: personalRequests,
    myTimesheetItems: personalTimesheets,
    teamRequestItems: identity === "employee" ? [] : cloneFixture(teamRequests),
    teamTimesheetItems: identity === "employee" ? [] : cloneFixture(teamTimesheets),
    notificationItems: cloneFixture(notifications),
    attendanceEvents: [...cloneFixture(attendanceEventsByIdentity[identity]), ...cloneFixture(directoryEventsByIdentity[identity])],
    attendanceDays: cloneFixture(fixtureAttendanceDays(identity)),
    schedules: cloneFixture(attendanceSchedules),
  };
}

function initialIdentityStates(): Record<DemoIdentity, IdentityState> {
  return {
    employee: initialIdentityState("employee"),
    manager: initialIdentityState("manager"),
    hr: initialIdentityState("hr"),
  };
}

function mutationIssue(issue: DemoMutationIssue, latestRecord?: RequestMock | TimesheetMock): Error {
  return Object.assign(new Error(`demo-${issue}`), { issue, latestRecord });
}

export function getDemoMutationIssue(error: unknown): DemoMutationIssue | null {
  if (!(error instanceof Error) || !("issue" in error)) return null;
  const issue = (error as Error & { issue?: DemoMutationIssue }).issue;
  return issue === "conflict" || issue === "unknown" || issue === "missing" ? issue : null;
}

function eventFor(
  action: string,
  fromStatus: string | null,
  toStatus: string,
  comment: string,
  actor: string,
): RequestEventMock {
  return {
    id: `demo-event-${Date.now()}`,
    action,
    from_status: fromStatus,
    to_status: toStatus,
    comment,
    created_at: new Date().toISOString(),
    actor,
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);
  const [role, setRoleState] = useState<DemoIdentity>("employee");
  /** The server-side account, when there is a session. Null in the demo build. */
  const [serverAccount, setServerAccount] = useState<ServerIdentity | null>(null);
  /**
   * False until the boot-time session probe has answered, so guards never guess.
   *
   * This used to start `true` in the demo, on the assumption that a demo build has
   * no server to ask. Now that the demo is served BY Django, starting checked let
   * an admin route evaluate its permission against the "employee" default and
   * redirect before the real role arrived. Starting false costs one request; with
   * no server at all that request fails fast and we keep the fixture identity.
   */
  const [sessionChecked, setSessionChecked] = useState(false);
  const [appearance, setAppearanceState] = useState<Appearance>(readStoredAppearance);
  const [osTheme, setOsTheme] = useState<"light" | "dark">(systemTheme);
  const [identityStates, setIdentityStates] = useState<Record<DemoIdentity, IdentityState>>(initialIdentityStates);
  /**
   * Leave adjustments recorded through the admin dialog, keyed `${employee}|${leave_type}`.
   *
   * They cannot live on an identity's state: the dialog adjusts whoever it was
   * opened for, so an HR user fixing e1's balance must not write to hr1's rows —
   * and most directory employees have no identity state to write to at all.
   */
  const [leaveAdjustments, setLeaveAdjustments] = useState<Record<string, LeaveAdjustment[]>>({});
  /**
   * HR's file edits (brief piece 1), keyed by employee id — the sibling of
   * leaveAdjustments above: the fixture cannot be written, so the edit is an
   * overlay applied wherever the directory is read. Mirrored to sessionStorage
   * (see readFileOverrides) so a mid-session reload keeps HR's values; nothing
   * durable, nothing in localStorage.
   */
  const [fileOverrides, setFileOverrides] = useState<Record<string, EmployeeFilePatch>>(readFileOverrides);
  /**
   * Brief C — the demo's tasks and the per-employee capability overlays. Both
   * are plain in-memory state (the demo layer never persists anywhere): tasks
   * mutate only through createTask/assignTask below so the trail stays
   * append-only, and the flags fold into taskCapabilityFor as an overlay the
   * same way fileOverrides folds into the directory.
   */
  const [tasks, setTasks] = useState<TaskMock[]>(initialSessionTasks);
  const [taskCapabilityOverrides, setTaskCapabilityOverrides] =
    useState<Record<string, TaskCapability>>(readTaskCapabilityOverrides);
  /**
   * Brief H1 — the work intervals, session-scoped per the app's overlay
   * pattern (`tracking-sys.task-time`): a running interval keeps only its
   * `started_at` here, so the elapsed display derives from the wall clock and
   * a reload (or a throttled tab) neither loses nor drifts the time. Every
   * entry carries task_id / employee_id / started_at / ended_at / minutes
   * top-level, because the later timesheet view must filter on all three.
   */
  const [taskTimeEntries, setTaskTimeEntries] = useState<TaskTimeEntry[]>(readTaskTimeEntries);
  const [announcementItems, setAnnouncementItems] = useState<AnnouncementMock[]>(() => cloneFixture(announcementFixture));
  const activeIdentityRef = useRef<DemoIdentity>(role);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = (event: MediaQueryListEvent) => setOsTheme(event.matches ? "dark" : "light");
    mediaQuery.addEventListener("change", updateTheme);
    return () => mediaQuery.removeEventListener("change", updateTheme);
  }, []);

  const resolvedTheme = appearance === "system" ? osTheme : appearance;

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = locale === "ar" ? "rtl" : "ltr";
    root.dataset.theme = resolvedTheme;
  }, [locale, resolvedTheme]);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    storePreference(LOCALE_STORAGE_KEY, nextLocale);
  }, []);
  const setAppearance = useCallback((nextAppearance: Appearance) => {
    setAppearanceState(nextAppearance);
    storePreference(APPEARANCE_STORAGE_KEY, nextAppearance);
  }, []);
  /**
   * Adopt a role.
   *
   * This used to be a no-op outside the demo build, which left every non-demo
   * sign-in without a role and bounced the user straight back to /login. The role
   * is legitimate in both modes: in the demo it comes from the picker, otherwise
   * from the server (see the session bootstrap below).
   */
  const setRole = useCallback((nextRole: DemoIdentity) => {
    activeIdentityRef.current = nextRole;
    setRoleState(nextRole);
    if (DEMO_MODE) stateDemoControl.fixture = "ready";
  }, []);

  /**
   * Adopt a signed-in session: the role AND the server account together.
   *
   * The guard reads `serverAccount`, so a sign-in that only set the role would be
   * bounced straight back to /login.
   */
  const adoptSession = useCallback(
    (identity: ServerIdentity) => {
      setServerAccount(identity);
      setSessionChecked(true);
      setRole(roleFromServer(identity.role));
    },
    [setRole],
  );

  // Who are we, according to the server? Without this, a reload drops the session
  // and every server-backed screen has to fall back to fixtures.
  //
  // This used to bail out early in DEMO_MODE, on the assumption that a demo build
  // has no server behind it. That assumption stopped being true when the demo
  // started being served BY Django: a signed-in HR user then reloaded the page,
  // was silently reset to the "employee" default role, and every admin route
  // bounced them back to the home screen — with no error to explain it.
  //
  // Asking the server costs one request and is harmless when there is no server:
  // the catch below leaves the fixture identity untouched.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await getIdentity();
        if (cancelled) return;
        setServerAccount(me);
        setRole(roleFromServer(me.role));
      } catch {
        /* No session, or no server at all. Keep whatever identity we have: in the
           demo that is the fixture role, and RequireSession does not gate there. */
      } finally {
        if (!cancelled) setSessionChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setRole]);

  /**
   * What this role may do.
   *
   * Capability follows the ROLE, in both modes — it used to be ANDed with
   * DEMO_MODE, so outside the demo every capability was false and the admin
   * screens were unreachable even for a signed-in HR account.
   */
  const capabilities = useMemo<DemoCapabilities>(
    () => ({
      canReview: role === "manager" || role === "hr",
      canClock: DEMO_MODE,
      canViewTeamAttendance: role === "manager" || role === "hr",
      canResolveExceptions: role === "manager" || role === "hr",
      canApproveCorrections: role === "manager" || role === "hr",
      canSetScheduleForReports: role === "manager" || role === "hr",
      canSetOrgSchedule: role === "hr",
      canManageLeaveBalance: role === "hr",
      canViewOrgAttendance: role === "hr",
      canManageDirectory: role === "hr",
      canManageHolidays: role === "hr",
      canSendAnnouncements: role === "hr",
    }),
    [role],
  );
  const activeState = identityStates[role];

  const markNotificationRead = useCallback((notificationId: string) => {
    const commandIdentity = role;
    window.setTimeout(() => {
      if (activeIdentityRef.current !== commandIdentity) return;
      setIdentityStates((current) => ({
        ...current,
        [commandIdentity]: {
          ...current[commandIdentity],
          notificationItems: current[commandIdentity].notificationItems.map((notification) =>
            notification.id === notificationId
              ? { ...notification, is_read: true, read_at: new Date().toISOString() }
              : notification,
          ),
        },
      }));
    }, 150);
  }, [role]);

  const clockMutation = useCallback((kind: AttendanceEventKind, occurredAt?: string, note?: string): AttendanceMutationResult<AttendanceEvent> => {
    if (!capabilities.canClock) return { ok: false, code: "CAPABILITY_DENIED" };
    const commandIdentity = role;
    const employee = identityEmployeeId(commandIdentity);
    const timestamp = occurredAt ?? new Date().toISOString();
    const state = identityStates[commandIdentity];
    const ordered = [...state.attendanceEvents].filter((event) => event.employee === employee).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    let open: AttendanceEvent | null = null;
    ordered.forEach((event) => { open = event.kind === "CLOCK_IN" ? event : null; });
    if (kind === "CLOCK_IN" && open) return { ok: false, code: "CLOCK_IN_ALREADY_OPEN" };
    if (kind === "CLOCK_OUT" && !open) return { ok: false, code: "CLOCK_OUT_WITHOUT_OPEN_CLOCK_IN" };
    const event: AttendanceEvent = { id: `demo-att-${Date.now()}`, employee, occurred_at: timestamp, kind, source: "WEB", recorded_by: employee, created_at: new Date().toISOString(), note };
    window.setTimeout(() => {
      if (activeIdentityRef.current !== commandIdentity) return;
      setIdentityStates((current) => {
        const identityState = current[commandIdentity];
        const nextEvents = [...identityState.attendanceEvents, event];
        return { ...current, [commandIdentity]: { ...identityState, attendanceEvents: nextEvents, attendanceDays: mergeAttendanceDays(identityState.attendanceDays, deriveAttendanceDays(nextEvents, employee, identityState.schedules)) } };
      });
    }, 150);
    return { ok: true, value: event };
  }, [capabilities.canClock, identityStates, role]);

  const submitAttendanceCorrection = useCallback((input: { workDate: string; inAt: string; outAt?: string; reason: string }): AttendanceMutationResult => {
    if (!DEMO_MODE || !input.reason.trim()) return { ok: false, code: DEMO_MODE ? "INVALID_INPUT" : "CAPABILITY_DENIED" };
    const commandIdentity = role;
    window.setTimeout(() => {
      if (activeIdentityRef.current !== commandIdentity) return;
      setIdentityStates((current) => {
        const state = current[commandIdentity]; const employee = identityEmployeeId(commandIdentity);
        const additions: AttendanceEvent[] = [{ id: `demo-correction-in-${Date.now()}`, employee, occurred_at: input.inAt, kind: "CLOCK_IN", source: "WEB", recorded_by: employee, created_at: new Date().toISOString(), note: input.reason }];
        if (input.outAt) additions.push({ id: `demo-correction-out-${Date.now()}`, employee, occurred_at: input.outAt, kind: "CLOCK_OUT", source: "WEB", recorded_by: employee, created_at: new Date().toISOString(), note: input.reason });
        const events = [...state.attendanceEvents, ...additions];
        return { ...current, [commandIdentity]: { ...state, attendanceEvents: events, attendanceDays: mergeAttendanceDays(state.attendanceDays, deriveAttendanceDays(events, employee, state.schedules)) } };
      });
    }, 150);
    return { ok: true };
  }, [role]);

  const resolveAttendanceException = useCallback((workDate: string, status: AttendanceDay["status"], reason: string): AttendanceMutationResult => {
    if (!capabilities.canResolveExceptions) return { ok: false, code: "CAPABILITY_DENIED" };
    const commandIdentity = role;
    window.setTimeout(() => {
      if (activeIdentityRef.current !== commandIdentity) return;
      setIdentityStates((current) => ({ ...current, [commandIdentity]: { ...current[commandIdentity], attendanceDays: current[commandIdentity].attendanceDays.map((day) => day.work_date === workDate ? { ...day, status, justification: reason, resolved_by: identityEmployeeId(commandIdentity), resolved_at: new Date().toISOString() } : day) } }));
    }, 150);
    return { ok: true };
  }, [capabilities.canResolveExceptions, role]);

  const setWorkSchedule = useCallback((schedule: WorkSchedule): AttendanceMutationResult => {
    const allowed = schedule.scope === "ORGANIZATION" ? capabilities.canSetOrgSchedule : capabilities.canSetScheduleForReports;
    if (!allowed) return { ok: false, code: "CAPABILITY_DENIED" };
    const commandIdentity = role;
    window.setTimeout(() => {
      if (activeIdentityRef.current !== commandIdentity) return;
      setIdentityStates((current) => ({ ...current, [commandIdentity]: { ...current[commandIdentity], schedules: [...current[commandIdentity].schedules.filter((item) => item.id !== schedule.id), schedule] } }));
    }, 150);
    return { ok: true };
  }, [capabilities.canSetOrgSchedule, capabilities.canSetScheduleForReports, role]);

  const removeWorkSchedule = useCallback((scheduleId: string): AttendanceMutationResult => {
    // The scope of the schedule being removed decides the capability, the same way
    // setWorkSchedule decides by the scope it is writing: deleting an exception from
    // a report's file is a report-level act, not an organization-wide one.
    const found = activeState.schedules.find((item) => item.id === scheduleId);
    if (!found) return { ok: false, code: "INVALID_INPUT" };
    const allowed = found.scope === "ORGANIZATION" ? capabilities.canSetOrgSchedule : capabilities.canSetScheduleForReports;
    if (!allowed) return { ok: false, code: "CAPABILITY_DENIED" };
    const commandIdentity = role;
    window.setTimeout(() => {
      if (activeIdentityRef.current !== commandIdentity) return;
      setIdentityStates((current) => ({
        ...current,
        [commandIdentity]: {
          ...current[commandIdentity],
          schedules: current[commandIdentity].schedules.filter((item) => item.id !== scheduleId),
        },
      }));
    }, 150);
    return { ok: true };
  }, [activeState.schedules, capabilities.canSetOrgSchedule, capabilities.canSetScheduleForReports, role]);

  /**
   * Record an adjustment against ONE named employee.
   *
   * This used to write to `commandIdentity` — whoever was signed in — while the
   * dialog was opened for a specific employee, so an HR user fixing e1's balance
   * actually changed hr1's and the dialog previewed hr1's numbers under e1's
   * name. It now takes the employee, so what the dialog shows and what it saves
   * are the same person.
   *
   * No mid-flight identity guard is needed any more: the write no longer depends
   * on who is signed in, only on who was chosen.
   */
  const adjustLeaveBalance = useCallback((employee: string, leaveType: LeaveBalance["leave_type"], days: number, reason: string): AttendanceMutationResult => {
    if (!capabilities.canManageLeaveBalance) return { ok: false, code: "CAPABILITY_DENIED" };
    if (!reason.trim()) return { ok: false, code: "INVALID_INPUT" };
    const recordedBy = identityEmployeeId(role);
    const key = `${employee}|${leaveType}`;
    window.setTimeout(() => {
      setLeaveAdjustments((current) => ({
        ...current,
        [key]: [
          ...(current[key] ?? []),
          { id: `adj-${Date.now()}`, days, reason: reason.trim(), created_at: new Date().toISOString(), recorded_by: recordedBy },
        ],
      }));
    }, 150);
    return { ok: true };
  }, [capabilities.canManageLeaveBalance, role]);

  /**
   * Announce to a demo audience. The record always starts PENDING — this is
   * an in-memory stand-in for a real dispatch, never a synchronous success
   * and no real mail/notification API is touched. The screen settles the
   * record via settleAnnouncement.
   */
  const sendAnnouncement = useCallback((input: { subject: string; body: string; channel: AnnouncementChannel; audience: "ALL" | "SELECTED"; recipientIds: string[] }): AttendanceMutationResult<AnnouncementMock> => {
    if (!capabilities.canSendAnnouncements) return { ok: false, code: "CAPABILITY_DENIED" };
    const invalidAudience = input.audience === "SELECTED" && input.recipientIds.length === 0;
    if (!input.subject.trim() || invalidAudience) return { ok: false, code: "INVALID_INPUT" };
    const pending = createAnnouncementFixture({ subject: input.subject, body: input.body, channel: input.channel, audience: input.audience, recipient_ids: input.recipientIds, created_by: identityEmployeeId(role) });
    window.setTimeout(() => setAnnouncementItems((current) => [cloneFixture(pending), ...current]), 150);
    return { ok: true, value: cloneFixture(pending) };
  }, [capabilities.canSendAnnouncements, role]);

  /** Settle a pending announcement (CONFIRMED / UNKNOWN / CONFLICT); HR-only. */
  const settleAnnouncement = useCallback((announcementId: string, status: Exclude<AnnouncementStatus, "PENDING">): AttendanceMutationResult<AnnouncementMock> => {
    if (!capabilities.canSendAnnouncements) return { ok: false, code: "CAPABILITY_DENIED" };
    let settled: AnnouncementMock | undefined;
    setAnnouncementItems((current) => current.map((announcement) => {
      if (announcement.id !== announcementId || announcement.status !== "PENDING") return announcement;
      settled = { ...announcement, status };
      return settled;
    }));
    return settled ? { ok: true, value: settled } : { ok: false, code: "MISSING_RECORD" };
  }, [capabilities.canSendAnnouncements]);

  const saveEmployeeFile = useCallback((employeeId: string, patch: EmployeeFilePatch): AttendanceMutationResult<EmployeeDirectoryEntry> => {
    if (!capabilities.canManageDirectory) return { ok: false, code: "CAPABILITY_DENIED" };
    if (!employeeDirectoryFixture.some((entry) => entry.id === employeeId)) return { ok: false, code: "MISSING_RECORD" };
    const savedAt = new Date().toISOString();
    setFileOverrides((current) => {
      const next = { ...current, [employeeId]: { ...(current[employeeId] ?? {}), ...patch, saved_at: savedAt } as EmployeeFilePatch & { saved_at?: string } };
      storeFileOverrides(next as Record<string, EmployeeFilePatch>);
      return next;
    });
    return { ok: true, value: mergeEmployeeFilePatch(
      employeeDirectoryFixture.find((entry) => entry.id === employeeId)!,
      { ...(fileOverrides[employeeId] ?? {}), ...patch },
    ) };
  }, [capabilities.canManageDirectory, fileOverrides]);

  /* ===== Brief C — the tasks cycle, next to the other mutations ===== */

  /** Who is signed in, as a directory id — the creator and actor of record. */
  const myEmployeeId = identityEmployeeId(role);

  /** One read path for the flags: overlay first, then the fixture table. */
  const taskCapabilityFor = useCallback(
    (employeeId: string): TaskCapability =>
      taskCapabilityOverrides[employeeId] ?? taskCapabilitiesById[employeeId] ?? DEFAULT_TASK_CAPABILITY,
    [taskCapabilityOverrides],
  );

  /**
   * Who may write the flags. The brief names manager AND HR; the role matrix
   * above resolves "manager or HR" through canSetScheduleForReports-style
   * pairs, so the tasks flags ride canManageDirectory (HR) plus the manager's
   * report-level acts. Anything narrower would invent a rule the UI mirrors.
   */
  const canSetTaskCapabilities = role === "manager" || role === "hr";

  const setTaskCapabilities = useCallback((employeeId: string, flags: Partial<TaskCapability>): TaskMutationResult => {
    if (!canSetTaskCapabilities) return { ok: false, code: "CAPABILITY_DENIED" };
    if (!employeeDirectoryFixture.some((entry) => entry.id === employeeId)) return { ok: false, code: "MISSING_RECORD" };
    const merged: TaskCapability = {
      can_create_tasks: flags.can_create_tasks ?? taskCapabilityFor(employeeId).can_create_tasks,
      can_assign_tasks: flags.can_assign_tasks ?? taskCapabilityFor(employeeId).can_assign_tasks,
    };
    setTaskCapabilityOverrides((current) => {
      const next = { ...current, [employeeId]: merged };
      storeTaskCapabilityOverrides(next);
      return next;
    });
    return { ok: true };
  }, [canSetTaskCapabilities, taskCapabilityFor]);

  /**
   * Create a task. The refusal table mirrors the brief verbatim, checked HERE
   * (the context) rather than in the UI: no create flag → CAPABILITY_DENIED;
   * direct-assign creators need an assignee in the directory; creators without
   * the assign flag need a real manager to route to — the picker being empty
   * is INVALID_INPUT, never a fake success.
   */
  const createTaskTask = useCallback((input: { title: string; description: string; priority: TaskPriority; dueDate: string | null; assignee: string | null; routeTo: string | null }): TaskMutationResult<TaskMock> => {
    const creatorCapability = taskCapabilityFor(myEmployeeId);
    if (!creatorCapability.can_create_tasks) return { ok: false, code: "CAPABILITY_DENIED" };
    if (!input.title.trim()) return { ok: false, code: "INVALID_INPUT" };
    const directAssign = creatorCapability.can_assign_tasks;
    if (directAssign) {
      if (!input.assignee || !employeeDirectoryFixture.some((entry) => entry.id === input.assignee)) return { ok: false, code: "INVALID_INPUT" };
    } else {
      if (!input.routeTo || !employeeDirectoryFixture.some((entry) => entry.id === input.routeTo)) return { ok: false, code: "INVALID_INPUT" };
    }
    const now = new Date().toISOString();
    const events: TaskEventMock[] = [
      { id: `demo-task-ev-${Date.now()}`, action: "CREATE", actor: myEmployeeId, comment: "", created_at: now },
    ];
    if (directAssign) {
      events.push({ id: `demo-task-ev-${Date.now()}-a`, action: "ASSIGN", actor: myEmployeeId, assigned: input.assignee!, comment: "", created_at: now });
    } else {
      events.push({ id: `demo-task-ev-${Date.now()}-a`, action: "ROUTE_TO_MANAGER", actor: myEmployeeId, routed_to: input.routeTo!, comment: "", created_at: now });
    }
    const task: TaskMock = {
      id: `demo-task-${Date.now()}`,
      title: input.title.trim(),
      description: input.description.trim(),
      created_by: myEmployeeId,
      assignee: directAssign ? input.assignee : null,
      routed_to_manager: directAssign ? null : input.routeTo,
      status: "OPEN",
      priority: input.priority,
      ...(input.dueDate ? { due_date: input.dueDate } : {}),
      created_at: now,
      events,
    };
    setTasks((current) => {
      const next = [task, ...current];
      storeSessionTasks(next);
      return next;
    });
    return { ok: true, value: task };
  }, [myEmployeeId, taskCapabilityFor]);

  /**
   * Put an assignee on a task — or reassign it. Only a can_assign_tasks holder
   * gets past the gate (CAPABILITY_DENIED otherwise); every change appends an
   * ASSIGN or REASSIGN event carrying what it replaced, so the trail shows who
   * routed the task and who assigned it, in order, with nothing overwritten.
   */
  const assignTask = useCallback((taskId: string, to: string | null): TaskMutationResult<TaskMock> => {
    const actorCapability = taskCapabilityFor(myEmployeeId);
    if (!actorCapability.can_assign_tasks) return { ok: false, code: "CAPABILITY_DENIED" };
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return { ok: false, code: "MISSING_RECORD" };
    if (to !== null && !employeeDirectoryFixture.some((entry) => entry.id === to)) return { ok: false, code: "INVALID_INPUT" };
    if (task.assignee === to) return { ok: true, value: task };
    const now = new Date().toISOString();
    const event: TaskEventMock = {
      id: `demo-task-ev-${Date.now()}`,
      action: task.assignee !== null ? "REASSIGN" : "ASSIGN",
      actor: myEmployeeId,
      ...(to !== null ? { assigned: to } : {}),
      ...(task.assignee !== null ? { replaces: task.assignee } : {}),
      comment: "",
      created_at: now,
    };
    const updated: TaskMock = { ...task, assignee: to, events: [...task.events, event] };
    setTasks((current) => {
      const next = current.map((candidate) => (candidate.id === taskId ? updated : candidate));
      storeSessionTasks(next);
      return next;
    });
    return { ok: true, value: updated };
  }, [myEmployeeId, tasks, taskCapabilityFor]);

  /* ===== Brief H1 — status control + per-task work timer ===== */

  /**
   * Change the task's status. Who may: the assignee (they do the work) or the
   * creator; a manager may move their team's work too. Everyone else gets the
   * honest CAPABILITY_DENIED, and the UI renders no control for them. Every
   * accepted change appends exactly one STATUS_CHANGE event carrying the
   * from → to pair — the trail is never rewritten and the from values make
   * each row self-describing.
   */
  const changeTaskStatus = useCallback((taskId: string, to: TaskStatus): TaskMutationResult<TaskMock> => {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return { ok: false, code: "MISSING_RECORD" };
    const isAssignee = task.assignee === myEmployeeId;
    const isCreator = task.created_by === myEmployeeId;
    const isManager = employeeDirectoryFixture.some((entry) => entry.id === myEmployeeId && ["m1", "emp-2001", "emp-2002", "emp-2003"].includes(entry.id));
    if (!isAssignee && !isCreator && !isManager) return { ok: false, code: "CAPABILITY_DENIED" };
    if (task.status === to) return { ok: true, value: task };
    if (!["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"].includes(to)) return { ok: false, code: "INVALID_INPUT" };
    const event: TaskEventMock = {
      id: `demo-task-ev-${Date.now()}`,
      action: "STATUS_CHANGE",
      actor: myEmployeeId,
      from_status: task.status,
      to_status: to,
      comment: "",
      created_at: new Date().toISOString(),
    };
    const updated: TaskMock = { ...task, status: to, events: [...task.events, event] };
    setTasks((current) => {
      const next = current.map((candidate) => (candidate.id === taskId ? updated : candidate));
      storeSessionTasks(next);
      return next;
    });
    return { ok: true, value: updated };
  }, [myEmployeeId, tasks]);

  /**
   * Start the signed-in employee's timer on a task. Only the assignee may run
   * it — a start on someone else's task is CAPABILITY_DENIED, not a polite
   * no-op — and a second start closes the first interval and returns it so the
   * screen can SAY the switch happened instead of silently double-counting.
   */
  const startTaskTimer = useCallback((taskId: string): TaskMutationResult<{ started: TaskTimeEntry; closedFirst: TaskTimeEntry | null }> => {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return { ok: false, code: "MISSING_RECORD" };
    if (task.assignee !== myEmployeeId) return { ok: false, code: "CAPABILITY_DENIED" };
    const result = startTimerEntry(taskTimeEntries, { taskId, employeeId: myEmployeeId, now: Date.now() });
    if (!result.ok) return result;
    setTaskTimeEntries((current) => {
      // Re-derive inside the updater: stopTaskTimer uses the same rule, so
      // the mirror written here is the one storage and the screen agree on.
      const settled = startTimerEntry(current, { taskId, employeeId: myEmployeeId, now: Date.now() });
      if (!settled.ok) return current;
      storeTaskTimeEntries(settled.entries);
      return settled.entries;
    });
    return { ok: true, value: { started: result.started, closedFirst: result.closedFirst } };
  }, [myEmployeeId, tasks, taskTimeEntries]);

  /**
   * Stop and save. The minutes come from the REAL wall clock spanning the
   * interval, so an interval that started before a reload records its full
   * duration, and a zero-length start→stop is simply 0 — never negative.
   */
  const stopTaskTimer = useCallback((): TaskMutationResult<TaskTimeEntry> => {
    const result = stopRunningEntry(taskTimeEntries, myEmployeeId, Date.now());
    if (!result.ok) return result;
    setTaskTimeEntries((current) => {
      const settled = stopRunningEntry(current, myEmployeeId, Date.now());
      if (!settled.ok) return current;
      storeTaskTimeEntries(settled.remaining);
      return settled.remaining;
    });
    return { ok: true, value: result.entry };
  }, [myEmployeeId, taskTimeEntries]);

  const taskTimeTotalSeconds = useCallback(
    (taskId: string, employeeId: string) => totalSecondsFor(taskTimeEntries, taskId, employeeId),
    [taskTimeEntries],
  );
  const taskTimeElapsedSeconds = useCallback(
    (employeeId: string, now: number) => {
      const running = runningEntryFor(taskTimeEntries, employeeId);
      return running ? elapsedSecondsOf(running, now) : 0;
    },
    [taskTimeEntries],
  );
  const taskTimeRunningFor = useCallback(
    (employeeId: string) => runningEntryFor(taskTimeEntries, employeeId),
    [taskTimeEntries],
  );
  const taskTimeFormatElapsed = useCallback((totalSeconds: number) => formatElapsedOf(totalSeconds), []);

  // Kept verbatim from before the saveEmployeeFile insert above.
  const resolveScheduleFor = useCallback((employee: string, date: string) => resolveScheduleFixture(employee, date, activeState.schedules), [activeState.schedules]);
  const leaveBalanceSummary = useCallback((balance: LeaveBalance) => deriveLeaveBalanceSummary(balance), []);
  const clockIn = useCallback((occurredAt?: string, note?: string) => clockMutation("CLOCK_IN", occurredAt, note), [clockMutation]);
  const clockOut = useCallback((occurredAt?: string, note?: string) => clockMutation("CLOCK_OUT", occurredAt, note), [clockMutation]);

  const removeNotification = useCallback((notificationId: string) => {
    const commandIdentity = role;
    window.setTimeout(() => {
      if (activeIdentityRef.current !== commandIdentity) return;
      setIdentityStates((current) => ({
        ...current,
        [commandIdentity]: {
          ...current[commandIdentity],
          notificationItems: current[commandIdentity].notificationItems.filter((notification) => notification.id !== notificationId),
        },
      }));
    }, 150);
  }, [role]);

  const clearNotifications = useCallback(() => {
    const commandIdentity = role;
    window.setTimeout(() => {
      if (activeIdentityRef.current !== commandIdentity) return;
      setIdentityStates((current) => ({
        ...current,
        [commandIdentity]: {
          ...current[commandIdentity],
          notificationItems: [],
        },
      }));
    }, 150);
  }, [role]);

  const saveDemoRequest = useCallback(async ({ typeId, title, details, submit }: { typeId: number; title: string; details: string; submit: boolean }) => {
    const commandIdentity = role;
    await demoDelay();
    if (activeIdentityRef.current !== commandIdentity) throw mutationIssue("missing");
    const requestType = myRequests.concat(teamRequests).flatMap((request) => request.request_type).find((type) => type.id === typeId) ?? myRequests[0].request_type;
    const now = new Date().toISOString();
    const status: RequestStatus = submit ? "PENDING_MANAGER" : "DRAFT";
    const created: RequestMock = {
      id: `demo-request-${Date.now()}`,
      requester_id: `demo-${commandIdentity}`,
      requester_name: demoUser[commandIdentity].name,
      request_type: requestType,
      title,
      details,
      status,
      version: 1,
      submitted_at: submit ? now : null,
      created_at: now,
      updated_at: now,
      attachments: [],
      events: [eventFor(submit ? "SUBMIT" : "CREATE", submit ? "DRAFT" : null, status, "", demoUser[commandIdentity].name[locale])],
      permissions: { can_decide: false },
    };
    setIdentityStates((current) => ({
      ...current,
      [commandIdentity]: {
        ...current[commandIdentity],
        myRequestItems: [created, ...current[commandIdentity].myRequestItems],
      },
    }));
    return created;
  }, [locale, role]);

  const submitDemoTimesheet = useCallback(async (timesheetId: string, entries: TimeEntryMock[]) => {
    const commandIdentity = role;
    await demoDelay();
    if (activeIdentityRef.current !== commandIdentity) throw mutationIssue("missing");
    let returned: TimesheetMock | undefined;
    setIdentityStates((current) => {
      const identityState = current[commandIdentity];
      const nextSheets = identityState.myTimesheetItems.map((sheet) => {
        if (sheet.id !== timesheetId) return sheet;
        returned = {
          ...sheet,
          status: "SUBMITTED",
          version: sheet.version + 1,
          entries,
          events: [...sheet.events, eventFor("SUBMIT", sheet.status, "SUBMITTED", "", demoUser[commandIdentity].name[locale])],
        };
        return returned;
      });
      return {
        ...current,
        [commandIdentity]: { ...identityState, myTimesheetItems: nextSheets },
      };
    });
    if (!returned) throw mutationIssue("missing");
    return returned;
  }, [locale, role]);

  const decideDemoRequest = useCallback(async (requestId: string, decision: ReviewDecision, comment: string, expectedVersion: number) => {
    const commandIdentity = role;
    await demoDelay();
    if (activeIdentityRef.current !== commandIdentity) throw mutationIssue("missing");
    const issue = stateDemoControl.fixture;
    if (issue === "unknown") {
      stateDemoControl.fixture = "ready";
      throw mutationIssue("unknown");
    }

    let returned: RequestMock | undefined;
    let conflictRecord: RequestMock | undefined;
    setIdentityStates((current) => {
      const identityState = current[commandIdentity];
      const latest = identityState.teamRequestItems.find((request) => request.id === requestId);
      if (!latest) return current;
      if (issue === "conflict" || latest.version !== expectedVersion) {
        conflictRecord = latest;
        return current;
      }
      const status: RequestStatus = decision === "APPROVE"
        ? latest.request_type.requires_hr_approval ? "PENDING_HR" : "APPROVED"
        : decision === "REJECT" ? "REJECTED" : "RETURNED";
      returned = {
        ...latest,
        status,
        version: latest.version + 1,
        updated_at: new Date().toISOString(),
        permissions: { can_decide: false },
        events: [...latest.events, eventFor(decision, latest.status, status, comment, demoUser[commandIdentity].name[locale])],
      };
      return {
        ...current,
        [commandIdentity]: {
          ...identityState,
          teamRequestItems: identityState.teamRequestItems.map((request) => request.id === requestId ? returned! : request),
        },
      };
    });
    if (issue === "conflict") stateDemoControl.fixture = "ready";
    if (conflictRecord) throw mutationIssue("conflict", conflictRecord);
    if (!returned) throw mutationIssue("missing");
    return returned;
  }, [locale, role]);

  const decideDemoTimesheet = useCallback(async (timesheetId: string, decision: ReviewDecision, comment: string, expectedVersion: number) => {
    const commandIdentity = role;
    await demoDelay();
    if (activeIdentityRef.current !== commandIdentity) throw mutationIssue("missing");
    const issue = stateDemoControl.fixture;
    if (issue === "unknown") {
      stateDemoControl.fixture = "ready";
      throw mutationIssue("unknown");
    }

    let returned: TimesheetMock | undefined;
    let conflictRecord: TimesheetMock | undefined;
    setIdentityStates((current) => {
      const identityState = current[commandIdentity];
      const latest = identityState.teamTimesheetItems.find((sheet) => sheet.id === timesheetId);
      if (!latest) return current;
      if (issue === "conflict" || latest.version !== expectedVersion) {
        conflictRecord = latest;
        return current;
      }
      const status: TimesheetStatus = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "RETURNED";
      const now = new Date().toISOString();
      returned = {
        ...latest,
        status,
        version: latest.version + 1,
        updated_at: now,
        permissions: { can_decide: false },
        events: [...latest.events, eventFor(decision, latest.status, status, comment, demoUser[commandIdentity].name[locale])],
      };
      return {
        ...current,
        [commandIdentity]: {
          ...identityState,
          teamTimesheetItems: identityState.teamTimesheetItems.map((sheet) => sheet.id === timesheetId ? returned! : sheet),
        },
      };
    });
    if (issue === "conflict") stateDemoControl.fixture = "ready";
    if (conflictRecord) throw mutationIssue("conflict", conflictRecord);
    if (!returned) throw mutationIssue("missing");
    return returned;
  }, [locale, role]);

  const setDemoFixture = useCallback((fixture: DemoFixture) => {
    if (!DEMO_MODE) return;
    stateDemoControl.fixture = fixture;
    if (fixture === "ready" || fixture === "loading" || fixture === "empty" || fixture === "error") {
      window.dispatchEvent(new CustomEvent("demo-fixture-change"));
    }
  }, []);

  /**
   * The directory's balances with this session's adjustments folded in.
   *
   * Both the admin table and the adjust dialog read from here, which is what
   * makes them agree: previously the table read the pristine fixture while the
   * dialog read the signed-in identity's rows, so a saved adjustment changed a
   * number nobody was looking at.
   */
  const directoryBalances = useMemo(
    () =>
      directoryLeaveBalances("2026").map((row) => {
        const recorded = leaveAdjustments[`${row.employee}|${row.leave_type}`];
        return recorded ? { ...row, adjustments: [...row.adjustments, ...recorded] } : row;
      }),
    [leaveAdjustments],
  );

  /** The signed-in employee's own rows, from the same merged source. */
  const activeLeaveBalances = useMemo(
    () => directoryBalances.filter((row) => row.employee === identityEmployeeId(role)),
    [directoryBalances, role],
  );

  // Brief C demo affordance: the verification harness needs to call the real
  // context mutations for actors other than the ones the UI will render (a
  // non-creator has no create button to click). DEMO_MODE is a compile-time
  // constant, so a real build tree-shakes this whole window pollution away.
  useEffect(() => {
    if (!DEMO_MODE) return;
    (window as unknown as Record<string, unknown>).__taskVerify = {
      taskCapabilityFor,
      setTaskCapabilities,
      createTask: createTaskTask,
      assignTask,
      changeTaskStatus,
      startTaskTimer,
      stopTaskTimer,
      taskTimeEntries,
      taskTimeRunningFor,
      taskTimeTotalSeconds,
      taskTimeElapsedSeconds,
    };
    return () => { delete (window as unknown as Record<string, unknown>).__taskVerify; };
  }, [taskCapabilityFor, setTaskCapabilities, createTaskTask, assignTask, changeTaskStatus, startTaskTimer, stopTaskTimer, taskTimeEntries, taskTimeRunningFor, taskTimeTotalSeconds, taskTimeElapsedSeconds]);

  /**
   * The directory as every screen should see it: fixture + HR's file edit
   * overlay. Reading happens HERE —mirroring the directoryBalances pattern—
   * so a renamed employee shows the new name on the roster, the Overview,
   * announcements pickers and everywhere else that reads the context.
   */
  const employeeDirectoryWithOverrides = useMemo(
    () => employeeDirectoryFixture.map((entry) => {
      const patch = fileOverrides[entry.id];
      return patch ? mergeEmployeeFilePatch(entry, patch) : entry;
    }),
    [fileOverrides],
  );

  const value = useMemo<AppState>(() => ({
    locale,
    setLocale,
    t: (key: keyof Dict) => dict[locale][key] as string,
    dir: locale === "ar" ? "rtl" : "ltr",
    role,
    setRole,
    serverAccount,
    sessionChecked,
    adoptSession,
    capabilities,
    appearance,
    setAppearance,
    resolvedTheme,
    myRequestItems: activeState.myRequestItems,
    teamRequestItems: activeState.teamRequestItems,
    myTimesheetItems: activeState.myTimesheetItems,
    teamTimesheetItems: activeState.teamTimesheetItems,
    notificationItems: activeState.notificationItems,
    attendanceEvents: activeState.attendanceEvents,
    attendanceDays: activeState.attendanceDays,
    schedules: activeState.schedules,
    leaveBalances: activeLeaveBalances,
    employeeDirectory: employeeDirectoryWithOverrides,
    saveEmployeeFile,
    visibleEmployeeFile: visibleEmployeeFile as typeof visibleEmployeeFile,
    publicHolidays,
    isPublicHoliday,
    publicHolidaysInRange,
    directoryLeaveBalances: directoryBalances,
    announcementItems,
    sendAnnouncement,
    settleAnnouncement,
    clockIn,
    clockOut,
    submitAttendanceCorrection,
    resolveAttendanceException,
    setWorkSchedule,
    removeWorkSchedule,
    adjustLeaveBalance,
    resolveScheduleFor,
    leaveBalanceSummary,
    markNotificationRead,
    removeNotification,
    clearNotifications,
    saveDemoRequest,
    submitDemoTimesheet,
    decideDemoRequest,
    decideDemoTimesheet,
    tasks,
    taskCapabilityFor,
    setTaskCapabilities,
    createTask: createTaskTask,
    assignTask,
    changeTaskStatus,
    taskTimeEntries,
    startTaskTimer,
    stopTaskTimer,
    taskTimeTotalSeconds,
    taskTimeElapsedSeconds,
    taskTimeRunningFor,
    taskTimeFormatElapsed,
    setDemoFixture,
    isDemoMode: DEMO_MODE,
  }), [
    activeState,
    adoptSession,
    announcementItems,
    appearance,
    capabilities,
    decideDemoRequest,
    decideDemoTimesheet,
    locale,
    markNotificationRead,
    removeNotification,
    removeWorkSchedule,
    clearNotifications,
    resolvedTheme,
    role,
    saveDemoRequest,
    serverAccount,
    sessionChecked,
    setAppearance,
    setDemoFixture,
    setLocale,
    activeLeaveBalances,
    directoryBalances,
    employeeDirectoryWithOverrides,
    saveEmployeeFile,
    adjustLeaveBalance,
    clockIn,
    clockOut,
    leaveBalanceSummary,
    resolveAttendanceException,
    resolveScheduleFor,
    setWorkSchedule,
    submitAttendanceCorrection,
    setRole,
    sendAnnouncement,
    settleAnnouncement,
    submitDemoTimesheet,
    tasks,
    taskCapabilityFor,
    setTaskCapabilities,
    createTaskTask,
    assignTask,
    changeTaskStatus,
    taskTimeEntries,
    startTaskTimer,
    stopTaskTimer,
    taskTimeTotalSeconds,
    taskTimeElapsedSeconds,
    taskTimeRunningFor,
    taskTimeFormatElapsed,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}

export function usePageTitle(page: string): void {
  const { locale } = useApp();
  useEffect(() => {
    document.title = locale === "ar"
      ? `${page} — هي فوضى؟ (عرض تجريبي)`
      : `${page} — Heya Fawda? (visual demo)`;
  }, [locale, page]);
}
