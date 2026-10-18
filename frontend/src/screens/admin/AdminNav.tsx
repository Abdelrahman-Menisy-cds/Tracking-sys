import { NavLink } from "react-router-dom";
import { useApp } from "../../app/AppContext";

/**
 * Admin suite sub-navigation (spec §0.1 navigation model).
 * Real routed links (not a tablist) so each area is deep-linkable; renders
 * on every sub-page. `aria-current="page"` marks the active item.
 *
 * NavLink writes `aria-current="page"` on the active link itself, and the
 * stylesheet's current-item rule keys on exactly that attribute - so the routed
 * sub-nav and the rail agree on how "current" is spelled, and the active area is
 * actually visible. Marking a nested <span> instead (as this used to) left the
 * item looking inactive, so the rail's section link was the only highlight on
 * screen.
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
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
