/** S02 — Role-scoped home: stat cards, activity feed, pending queue. */
import { Link } from "react-router-dom";
import { useApp } from "../app/AppContext";
import { useMockList, formatDateTime } from "../app/useMockList";
import { demoUser, mockFetch, myRequests, myTimesheets, teamRequests, teamTimesheets, notifications } from "../mock/data";
import { Banner, RequestStatusPill, SkeletonRows, TimesheetStatusPill } from "../components/ui";

export default function HomePage() {
  const { t, locale, role } = useApp();
  const user = demoUser[role];

  const reqState = useMockList(() => mockFetch(myRequests), []);
  const tsState = useMockList(() => mockFetch(myTimesheets), []);
  const teamReqState = useMockList(() => mockFetch(teamRequests), []);
  const teamTsState = useMockList(() => mockFetch(teamTimesheets), []);
  const notifState = useMockList(() => mockFetch(notifications), []);

  const pendingMine = myRequests.filter((r) => r.status === "PENDING_MANAGER" || r.status === "PENDING_HR" || r.status === "RETURNED");
  const pendingTeam = [...teamRequests, ...teamTimesheets].length;
  const currentWeek = myTimesheets[0];

  return (
    <>
      <header className="page-header">
        <div>
          <span className="page-eyebrow">{t("homeTitle")}</span>
          <h1>
            {t("homeWelcome")}, <bdi>{user.name[locale]}</bdi>
          </h1>
          <p style={{ color: "var(--text-muted)", margin: 0 }}>
            {role === "employee" ? t("roleEmployee") : role === "manager" ? t("roleManager") : t("roleHr")}
          </p>
        </div>
        <Link className="btn btn-primary" to="/requests/new">
          + {t("newRequest")}
        </Link>
      </header>

      <div className="card-grid">
        <div className="card">
          <h2>{t("homeMyRequests")}</h2>
          {reqState.phase === "loading" ? (
            <SkeletonRows rows={1} />
          ) : reqState.phase === "error" ? (
            <Banner tone="error" role="alert">{t("errorNetwork")}</Banner>
          ) : (
            <p className="stat-value num">{pendingMine.length}</p>
          )}
          <Link className="card-link" to="/requests">
            {t("navMyRequests")} →
          </Link>
        </div>

        <div className="card">
          <h2>{t("homeTimesheetStatus")}</h2>
          {tsState.phase === "loading" ? (
            <SkeletonRows rows={1} />
          ) : tsState.phase === "error" ? (
            <Banner tone="error" role="alert">{t("errorNetwork")}</Banner>
          ) : currentWeek ? (
            <>
              <div style={{ marginBottom: "var(--sp-2)" }}>
                <TimesheetStatusPill status={currentWeek.status} />
              </div>
              <p style={{ margin: "0 0 var(--sp-2)", color: "var(--text-muted)", fontSize: 14 }}>
                {t("weekStart")}: <bdi dir="ltr">{currentWeek.week_start}</bdi>
              </p>
            </>
          ) : null}
          <Link className="card-link" to="/timesheets">
            {t("openTimesheet")} →
          </Link>
        </div>

        {(role === "manager" || role === "hr") && (
          <div className="card">
            <h2>{t("homeTeamQueue")}</h2>
            {teamReqState.phase === "loading" || teamTsState.phase === "loading" ? (
              <SkeletonRows rows={1} />
            ) : teamReqState.phase === "error" || teamTsState.phase === "error" ? (
              <Banner tone="error" role="alert">{t("errorNetwork")}</Banner>
            ) : (
              <p className="stat-value num">{pendingTeam}</p>
            )}
            <Link className="card-link" to="/reviews">
              {t("navTeamReviews")} →
            </Link>
          </div>
        )}
      </div>

      <section aria-labelledby="recent-notifs">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 id="recent-notifs">{t("homeRecentNotifications")}</h2>
          <Link className="card-link" to="/notifications">
            {t("viewAll")}
          </Link>
        </div>
        {notifState.phase === "loading" ? (
          <SkeletonRows rows={2} />
        ) : notifState.phase === "error" ? (
          <Banner tone="error" role="alert">{t("errorNetwork")}</Banner>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {notifications.slice(0, 3).map((n) => (
              <li key={n.id} className="card" style={{ padding: "var(--sp-3) var(--sp-4)" }}>
                <strong>{n.title[locale]}</strong>
                <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  {formatDateTime(n.created_at, locale)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pending-mine" style={{ marginTop: "var(--sp-6)" }}>
        <h2 id="pending-mine">{t("homePendingRequests")}</h2>
        {reqState.phase === "loading" ? (
          <SkeletonRows rows={2} />
        ) : reqState.phase === "error" ? (
          <Banner tone="error" role="alert">{t("errorNetwork")}</Banner>
        ) : pendingMine.length === 0 ? (
          <Banner tone="neutral">{t("noRequestsYet")}</Banner>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {pendingMine.map((r) => (
              <li key={r.id} className="card" style={{ padding: "var(--sp-3) var(--sp-4)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <Link to={`/requests/${r.id}`}>
                    <bdi>{r.title}</bdi>
                  </Link>
                  <RequestStatusPill status={r.status} />
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  {t("submittedAt")}: {r.submitted_at ? formatDateTime(r.submitted_at, locale) : "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
