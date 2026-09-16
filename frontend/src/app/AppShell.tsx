import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useApp, type Appearance, type DemoFixture } from "./AppContext";
import type { Role } from "../i18n/dict";
import BrandLockup from "../components/brand/BrandLockup";
import {
  ActivityIcon,
  BellIcon,
  ChevronDownIcon,
  ClockIcon,
  DocumentIcon,
  HomeIcon,
  LogoutIcon,
  UserIcon,
} from "../components/icons";

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
    appearance,
    setAppearance,
    notificationItems,
    setDemoFixture,
  } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [demoToolsOpen, setDemoToolsOpen] = useState(false);
  const [isCompact, setIsCompact] = useState(() => window.matchMedia("(max-width: 1023px)").matches);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    window.setTimeout(() => menuButtonRef.current?.focus(), 0);
  }, []);

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
    ...(capabilities.canReview
      ? [{ label: locale === "ar" ? "عمل المراجعة" : "Review work", items: [{ to: "/reviews", label: t("navTeamReviews"), icon: ActivityIcon }] }]
      : []),
    {
      label: locale === "ar" ? "التحديثات" : "Updates",
      items: [{ to: "/notifications", label: t("navNotifications"), badge: unreadCount, icon: BellIcon }],
    },
  ];
  const currentLabel = navGroups
    .flatMap((group) => group.items)
    .find((item) => item.to === location.pathname || (item.to !== "/" && location.pathname.startsWith(item.to)))?.label ?? t("navHome");
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
  const appearanceOptions: { value: Appearance; label: string }[] = [
    { value: "system", label: t("appearanceSystem") },
    { value: "light", label: t("appearanceLight") },
    { value: "dark", label: t("appearanceDark") },
  ];

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
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className="nav-link"
                    onClick={() => {
                      if (isCompact) closeDrawer();
                    }}
                  >
                    <Icon />
                    <span>{item.label}</span>
                    {item.badge ? <span className="nav-badge" aria-label={`${item.badge}`}>{item.badge}</span> : null}
                  </NavLink>
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
            <strong>{currentLabel}</strong>
            <div className="header-actions">
              <label className="select-trigger">
                <UserIcon />
                <span className="visually-hidden">{t("language")}</span>
                <select className="select" aria-label={t("language")} value={locale} onChange={(event) => setLocale(event.target.value as "ar" | "en")}>
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className="select-trigger">
                <ChevronDownIcon />
                <span className="visually-hidden">{t("appearance")}</span>
                <select className="select" aria-label={t("appearance")} value={appearance} onChange={(event) => setAppearance(event.target.value as Appearance)}>
                  {appearanceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <button type="button" className="btn btn-secondary" onClick={() => navigate("/login")}><LogoutIcon />{t("signOut")}</button>
            </div>
          </header>
          <main id="main-content"><Outlet /></main>
        </div>
      </div>
    </>
  );
}
