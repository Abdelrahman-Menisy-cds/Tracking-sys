import { NavLink } from "react-router-dom";
import { useApp } from "../../app/AppContext";

/**
 * Admin suite sub-navigation (spec §0.1 navigation model).
 * Real routed links (not a tablist) so each area is deep-linkable; renders
 * on every sub-page. `aria-current="page"` marks the active item.
 */
export default function AdminNav() {
  const { t } = useApp();
  const items = [
    { to: "/admin", label: t("adminNavOverview"), end: true },
    { to: "/admin/settings", label: t("adminNavSettings"), end: false },
    { to: "/admin/people", label: t("adminNavPeople"), end: false },
    { to: "/admin/announcements", label: t("adminNavAnnouncements"), end: false },
  ];
  return (
    <nav className="review-tabs admin-subnav" aria-label={t("adminNavLabel")}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }: { isActive: boolean }) => `review-tab${isActive ? " is-current" : ""}`}
        >
          {({ isActive }: { isActive: boolean }) => (
            <span aria-current={isActive ? "page" : undefined}>{item.label}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
