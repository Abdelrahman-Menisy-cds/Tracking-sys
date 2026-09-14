/**
 * App shell: skip link, brand lockup, nav rail (capability-scoped per demo role),
 * header with language / appearance / role controls, demo banner.
 * Navigation mirrors capability scoping: Team reviews only for manager/HR demo roles.
 */
import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useApp, type Appearance } from "./AppContext";
import { Brand } from "../components/brand";
import type { Role } from "../i18n/dict";

export default function AppShell() {
  const { t, locale, setLocale, role, setRole, appearance, setAppearance } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();

  const canReview = role === "manager" || role === "hr";

  const navItems = [
    { to: "/", label: t("navHome"), end: true },
    { to: "/requests", label: t("navMyRequests") },
    { to: "/timesheets", label: t("navMyTimesheets") },
    ...(canReview ? [{ to: "/reviews", label: t("navTeamReviews") }] : []),
    { to: "/notifications", label: t("navNotifications") },
  ];

  const roleOptions: { value: Role; label: string }[] = [
    { value: "employee", label: t("roleEmployee") },
    { value: "manager", label: t("roleManager") },
    { value: "hr", label: t("roleHr") },
  ];

  const appearanceOptions: { value: Appearance; label: string }[] = [
    { value: "system", label: t("appearanceSystem") },
    { value: "light", label: t("appearanceLight") },
    { value: "dark", label: t("appearanceDark") },
  ];

  /* Close the mobile drawer whenever the route changes. */
  useEffect(() => {
    const handler = () => setDrawerOpen(false);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  return (
    <>
      <a href="#main-content" className="skip-link">
        {t("skipToMain")}
      </a>
      <div className="demo-banner" role="note">
        ⚠ <bdi>{t("demoLabel")}</bdi>
      </div>
      <div className="app-shell">
        <nav className={`app-rail ${drawerOpen ? "open" : ""}`} aria-label={t("menu")}>
          <Brand />
          <div className="nav-label">{t("menu")}</div>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="nav-link"
              aria-current="page"
              onClick={() => setDrawerOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
          <div
            style={{
              marginTop: "auto",
              fontSize: 13,
              color: "var(--text-faint)",
              padding: "var(--sp-3)",
            }}
          >
            <bdi>{t("tagline")}</bdi>
          </div>
        </nav>

        {drawerOpen && (
          <div
            style={{ position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 35 }}
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
        )}

        <div className="app-main">
          <header className="app-header">
            <button
              className="btn btn-secondary btn-compact menu-toggle"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen((v) => !v)}
            >
              ☰ {t("menu")}
            </button>
            <div className="header-actions">
              {/* Demo role switch — explicit demo affordance, labelled as such */}
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 14 }}>{t("demoRoleSwitch")}</span>
                <select
                  className="select"
                  style={{ width: "auto", minHeight: 36 }}
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value as Role);
                    navigate("/");
                  }}
                >
                  {roleOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 14 }}>{t("language")}</span>
                <select
                  className="select"
                  style={{ width: "auto", minHeight: 36 }}
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as "ar" | "en")}
                >
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 14 }}>{t("appearance")}</span>
                <select
                  className="select"
                  style={{ width: "auto", minHeight: 36 }}
                  value={appearance}
                  onChange={(e) => setAppearance(e.target.value as Appearance)}
                >
                  {appearanceOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn btn-secondary btn-compact" onClick={() => navigate("/login")}>
                {t("signOut")}
              </button>
            </div>
          </header>
          <main id="main-content" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
}
