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
import { getIdentity, type ServerIdentity } from "./api";

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

export type ReviewDecision = "APPROVE" | "REJECT" | "RETURN";
export type DemoIdentity = Role;

/**
 * This Vite mode is the explicit demo-fixture boundary. It is not an
 * authorization mechanism. Data itself now comes from the server APIs
 * (`src/app/*Api.ts`); the screens with no backend endpoint yet render the
 * honest empty/unavailable states instead of fixture rows.
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
  /** Identity label only; authorization lives on the server. */
  role: DemoIdentity;
  /** Sign-in adoptions set the role; the demo login picker may too. */
  setRole: (role: DemoIdentity) => void;
  /** The server-side account when there is a session; null otherwise. */
  serverAccount: ServerIdentity | null;
  /** False until the boot-time session probe has answered. Guards must wait on it. */
  sessionChecked: boolean;
  /** Adopt a signed-in session (role + account). Used by the login screen. */
  adoptSession: (identity: ServerIdentity) => void;
  /** Role-derived capabilities; capability ENFORCEMENT is server-side. */
  capabilities: DemoCapabilities;
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
  resolvedTheme: "light" | "dark";
  /**
   * H17 - the server's own word ("this session still owes the company
   * profile"). Strictly `true`/`false`/undefined: undefined (older backend,
   * or the boot probe not answered yet) fails OPEN, so the gate never bricks
   * the app on a missing flag.
   */
  needsCompanyProfile: boolean | undefined;
  isDemoMode: boolean;
}

const AppContext = createContext<AppState | null>(null);

function systemTheme(): "light" | "dark" {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);
  const [role, setRoleState] = useState<DemoIdentity>("employee");
  /** The server-side account, when there is a session. Null otherwise. */
  const [serverAccount, setServerAccount] = useState<ServerIdentity | null>(null);
  /**
   * False until the boot-time session probe has answered, so guards never guess.
   *
   * This used to start `true` in the demo, on the assumption that a demo build has
   * no server to ask. The demo is served BY Django, so starting checked let an
   * admin route evaluate its permission against the "employee" default and
   * redirect before the real role arrived. Starting false costs one request.
   */
  const [sessionChecked, setSessionChecked] = useState(false);
  const [appearance, setAppearanceState] = useState<Appearance>(readStoredAppearance);
  const [osTheme, setOsTheme] = useState<"light" | "dark">(systemTheme);

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
   * Adopt a signed-in session: the role AND the server account together, so a
   * sign-in that only set the role is not bounced straight back to /login.
   */
  const adoptSession = useCallback(
    (identity: ServerIdentity) => {
      setServerAccount(identity);
      setSessionChecked(true);
      setRoleState(roleFromServer(identity.role));
    },
    [],
  );

  const setRole = useCallback((nextRole: DemoIdentity) => {
    // Client-side identity label only. The demo login picker uses it; the
    // session bootstrap sets it from the server's own answer.
    setRoleState(nextRole);
  }, []);

  // Who are we, according to the server? Without this, a reload drops the session
  // and every server-backed screen shows the signed-out state. Asking costs one
  // request and is harmless when there is no server: the catch below keeps what we
  // have and marks the probe answered either way.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await getIdentity();
        if (cancelled) return;
        setServerAccount(me);
        setRoleState(roleFromServer(me.role));
      } catch {
        /* No session, or no server at all. The probe has still answered. */
      } finally {
        if (!cancelled) setSessionChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * What this role may do. Capability follows the ROLE - it used to be ANDed with
   * DEMO_MODE, which made the admin screens unreachable for a signed-in HR user.
   * Enforcement stays server-side; screens use these flags to render the right
   * honest state, never to pretend an action happened.
   */
  const capabilities = useMemo<DemoCapabilities>(
    () => ({
      canReview: role === "manager" || role === "hr",
      canClock: false, /* no attendance endpoint yet */
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

  const value = useMemo<AppState>(() => ({
    locale,
    setLocale,
    t: (key: keyof Dict) => dict[locale][key] as string,
    dir: locale === "ar" ? "rtl" : "ltr",
    role,
    setRole,
    serverAccount,
    sessionChecked,
    needsCompanyProfile: serverAccount?.needs_company_profile === true,
    adoptSession,
    capabilities,
    appearance,
    setAppearance,
    resolvedTheme,
    isDemoMode: DEMO_MODE,
  }), [
    adoptSession,
    appearance,
    capabilities,
    locale,
    resolvedTheme,
    role,
    serverAccount,
    sessionChecked,
    setAppearance,
    setLocale,
    setRole,
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
      ? `${page} - هي فوضى؟`
      : `${page} - Heya Fawda?`;
  }, [locale, page]);
}
