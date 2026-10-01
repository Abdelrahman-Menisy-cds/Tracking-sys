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
import {
  demoUser,
  myRequests,
  myTimesheets,
  notifications,
  stateDemoControl,
  teamRequests,
  teamTimesheets,
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
  attendanceSchedules,
  deriveAttendanceDays,
  fixtureAttendanceDays,
  mergeAttendanceDays,
  identityEmployeeId,
  leaveBalancesByIdentity,
  leaveBalanceSummary as deriveLeaveBalanceSummary,
  resolveScheduleFixture,
  type AttendanceDay,
  type AttendanceEvent,
  type AttendanceEventKind,
  type AttendanceMutationResult,
  type LeaveBalance,
  type WorkSchedule,
} from "../mock/attendance";

export type Appearance = "system" | "light" | "dark";

const LOCALE_STORAGE_KEY = "tracking-sys.locale";
const APPEARANCE_STORAGE_KEY = "tracking-sys.appearance";

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
}

interface AppState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: keyof Dict) => string;
  dir: "rtl" | "ltr";
  /** Fixture identity only; never authentication or authorization. */
  role: DemoIdentity;
  setRole: (role: DemoIdentity) => void;
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
  clockIn: (occurredAt?: string, note?: string) => AttendanceMutationResult<AttendanceEvent>;
  clockOut: (occurredAt?: string, note?: string) => AttendanceMutationResult<AttendanceEvent>;
  submitAttendanceCorrection: (input: { workDate: string; inAt: string; outAt?: string; reason: string }) => AttendanceMutationResult;
  resolveAttendanceException: (workDate: string, status: AttendanceDay["status"], reason: string) => AttendanceMutationResult;
  setWorkSchedule: (schedule: WorkSchedule) => AttendanceMutationResult;
  adjustLeaveBalance: (leaveType: LeaveBalance["leave_type"], days: number, reason: string) => AttendanceMutationResult;
  resolveScheduleFor: (employee: string, date: string) => WorkSchedule | null;
  leaveBalanceSummary: (balance: LeaveBalance) => ReturnType<typeof deriveLeaveBalanceSummary>;
  markNotificationRead: (notificationId: string) => void;
  removeNotification: (notificationId: string) => void;
  clearNotifications: () => void;
  saveDemoRequest: (input: { typeId: number; title: string; details: string; submit: boolean }) => Promise<RequestMock>;
  submitDemoTimesheet: (timesheetId: string, entries: TimeEntryMock[]) => Promise<TimesheetMock>;
  decideDemoRequest: (requestId: string, decision: ReviewDecision, comment: string, expectedVersion: number) => Promise<RequestMock>;
  decideDemoTimesheet: (timesheetId: string, decision: ReviewDecision, comment: string, expectedVersion: number) => Promise<TimesheetMock>;
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
  leaveBalances: LeaveBalance[];
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
    attendanceEvents: cloneFixture(attendanceEventsByIdentity[identity]),
    attendanceDays: cloneFixture(fixtureAttendanceDays(identity)),
    schedules: cloneFixture(attendanceSchedules),
    leaveBalances: cloneFixture(leaveBalancesByIdentity[identity]),
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
  const [appearance, setAppearanceState] = useState<Appearance>(readStoredAppearance);
  const [osTheme, setOsTheme] = useState<"light" | "dark">(systemTheme);
  const [identityStates, setIdentityStates] = useState<Record<DemoIdentity, IdentityState>>(initialIdentityStates);
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
  const setRole = useCallback((nextRole: DemoIdentity) => {
    if (!DEMO_MODE) return;
    activeIdentityRef.current = nextRole;
    setRoleState(nextRole);
    stateDemoControl.fixture = "ready";
  }, []);
  const capabilities = useMemo<DemoCapabilities>(
    () => ({
      canReview: DEMO_MODE && (role === "manager" || role === "hr"),
      canClock: DEMO_MODE,
      canViewTeamAttendance: DEMO_MODE && (role === "manager" || role === "hr"),
      canResolveExceptions: DEMO_MODE && (role === "manager" || role === "hr"),
      canApproveCorrections: DEMO_MODE && (role === "manager" || role === "hr"),
      canSetScheduleForReports: DEMO_MODE && (role === "manager" || role === "hr"),
      canSetOrgSchedule: DEMO_MODE && role === "hr",
      canManageLeaveBalance: DEMO_MODE && role === "hr",
      canViewOrgAttendance: DEMO_MODE && role === "hr",
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

  const adjustLeaveBalance = useCallback((leaveType: LeaveBalance["leave_type"], days: number, reason: string): AttendanceMutationResult => {
    if (!capabilities.canManageLeaveBalance) return { ok: false, code: "CAPABILITY_DENIED" };
    if (!reason.trim()) return { ok: false, code: "INVALID_INPUT" };
    const commandIdentity = role;
    window.setTimeout(() => {
      if (activeIdentityRef.current !== commandIdentity) return;
      setIdentityStates((current) => ({ ...current, [commandIdentity]: { ...current[commandIdentity], leaveBalances: current[commandIdentity].leaveBalances.map((balance) => balance.leave_type === leaveType ? { ...balance, adjustments: [...balance.adjustments, { id: `adj-${Date.now()}`, days, reason, created_at: new Date().toISOString(), recorded_by: identityEmployeeId(commandIdentity) }] } : balance) } }));
    }, 150);
    return { ok: true };
  }, [capabilities.canManageLeaveBalance, role]);

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

  const value = useMemo<AppState>(() => ({
    locale,
    setLocale,
    t: (key: keyof Dict) => dict[locale][key] as string,
    dir: locale === "ar" ? "rtl" : "ltr",
    role,
    setRole,
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
    leaveBalances: activeState.leaveBalances,
    clockIn,
    clockOut,
    submitAttendanceCorrection,
    resolveAttendanceException,
    setWorkSchedule,
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
    setDemoFixture,
    isDemoMode: DEMO_MODE,
  }), [
    activeState,
    appearance,
    capabilities,
    decideDemoRequest,
    decideDemoTimesheet,
    locale,
    markNotificationRead,
    removeNotification,
    clearNotifications,
    resolvedTheme,
    role,
    saveDemoRequest,
    setAppearance,
    setDemoFixture,
    setLocale,
    adjustLeaveBalance,
    clockIn,
    clockOut,
    leaveBalanceSummary,
    resolveAttendanceException,
    resolveScheduleFor,
    setWorkSchedule,
    submitAttendanceCorrection,
    setRole,
    submitDemoTimesheet,
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
