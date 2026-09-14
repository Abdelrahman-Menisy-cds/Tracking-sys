/** S02 — Role-scoped home: own summaries + team review summary for manager/HR demo roles. */
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
      <h1>{t("homeTitle")}</h1>
      <p style={{ color: "var(--text-muted)" }}>
        {t("homeWelcome")}, <bdi>{user.name[locale]}</bdi> ({t(role === "employee" ? "roleEmployee" : role === "manager" ? "roleManager" : "roleHr")})
      </p>

      <div className="card-grid">
        <div className="card">
          <h2>{t("homeMyRequests")}</h2>
          {reqState.phase === "loading" ? (
            <SkeletonRows rows={1} />
          ) : reqState.phase === "error" ? (
            <Banner tone="error" role="alert">{t("errorNetwork")}</Banner>
          ) : (
            <p style={{ fontSize: 36, fontWeight: 700, margin: 0 }}>{pendingMine.length}</p>
          )}
          <Link to="/requests">{t("navMyRequests")} →</Link>
        </div>

        <div className="card">
          <h2>{t("homeTimesheetStatus")}</h2>
          {tsState.phase === "loading" ? (
            <SkeletonRows rows={1} />
          ) : tsState.phase === "error" ? (
            <Banner tone="error" role="alert">{t("errorNetwork")}</Banner>
          ) : currentWeek ? (
            <>
              <TimesheetStatusPill status={currentWeek.status} />
              <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 14 }}>
                {t("weekStart")}: {currentWeek.week_start}
              </p>
            </>
          ) : null}
          <div style={{ marginTop: 8 }}>
            <Link to="/timesheets">{t("openTimesheet")} →</Link>
          </div>
        </div>

        {(role === "manager" || role === "hr") && (
          <div className="card">
            <h2>{t("homeTeamQueue")}</h2>
            {teamReqState.phase === "loading" || teamTsState.phase === "loading" ? (
              <SkeletonRows rows={1} />
            ) : teamReqState.phase === "error" || teamTsState.phase === "error" ? (
              <Banner tone="error" role="alert">{t("errorNetwork")}</Banner>
            ) : (
              <p style={{ fontSize: 36, fontWeight: 700, margin: 0 }}>{pendingTeam}</p>
            )}
            <Link to="/reviews">{t("navTeamReviews")} →</Link>
          </div>
        )}
      </div>

      <section aria-labelledby="recent-notifs">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 id="recent-notifs">{t("homeRecentNotifications")}</h2>
          <Link to="/notifications">{t("viewAll")}</Link>
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

      <section aria-labelledby="pending-mine" style={{ marginTop: 24 }}>
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
