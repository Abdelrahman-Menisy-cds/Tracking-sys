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
export type DemoFixture = "ready" | "loading" | "empty" | "error";
export type ReviewDecision = "APPROVE" | "REJECT" | "RETURN";

interface DemoCapabilities {
  canReview: boolean;
}

interface AppState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: keyof Dict) => string;
  dir: "rtl" | "ltr";
  /** Demo identity only. It is not an authentication or authorization mechanism. */
  role: Role;
  setRole: (role: Role) => void;
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
  decideDemoRequest: (requestId: string, decision: ReviewDecision, comment: string) => Promise<RequestMock>;
  decideDemoTimesheet: (timesheetId: string, decision: ReviewDecision, comment: string) => Promise<TimesheetMock>;
  setDemoFixture: (fixture: DemoFixture) => void;
}

const AppContext = createContext<AppState | null>(null);

function systemTheme(): "light" | "dark" {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function demoDelay(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 450));
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
  const [role, setRole] = useState<Role>("employee");
  const [appearance, setAppearanceState] = useState<Appearance>("system");
  const [osTheme, setOsTheme] = useState<"light" | "dark">(systemTheme);
  const [myRequestItems, setMyRequestItems] = useState<RequestMock[]>(myRequests);
  const [teamRequestItems, setTeamRequestItems] = useState<RequestMock[]>(teamRequests);
  const [myTimesheetItems, setMyTimesheetItems] = useState<TimesheetMock[]>(myTimesheets);
  const [teamTimesheetItems, setTeamTimesheetItems] = useState<TimesheetMock[]>(teamTimesheets);
  const [notificationItems, setNotificationItems] = useState<NotificationMock[]>(notifications);

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
  const capabilities = useMemo<DemoCapabilities>(() => ({ canReview: role === "manager" || role === "hr" }), [role]);

  const markNotificationRead = useCallback((notificationId: string) => {
    setNotificationItems((currentItems) =>
      currentItems.map((notification) =>
        notification.id === notificationId
          ? { ...notification, is_read: true, read_at: new Date().toISOString() }
          : notification,
      ),
    );
  }, []);

  const saveDemoRequest = useCallback(async ({ typeId, title, details, submit }: { typeId: number; title: string; details: string; submit: boolean }) => {
    await demoDelay();
    const requestType = myRequests.concat(teamRequests).flatMap((request) => request.request_type).find((type) => type.id === typeId) ?? myRequests[0].request_type;
    const now = new Date().toISOString();
    const status: RequestStatus = submit ? "PENDING_MANAGER" : "DRAFT";
    const created: RequestMock = {
      id: `demo-request-${Date.now()}`,
      requester_id: "demo-current-user",
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
    setMyRequestItems((items) => [created, ...items]);
    return created;
  }, [locale, role]);

  const submitDemoTimesheet = useCallback(async (timesheetId: string, entries: TimeEntryMock[]) => {
    await demoDelay();
    let returned: TimesheetMock | undefined;
    setMyTimesheetItems((items) => items.map((sheet) => {
      if (sheet.id !== timesheetId) return sheet;
      returned = {
        ...sheet,
        status: "SUBMITTED",
        version: sheet.version + 1,
        entries,
        events: [...sheet.events, eventFor("SUBMIT", sheet.status, "SUBMITTED", "", demoUser[role].name[locale])],
      };
      return returned;
    }));
    if (!returned) throw new Error("missing-demo-timesheet");
    return returned;
  }, [locale, role]);

  const decideDemoRequest = useCallback(async (requestId: string, decision: ReviewDecision, comment: string) => {
    await demoDelay();
    let returned: RequestMock | undefined;
    setTeamRequestItems((items) => items.map((request) => {
      if (request.id !== requestId) return request;
      const status: RequestStatus = decision === "APPROVE"
        ? request.request_type.requires_hr_approval ? "PENDING_HR" : "APPROVED"
        : decision === "REJECT" ? "REJECTED" : "RETURNED";
      returned = {
        ...request,
        status,
        version: request.version + 1,
        updated_at: new Date().toISOString(),
        permissions: { can_decide: false },
        events: [...request.events, eventFor(decision, request.status, status, comment, demoUser[role].name[locale])],
      };
      return returned;
    }));
    if (!returned) throw new Error("missing-demo-request");
    return returned;
  }, [locale, role]);

  const decideDemoTimesheet = useCallback(async (timesheetId: string, decision: ReviewDecision, comment: string) => {
    await demoDelay();
    let returned: TimesheetMock | undefined;
    setTeamTimesheetItems((items) => items.map((sheet) => {
      if (sheet.id !== timesheetId) return sheet;
      const status: TimesheetStatus = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "RETURNED";
      returned = {
        ...sheet,
        status,
        version: sheet.version + 1,
        permissions: { can_decide: false },
        events: [...sheet.events, eventFor(decision, sheet.status, status, comment, demoUser[role].name[locale])],
      };
      return returned;
    }));
    if (!returned) throw new Error("missing-demo-timesheet");
    return returned;
  }, [locale, role]);

  const setDemoFixture = useCallback((fixture: DemoFixture) => {
    stateDemoControl.fixture = fixture;
    window.dispatchEvent(new CustomEvent("demo-fixture-change"));
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
    myRequestItems,
    teamRequestItems,
    myTimesheetItems,
    teamTimesheetItems,
    notificationItems,
    markNotificationRead,
    saveDemoRequest,
    submitDemoTimesheet,
    decideDemoRequest,
    decideDemoTimesheet,
    setDemoFixture,
  }), [
    appearance,
    capabilities,
    decideDemoRequest,
    decideDemoTimesheet,
    locale,
    markNotificationRead,
    myRequestItems,
    myTimesheetItems,
    notificationItems,
    resolvedTheme,
    role,
    saveDemoRequest,
    setAppearance,
    setDemoFixture,
    setLocale,
    submitDemoTimesheet,
    teamRequestItems,
    teamTimesheetItems,
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
