/**
 * App context: demo locale, appearance, role, and mock-data state controls.
 * This is a visual demo — role switching is an explicit demo affordance, not
 * a permission simulator; it changes only which mock views render.
 */
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
import { stateDemoControl } from "../mock/data";

export type Appearance = "system" | "light" | "dark";

interface AppState {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: keyof Dict) => string;
  dir: "rtl" | "ltr";
  role: Role;
  setRole: (r: Role) => void;
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  resolvedTheme: "light" | "dark";
  /** Demo state controls for reviewers. */
  failNext: () => void;
  loadingNext: () => void;
  emptyNext: () => void;
}

const AppContext = createContext<AppState | null>(null);

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ar");
  const [role, setRole] = useState<Role>("employee");
  const [appearance, setAppearanceState] = useState<Appearance>("system");
  const [osTheme, setOsTheme] = useState<"light" | "dark">(systemTheme);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setOsTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = appearance === "system" ? osTheme : appearance;

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = locale === "ar" ? "rtl" : "ltr";
    root.dataset.theme = resolvedTheme;
  }, [locale, resolvedTheme]);

  const setLocale = useCallback((l: Locale) => setLocaleState(l), []);

  const setAppearance = useCallback((a: Appearance) => setAppearanceState(a), []);

  const value = useMemo<AppState>(
    () => ({
      locale,
      setLocale,
      t: (key: keyof Dict) => dict[locale][key] as string,
      dir: locale === "ar" ? "rtl" : "ltr",
      role,
      setRole,
      appearance,
      setAppearance,
      resolvedTheme,
      failNext: () => {
        stateDemoControl.failNext = true;
      },
      loadingNext: () => {
        stateDemoControl.loadingNext = true;
      },
      emptyNext: () => {
        stateDemoControl.emptyNext = true;
      },
    }),
    [locale, role, appearance, resolvedTheme, setLocale, setAppearance],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

/** Per-page document title — brand first, then the page name, demo label kept. */
export function usePageTitle(page: string): void {
  const { locale } = useApp();
  useEffect(() => {
    document.title =
      locale === "ar"
        ? `${page} — هي فوضى؟ (عرض تجريبي)`
        : `${page} — Heya Fawda? (visual demo)`;
  }, [locale, page]);
}
