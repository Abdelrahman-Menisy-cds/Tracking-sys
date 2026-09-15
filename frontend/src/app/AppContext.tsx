import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

export type Appearance = "system" | "light" | "dark";
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

interface DemoCapabilities {
  canReview: boolean;
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
  markNotificationRead: (notificationId: string) => void;
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
  const [locale, setLocaleState] = useState<Locale>("ar");
  const [role, setRoleState] = useState<DemoIdentity>("employee");
  const [appearance, setAppearanceState] = useState<Appearance>("system");
  const [osTheme, setOsTheme] = useState<"light" | "dark">(systemTheme);
  const [identityStates, setIdentityStates] = useState<Record<DemoIdentity, IdentityState>>(initialIdentityStates);

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

  const setLocale = useCallback((nextLocale: Locale) => setLocaleState(nextLocale), []);
  const setAppearance = useCallback((nextAppearance: Appearance) => setAppearanceState(nextAppearance), []);
  const setRole = useCallback((nextRole: DemoIdentity) => {
    if (!DEMO_MODE) return;
    setRoleState(nextRole);
    stateDemoControl.fixture = "ready";
  }, []);
  const capabilities = useMemo<DemoCapabilities>(
    () => ({ canReview: DEMO_MODE && (role === "manager" || role === "hr") }),
    [role],
  );
  const activeState = identityStates[role];

  const updateActiveIdentity = useCallback((update: (current: IdentityState) => IdentityState) => {
    setIdentityStates((current) => ({ ...current, [role]: update(current[role]) }));
  }, [role]);

  const markNotificationRead = useCallback((notificationId: string) => {
    updateActiveIdentity((current) => ({
      ...current,
      notificationItems: current.notificationItems.map((notification) =>
        notification.id === notificationId
          ? { ...notification, is_read: true, read_at: new Date().toISOString() }
          : notification,
      ),
    }));
  }, [updateActiveIdentity]);

  const saveDemoRequest = useCallback(async ({ typeId, title, details, submit }: { typeId: number; title: string; details: string; submit: boolean }) => {
    await demoDelay();
    const requestType = myRequests.concat(teamRequests).flatMap((request) => request.request_type).find((type) => type.id === typeId) ?? myRequests[0].request_type;
    const now = new Date().toISOString();
    const status: RequestStatus = submit ? "PENDING_MANAGER" : "DRAFT";
    const created: RequestMock = {
      id: `demo-request-${Date.now()}`,
      requester_id: `demo-${role}`,
      requester_name: demoUser[role].name,
      request_type: requestType,
      title,
      details,
      status,
      version: 1,
      submitted_at: submit ? now : null,
      created_at: now,
      updated_at: now,
      attachments: [],
      events: [eventFor(submit ? "SUBMIT" : "CREATE", submit ? "DRAFT" : null, status, "", demoUser[role].name[locale])],
      permissions: { can_decide: false },
    };
    updateActiveIdentity((current) => ({ ...current, myRequestItems: [created, ...current.myRequestItems] }));
    return created;
  }, [locale, role, updateActiveIdentity]);

  const submitDemoTimesheet = useCallback(async (timesheetId: string, entries: TimeEntryMock[]) => {
    await demoDelay();
    let returned: TimesheetMock | undefined;
    updateActiveIdentity((current) => ({
      ...current,
      myTimesheetItems: current.myTimesheetItems.map((sheet) => {
        if (sheet.id !== timesheetId) return sheet;
        returned = {
          ...sheet,
          status: "SUBMITTED",
          version: sheet.version + 1,
          entries,
          events: [...sheet.events, eventFor("SUBMIT", sheet.status, "SUBMITTED", "", demoUser[role].name[locale])],
        };
        return returned;
      }),
    }));
    if (!returned) throw mutationIssue("missing");
    return returned;
  }, [locale, role, updateActiveIdentity]);

  const decideDemoRequest = useCallback(async (requestId: string, decision: ReviewDecision, comment: string, expectedVersion: number) => {
    await demoDelay();
    const latest = identityStates[role].teamRequestItems.find((request) => request.id === requestId);
    if (!latest) throw mutationIssue("missing");
    if (stateDemoControl.fixture === "unknown") {
      stateDemoControl.fixture = "ready";
      throw mutationIssue("unknown");
    }
    if (stateDemoControl.fixture === "conflict" || latest.version !== expectedVersion) {
      stateDemoControl.fixture = "ready";
      throw mutationIssue("conflict", latest);
    }

    const status: RequestStatus = decision === "APPROVE"
      ? latest.request_type.requires_hr_approval ? "PENDING_HR" : "APPROVED"
      : decision === "REJECT" ? "REJECTED" : "RETURNED";
    const returned: RequestMock = {
      ...latest,
      status,
      version: latest.version + 1,
      updated_at: new Date().toISOString(),
      permissions: { can_decide: false },
      events: [...latest.events, eventFor(decision, latest.status, status, comment, demoUser[role].name[locale])],
    };
    updateActiveIdentity((current) => ({
      ...current,
      teamRequestItems: current.teamRequestItems.map((request) => request.id === requestId ? returned : request),
    }));
    return returned;
  }, [identityStates, locale, role, updateActiveIdentity]);

  const decideDemoTimesheet = useCallback(async (timesheetId: string, decision: ReviewDecision, comment: string, expectedVersion: number) => {
    await demoDelay();
    const latest = identityStates[role].teamTimesheetItems.find((sheet) => sheet.id === timesheetId);
    if (!latest) throw mutationIssue("missing");
    if (stateDemoControl.fixture === "unknown") {
      stateDemoControl.fixture = "ready";
      throw mutationIssue("unknown");
    }
    if (stateDemoControl.fixture === "conflict" || latest.version !== expectedVersion) {
      stateDemoControl.fixture = "ready";
      throw mutationIssue("conflict", latest);
    }

    const status: TimesheetStatus = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "RETURNED";
    const now = new Date().toISOString();
    const returned: TimesheetMock = {
      ...latest,
      status,
      version: latest.version + 1,
      updated_at: now,
      permissions: { can_decide: false },
      events: [...latest.events, eventFor(decision, latest.status, status, comment, demoUser[role].name[locale])],
    };
    updateActiveIdentity((current) => ({
      ...current,
      teamTimesheetItems: current.teamTimesheetItems.map((sheet) => sheet.id === timesheetId ? returned : sheet),
    }));
    return returned;
  }, [identityStates, locale, role, updateActiveIdentity]);

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
    markNotificationRead,
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
    resolvedTheme,
    role,
    saveDemoRequest,
    setAppearance,
    setDemoFixture,
    setLocale,
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
