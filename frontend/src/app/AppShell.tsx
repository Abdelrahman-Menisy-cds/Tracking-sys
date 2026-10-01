import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useApp, type Appearance, type DemoFixture } from "./AppContext";
import type { Locale, Role } from "../i18n/dict";
import BrandLockup from "../components/brand/BrandLockup";
import {
  ActivityIcon,
  BellIcon,
  CalendarIcon,
  ChevronDownIcon,
  ClockIcon,
  DocumentIcon,
  GlobeIcon,
  HomeIcon,
  LogoutIcon,
  MoonIcon,
  SunIcon,
  UserIcon,
} from "../components/icons";
import { demoUser } from "../mock/data";
import { ClockAction } from "../screens/AttendancePage";

const FOCUSABLE = 'a[href], button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function AppShell() {
  const {
    t,
    locale,
    setLocale,
    role,
    setRole,
    isDemoMode,
    capabilities,
    resolvedTheme,
    setAppearance,
    notificationItems,
    setDemoFixture,
  } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [demoToolsOpen, setDemoToolsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [isCompact, setIsCompact] = useState(() => window.matchMedia("(max-width: 1023px)").matches);
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
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
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

  const unreadCount = useMemo(
    () => notificationItems.filter((notification) => !notification.is_read).length,
    [notificationItems],
  );
  const navGroups: { label: string; items: { to: string; label: string; end?: boolean; badge?: number; icon: ComponentType }[] }[] = [
    {
      label: locale === "ar" ? "عملي" : "My work",
      items: [
        { to: "/", label: t("navHome"), end: true, icon: HomeIcon },
        { to: "/requests", label: t("navMyRequests"), icon: DocumentIcon },
        { to: "/timesheets", label: t("navMyTimesheets"), icon: ClockIcon },
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
      ? [{ label: locale === "ar" ? "عمل المراجعة" : "Review work", items: [{ to: "/reviews", label: t("navTeamReviews"), icon: ActivityIcon }] }]
      : []),
    ...(capabilities.canSetOrgSchedule && capabilities.canManageLeaveBalance && capabilities.canViewOrgAttendance
      ? [{ label: t("adminTitle"), items: [{ to: "/admin", label: t("adminTitle"), icon: GlobeIcon }] }]
      : []),
  ];
  const matchedCurrentItem = navGroups
    .flatMap((group) => group.items)
    .filter((item) => item.to === location.pathname || (item.to !== "/" && location.pathname.startsWith(item.to)))
    .sort((left, right) => right.to.length - left.to.length)[0];
  const currentItem = matchedCurrentItem ?? { to: "", label: t("navHome"), icon: HomeIcon };
  const roleOptions: { value: Role; label: string }[] = [
    { value: "employee", label: t("roleEmployee") },
    { value: "manager", label: t("roleManager") },
    { value: "hr", label: t("roleHr") },
  ];
  const fixtureOptions: { value: DemoFixture; label: string }[] = [
    { value: "ready", label: locale === "ar" ? "بيانات جاهزة" : "Ready data" },
    { value: "loading", label: t("loading") },
    { value: "empty", label: t("demoStateEmpty") },
    { value: "error", label: t("demoStateError") },
    { value: "conflict", label: locale === "ar" ? "قرار قديم عند التأكيد" : "Stale decision on confirm" },
    { value: "unknown", label: locale === "ar" ? "نتيجة قرار غير معروفة" : "Unknown decision outcome" },
  ];
  const targetLocale: Locale = locale === "en" ? "ar" : "en";
  const targetTheme: Exclude<Appearance, "system"> = resolvedTheme === "light" ? "dark" : "light";
  const ThemeIcon = resolvedTheme === "light" ? SunIcon : MoonIcon;
  const activeUser = demoUser[role];
  const localizedName = activeUser.name[locale as Locale];
  const localizedRole = roleOptions.find((option) => option.value === role)?.label ?? t("roleEmployee");

  return (
    <>
      <a href="#main-content" className="skip-link">{t("skipToMain")}</a>
      <div className="demo-banner" role="note">{t("demoLabel")}</div>
      <div className="app-shell">
        <nav
          ref={railRef}
          id="app-rail-nav"
          className={`app-rail ${drawerOpen ? "open" : ""}`}
          aria-label={t("menu")}
          aria-modal={isCompact && drawerOpen ? true : undefined}
          role={isCompact && drawerOpen ? "dialog" : undefined}
          inert={isCompact && !drawerOpen ? true : undefined}
        >
          <BrandLockup />
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
          {isDemoMode ? (
            <div className="demo-tools">
              <div className="demo-tools-label">{locale === "ar" ? "حدود العرض التجريبي" : "Demo fixture boundary"}</div>
              <button
                type="button"
                className="btn btn-secondary"
                aria-expanded={demoToolsOpen}
                aria-controls="demo-tools-panel"
                onClick={() => setDemoToolsOpen((open) => !open)}
              >
                <ChevronDownIcon />
                {t("demoStatesTitle")}
              </button>
              {demoToolsOpen ? (
                <div className="demo-state-tools" id="demo-tools-panel">
                  <strong>{locale === "ar" ? "هوية وهمية غير موثوقة" : "Non-authoritative fixture identity"}</strong>
                  <span>{locale === "ar" ? "هذه الضوابط تختار بيانات وهمية معزولة لاختبار الواجهة فقط. لا تسجل الدخول ولا تمنح إذنًا ولا تحاكي حماية الخادم، وكل تغيير يختفي بعد إعادة التحميل." : "These controls select isolated mock fixtures for UI review only. They do not sign in, grant permission, or simulate server authorization; every change disappears on reload."}</span>
                  <label>
                    <span>{locale === "ar" ? "هوية الاختبار" : "Fixture identity"}</span>
                    <select
                      className="select"
                      value={role}
                      onChange={(event) => {
                        setRole(event.target.value as Role);
                        navigate("/");
                      }}
                    >
                      {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>{locale === "ar" ? "حالة الصفحة/القرار التالية" : "Next page/decision fixture"}</span>
                    <select className="select" defaultValue="ready" onChange={(event) => setDemoFixture(event.target.value as DemoFixture)}>
                      {fixtureOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <span>{locale === "ar" ? "التعارض والنتيجة غير المعروفة يُستهلكان مرة واحدة عند تأكيد القرار، ولا يعيدان إرسال القرار تلقائيًا." : "Conflict and unknown outcome are consumed once on decision confirmation and never replay the decision automatically."}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </nav>
        {drawerOpen && isCompact ? <button className="drawer-backdrop" tabIndex={-1} aria-label={t("close")} onClick={closeDrawer} /> : null}
        <div className="app-main" ref={mainRef}>
          <header className="app-header">
            <button
              ref={menuButtonRef}
              type="button"
              className="btn btn-secondary menu-toggle"
              aria-expanded={drawerOpen}
              aria-controls="app-rail-nav"
              onClick={() => setDrawerOpen((open) => !open)}
            >
              <ChevronDownIcon />
              {t("menu")}
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
                      <span className="profile-menu-meta">{localizedRole} · <bdi>{activeUser.email}</bdi></span>
                    </div>
                    <button ref={(element) => { profileMenuItemsRef.current[0] = element; }} type="button" className="btn btn-ghost profile-menu-item" role="menuitem" onClick={() => { closeProfileMenu(false); navigate("/profile"); }}>
                      <UserIcon />
                      {t("account")}
                    </button>
                    <button ref={(element) => { profileMenuItemsRef.current[1] = element; }} type="button" className="btn btn-ghost profile-menu-item" role="menuitem" onClick={() => { closeProfileMenu(false); navigate("/login"); }}>
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
    </>
  );
}
