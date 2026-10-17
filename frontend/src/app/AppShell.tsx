import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useApp, type Appearance } from "./AppContext";
import { listNotifications } from "./notificationsApi";
import type { Locale } from "../i18n/dict";
import BrandLockup from "../components/brand/BrandLockup";
import TourGuide, { TOUR_START_EVENT } from "../features/tour/TourGuide";
import AssistantLauncher from "../features/assistant/AssistantLauncher";
import OnboardingCompanyPage from "../screens/OnboardingCompanyPage";
import {
  ActivityIcon,
  BellIcon,
  CalendarIcon,
  ChevronDownIcon,
  ClockIcon,
  DocumentIcon,
  GlobeIcon,
  HomeIcon,
  InfoIcon,
  LogoutIcon,
  MoonIcon,
  ReportIcon,
  RtlChevronIcon,
  SunIcon,
  UserIcon,
} from "../components/icons";
import { ClockAction } from "../screens/AttendancePage";

const FOCUSABLE = 'a[href], button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** H45: the desktop rail remembers whether it was collapsed (per browser). */
const RAIL_COLLAPSED_STORAGE_KEY = "tracking-sys.rail-collapsed";

/** The one route the company gate does not divert: the onboarding step itself. */
export const COMPANY_ONBOARDING_PATH = "/onboarding/company";

/**
 * The H17 mandatory gate, evaluated in one place so every route shares it.
 *
 * - "locked": the identity still owes the company profile AND the address is
 *   already /onboarding/company → render ONLY that screen (no rail, no
 *   header, no tour), with sign-out as the sole escape.
 * - "divert": onboarding is owed and the Address is inside the app → swap the
 *   route for /onboarding/company.
 * - null: flag absent/false or the boot probe still pending → the app behaves
 *   exactly as before (fail open; a missing flag must never brick it), and
 *   the onboarding route, once completed, redirects home.
 */
function companyGateState(
  needsCompanyProfile: boolean | undefined,
  sessionChecked: boolean,
  pathname: string,
): "locked" | "divert" | null {
  if (needsCompanyProfile !== true) return null;
  if (!sessionChecked) return null;
  if (pathname === COMPANY_ONBOARDING_PATH) return "locked";
  return "divert";
}

export default function AppShell() {
  const {
    t,
    locale,
    setLocale,
    capabilities,
    resolvedTheme,
    setAppearance,
    serverAccount,
  } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try { return window.localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY) === "true"; }
    catch { return false; /* private mode / storage disabled: the rail just stays as-is */ }
  });
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [isCompact, setIsCompact] = useState(() => window.matchMedia("(max-width: 767px)") /* ds-allow-hardcode: the mobile-overlay breakpoint - below this the sidebar is an overlay drawer, per H45 */.matches);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuItemsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const railRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    window.setTimeout(() => menuButtonRef.current?.focus(), 0);
  }, []);

  /** H45: persist the desktop rail preference (never auth-related, UI state only). */
  const setRailCollapsedPersisted = useCallback((collapse: boolean) => {
    setRailCollapsed(collapse);
    try { window.localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, String(collapse)); }
    catch { /* storage unavailable: the toggle still works this session */ }
  }, []);

  const toggleSidebar = useCallback(() => {
    if (isCompact) {
      if (drawerOpen) closeDrawer();
      else {
        setDrawerOpen(true); /* the compact-focus effect moves focus into the drawer */
      }
      return;
    }
    if (railCollapsed) {
      setRailCollapsedPersisted(false);
      window.setTimeout(() => railRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus(), 0);
    } else {
      setRailCollapsedPersisted(true);
      window.setTimeout(() => menuButtonRef.current?.focus(), 0);
    }
  }, [closeDrawer, drawerOpen, isCompact, railCollapsed, setRailCollapsedPersisted]);

  /** H45: `[` toggles the sidebar (GitHub-style); Esc collapses it from inside. */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
      if (event.key === "[") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      /* Inline rail: Esc only means "leave the sidebar" when focus is in it -
         the profile menu's and dialogs' own Esc handlers stay untouched. */
      if (event.key === "Escape" && !isCompact && !railCollapsed && railRef.current?.contains(document.activeElement) && document.activeElement !== railRef.current) {
        event.preventDefault();
        setRailCollapsedPersisted(true);
        window.setTimeout(() => menuButtonRef.current?.focus(), 0);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isCompact, railCollapsed, toggleSidebar, setRailCollapsedPersisted]);

  const closeProfileMenu = useCallback((restoreFocus = true) => {
    setProfileMenuOpen(false);
    if (restoreFocus) window.setTimeout(() => profileButtonRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (profileMenuRef.current?.contains(target) || profileButtonRef.current?.contains(target)) return;
      closeProfileMenu(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeProfileMenu();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (!profileMenuRef.current?.contains(document.activeElement)) return;
      const items = profileMenuItemsRef.current.filter((item): item is HTMLButtonElement => item !== null);
      if (!items.length) return;
      event.preventDefault();
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      const offset = event.key === "ArrowDown" ? 1 : -1;
      items[(currentIndex + offset + items.length) % items.length].focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeProfileMenu, profileMenuOpen]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)") /* ds-allow-hardcode: the mobile-overlay breakpoint, same as the state initializer above */;
    const updateCompactMode = () => {
      const nextCompact = mediaQuery.matches;
      setIsCompact(nextCompact);
      if (!nextCompact && drawerOpen) closeDrawer();
    };
    updateCompactMode();
    mediaQuery.addEventListener("change", updateCompactMode);
    return () => mediaQuery.removeEventListener("change", updateCompactMode);
  }, [closeDrawer, drawerOpen]);

  useEffect(() => {
    if (!drawerOpen || !isCompact) return;
    const previousOverflow = document.body.style.overflow;
    const main = mainRef.current;
    const previousInert = main?.inert ?? false;

    const focusFirst = () => railRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !railRef.current) return;
      const items = [...railRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.body.style.overflow = "hidden";
    if (main) main.inert = true;
    window.setTimeout(focusFirst, 0);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (main) main.inert = previousInert;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDrawer, drawerOpen, isCompact]);

  useEffect(() => {
    setProfileMenuOpen(false);
  }, [location.pathname]);

  /**
   * The unread badge reads the SERVER's own notifications (the session's rows,
   * no client tenant filter), re-queried when the route changes so marking a
   * notification read on /notifications updates the header on the next
   * navigation. A server failure renders no badge - it never invents one.
   */
  const notifications = useMemo(() => listNotifications(locale).then((payload) => payload.data), [locale]);
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void notifications.then((rows) => {
      if (!cancelled) setUnreadCount(rows.filter((notification) => !notification.is_read).length);
    });
    return () => { cancelled = true; };
  }, [notifications, location.pathname]);
  const navGroups: { label: string; items: { to: string; label: string; end?: boolean; badge?: number; icon: ComponentType }[] }[] = [
    {
      label: locale === "ar" ? "عملي" : "My work",
      items: [
        { to: "/", label: t("navHome"), end: true, icon: HomeIcon },
        { to: "/requests", label: t("navMyRequests"), icon: DocumentIcon },
        { to: "/timesheets", label: t("navMyTimesheets"), icon: ClockIcon },
        { to: "/tasks", label: t("taskNav"), icon: ActivityIcon },
      ],
    },
    {
      label: t("navAttendance"),
      items: [
        { to: "/attendance", label: t("attendanceTitle"), icon: CalendarIcon },
        { to: "/attendance/history", label: t("navAttendanceHistory"), icon: ClockIcon },
      ],
    },
    ...(capabilities.canReview
      ? [{
          label: locale === "ar" ? "عمل المراجعة" : "Review work",
          items: [
            { to: "/reviews", label: t("navTeamReviews"), icon: ActivityIcon },
            { to: "/reports", label: t("navReports"), icon: ReportIcon },
          ],
        }]
      : []),
    ...(capabilities.canSetOrgSchedule && capabilities.canManageLeaveBalance && capabilities.canViewOrgAttendance
      ? [{ label: locale === "ar" ? "الإدارة" : "Administration", items: [{ to: "/admin", label: t("navAdmin"), icon: GlobeIcon }] }]
      : []),
  ];
  const matchedCurrentItem = navGroups
    .flatMap((group) => group.items)
    .filter((item) => item.to === location.pathname || (item.to !== "/" && location.pathname.startsWith(item.to)))
    .sort((left, right) => right.to.length - left.to.length)[0];
  const currentItem = matchedCurrentItem ?? { to: "", label: t("navHome"), icon: HomeIcon };
  const sidebarOpen = isCompact ? drawerOpen : !railCollapsed;
  const targetLocale: Locale = locale === "en" ? "ar" : "en";
  const targetTheme: Exclude<Appearance, "system"> = resolvedTheme === "light" ? "dark" : "light";
  // The icon names the theme you would get, not the one you are in - the same
  // convention as the language button beside it (which shows "AR"/"EN" for the
  // target) and the same thing the aria-label says.
  const ThemeIcon = resolvedTheme === "light" ? MoonIcon : SunIcon;
  /* The signed-in account, as the SERVER describes it. There is no fixture
     identity any more: a session that has not answered yet renders honestly
     empty name/email slots instead of a demo persona. */
  const localizedName = serverAccount?.full_name ?? "-";
  const localizedRole = serverAccount
    ? serverAccount.role === "HR" ? t("roleHr") : serverAccount.role === "MANAGER" ? t("roleManager") : t("roleEmployee")
    : t("roleEmployee");

  // H17: the gate is decided BEFORE any shell chrome mounts, so the rail, the
  // header and the tour never exist while the onboarding step is still owed.
  const { needsCompanyProfile, sessionChecked } = useApp();
  const gate = companyGateState(needsCompanyProfile, sessionChecked, location.pathname);
  if (gate === "locked") {
    return (
      <>
        <a href="#main-content" className="skip-link">{t("skipToMain")}</a>

        <OnboardingCompanyPage />
      </>
    );
  }
  if (gate === "divert") return <Navigate to={COMPANY_ONBOARDING_PATH} replace />;

  return (
    <>
      <a href="#main-content" className="skip-link">{t("skipToMain")}</a>
      {/* Keyboard path: the tour must sit BEFORE the shell in the DOM. Rendered
          last, its two controls (skip/next) sat behind ~50 page controls in tab
          order, so a keyboard user could not reach the tour (verify_keyboard
          [A unreachable] on every page with the tour open). It is
          position:fixed, so document order does not move it visually - it only
          stops being the last tab stop. */}
      <TourGuide />

      <div className={`app-shell${!isCompact && railCollapsed ? " rail-collapsed" : ""}`}>
        <nav
          ref={railRef}
          id="app-rail-nav"
          className={`app-rail ${drawerOpen ? "open" : ""}`}
          aria-label={t("menu")}
          aria-modal={isCompact && drawerOpen ? true : undefined}
          role={isCompact && drawerOpen ? "dialog" : undefined}
        >
          {/* The head holds the brand and the toggle, and it stays live when the
              rail is collapsed: the slim rail has to keep its own control
              reachable, so inert goes on the links, not on the whole nav. */}
          <div className="rail-head">
            <BrandLockup />
            <button
              type="button"
              className="btn btn-ghost icon-only menu-toggle rail-toggle"
              aria-expanded={sidebarOpen}
              aria-controls="app-rail-nav"
              aria-label={sidebarOpen ? t("menuClose") : t("menuOpen")}
              title={sidebarOpen ? t("menuClose") : t("menuOpen")}
              onClick={toggleSidebar}
            >
              <RtlChevronIcon locale={locale} direction={sidebarOpen ? "forward" : "back"} />
            </button>
          </div>
          <div
            className="rail-links"
            inert={((isCompact && !drawerOpen) || (!isCompact && railCollapsed)) ? true : undefined}
          >
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-title">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`nav-link${item.to === currentItem.to ? " active" : ""}`}
                    aria-current={item.to === currentItem.to ? "page" : undefined}
                    onClick={() => {
                      if (isCompact) closeDrawer();
                    }}
                  >
                    <Icon />
                    <span>{item.label}</span>
                    {item.badge ? <span className="nav-badge" aria-label={`${item.badge}`}>{item.badge}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
          </div>
        </nav>
        {drawerOpen && isCompact ? <button className="drawer-backdrop" tabIndex={-1} aria-label={t("close")} onClick={closeDrawer} /> : null}
        <div className="app-main" ref={mainRef}>
          <header className="app-header">
            <button
              ref={menuButtonRef}
              type="button"
              className="btn btn-ghost icon-only menu-toggle"
              aria-expanded={sidebarOpen}
              aria-controls="app-rail-nav"
              aria-label={sidebarOpen ? t("menuClose") : t("menuOpen")}
              title={sidebarOpen ? t("menuClose") : t("menuOpen")}
              onClick={toggleSidebar}
            >
              {/* A chevron pointing where the rail goes: it opens toward the
                  rail and closes away from it. RtlChevronIcon resolves that per
                  locale, so the Arabic rail (on the right) and the English one
                  (on the left) both point the right way. */}
              <RtlChevronIcon locale={locale} direction={sidebarOpen ? "forward" : "back"} />
            </button>
            <div className="header-page-context">
              <strong className="header-page-indicator">{currentItem.label}</strong>
              <NavLink
                to="/notifications"
                className="btn btn-secondary icon-only header-notifications"
                aria-label={unreadCount > 0 ? `${t("navNotifications")}, ${unreadCount} ${locale === "ar" ? "غير مقروءة" : "unread"}` : t("navNotifications")}
              >
                <BellIcon />
                {unreadCount > 0 ? <span className="nav-badge" aria-hidden="true">{unreadCount}</span> : null}
              </NavLink>
            </div>
            <div className="header-actions">
              <ClockAction compact />
              <button
                type="button"
                className="btn btn-secondary icon-only theme-toggle-header"
                aria-pressed={resolvedTheme === "dark"}
                aria-label={targetTheme === "light" ? t("switchToLight") : t("switchToDark")}
                onClick={() => setAppearance(targetTheme)}
              >
                <ThemeIcon />
              </button>
              <button
                type="button"
                className="btn btn-secondary language-toggle-header"
                aria-pressed={locale === "en"}
                aria-label={targetLocale === "ar" ? t("switchToArabic") : t("switchToEnglish")}
                onClick={() => setLocale(targetLocale)}
              >
                {targetLocale.toUpperCase()}
              </button>
              <div className="profile-menu-wrap">
                <button
                  ref={profileButtonRef}
                  type="button"
                  className="btn btn-ghost profile-trigger"
                  aria-haspopup="menu"
                  aria-expanded={profileMenuOpen}
                  aria-controls="profile-menu"
                  onClick={() => setProfileMenuOpen((open) => !open)}
                >
                  <UserIcon />
                  {t("profile")}
                  <ChevronDownIcon />
                </button>
                {profileMenuOpen ? (
                  <div ref={profileMenuRef} id="profile-menu" className="profile-menu" role="menu" aria-label={t("profile")}>
                    <div className="profile-menu-header">
                      <span className="profile-menu-meta">{t("signedInAs")}</span>
                      <span className="profile-menu-name"><bdi>{localizedName}</bdi></span>
                      <span className="profile-menu-meta">{localizedRole} · <bdi>{serverAccount?.email ?? "-"}</bdi></span>
                    </div>
                    <button ref={(element) => { profileMenuItemsRef.current[0] = element; }} type="button" className="btn btn-ghost profile-menu-item" role="menuitem" onClick={() => { closeProfileMenu(false); navigate("/profile"); }}>
                      <UserIcon />
                      {t("account")}
                    </button>
                    <button ref={(element) => { profileMenuItemsRef.current[1] = element; }} type="button" className="btn btn-ghost profile-menu-item" role="menuitem" onClick={() => { closeProfileMenu(false); window.dispatchEvent(new Event(TOUR_START_EVENT)); }}>
                      <InfoIcon />
                      {t("tourStart")}
                    </button>
                    <button ref={(element) => { profileMenuItemsRef.current[2] = element; }} type="button" className="btn btn-ghost profile-menu-item" role="menuitem" onClick={() => { closeProfileMenu(false); navigate("/login"); }}>
                      <LogoutIcon />
                      {t("signOut")}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>
          <main id="main-content"><Outlet /></main>
        </div>
      </div>
      {/* H18: the floating مدام عفاف button sits beside the tour, one instance for
          the whole shell - the onboarding gate above returns before this, so it
          never floats over the company onboarding screen. */}
      <AssistantLauncher />
    </>
  );
}
