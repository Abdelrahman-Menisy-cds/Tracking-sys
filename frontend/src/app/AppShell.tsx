/**
 * App shell: skip link, nav rail (capability-scoped per demo role), header with
 * language / appearance / role controls, notifications link, demo banner.
 * Navigation mirrors capability scoping: Team reviews only for manager/HR demo roles.
 */
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useApp, type Appearance } from "./AppContext";
import type { Role } from "../i18n/dict";

const brandMark = (
  <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
    {/* Original composed-clipboard mark: rounded clipboard, three orderly marks, one wandering violet slip */}
    <rect x="6" y="5" width="24" height="27" rx="4" fill="none" stroke="currentColor" strokeWidth="2.4" />
    <rect x="12" y="2" width="12" height="6" rx="2" fill="currentColor" />
    <line x1="11" y1="15" x2="25" y2="15" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    <line x1="11" y1="20" x2="25" y2="20" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    <line x1="11" y1="25" x2="21" y2="25" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    <rect x="24" y="27" width="8" height="6" rx="1.5" fill="#6d28d9" transform="rotate(-8 28 30)" />
  </svg>
);

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

  return (
    <>
      <a href="#main-content" style={{ position: "absolute", insetInlineStart: -9999, top: 0 }}>
        {t("skipToMain")}
      </a>
      <div className="demo-banner" role="note">
        ⚠ {t("demoLabel")}
      </div>
      <div className="app-shell">
        <nav className={`app-rail ${drawerOpen ? "open" : ""}`} aria-label={t("menu")}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px 16px" }}>
            {brandMark}
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>
                <bdi>{t("brand")}</bdi>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("descriptor")}</div>
            </div>
          </div>
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
          <div style={{ marginTop: "auto", fontSize: 13, color: "var(--text-muted)" }}>
            {t("tagline")}
          </div>
        </nav>

        {drawerOpen && (
          <div
            style={{ position: "fixed", inset: 0, background: "rgb(0 0 0 / 0.4)", zIndex: 35 }}
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
        )}

        <div className="app-main">
          <header className="app-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                className="btn btn-secondary menu-toggle"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen((v) => !v)}
              >
                ☰ {t("menu")}
              </button>
            </div>
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
              <button className="btn btn-secondary" onClick={() => navigate("/login")}>
                {t("signOut")}
              </button>
            </div>
          </header>
          <main id="main-content">
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
}
