import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useMockList, formatDateTime, formatMinutes } from "../app/useMockList";
import { demoUser, mockFetch } from "../mock/data";
import { Banner, RequestStatusPill, SkeletonRows, TimesheetStatusPill } from "../components/ui";

export default function HomePage() {
  const { t, locale, role, capabilities, myRequestItems, myTimesheetItems, teamRequestItems, teamTimesheetItems, notificationItems } = useApp();
  const user = demoUser[role];
  usePageTitle(t("homeTitle"));
  const requestState = useMockList(() => mockFetch(myRequestItems), [myRequestItems]);
  const timesheetState = useMockList(() => mockFetch(myTimesheetItems), [myTimesheetItems]);
  const teamRequestState = useMockList(() => mockFetch(teamRequestItems), [teamRequestItems]);
  const teamTimesheetState = useMockList(() => mockFetch(teamTimesheetItems), [teamTimesheetItems]);
  const notificationState = useMockList(() => mockFetch(notificationItems), [notificationItems]);
  const attentionRequests = requestState.phase === "ready"
    ? requestState.data.filter((request) => ["RETURNED", "DRAFT"].includes(request.status))
    : [];
  const reviewRequestCount = teamRequestState.phase === "ready"
    ? teamRequestState.data.filter((request) => request.status === "PENDING_MANAGER").length
    : null;
  const reviewTimesheetCount = teamTimesheetState.phase === "ready"
    ? teamTimesheetState.data.filter((sheet) => sheet.status === "SUBMITTED").length
    : null;
  const currentWeek = timesheetState.phase === "ready" ? timesheetState.data[0] : null;
  const loading = requestState.phase === "loading" || timesheetState.phase === "loading";
  const reviewLoading = teamRequestState.phase === "loading" || teamTimesheetState.phase === "loading";
  const reviewError = teamRequestState.phase === "error" || teamTimesheetState.phase === "error";

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-copy"><h1>{t("homeTitle")}</h1><p className="page-meta">{t("homeWelcome")}, <bdi>{user.name[locale]}</bdi> · {locale === "ar" ? "عملك الشخصي" : "Personal work"}</p></div>
        <div className="page-actions"><Link className="btn btn-primary" to="/requests/new">{t("newRequest")}</Link><Link className="btn btn-secondary" to="/timesheets">{t("openTimesheet")}</Link></div>
      </header>
      {attentionRequests.length > 0 && <section className="attention-strip" aria-label={locale === "ar" ? "يحتاج إلى انتباه" : "Needs attention"}><div><strong>{locale === "ar" ? "يحتاج إلى انتباه" : "Needs your attention"}</strong><span>{locale === "ar" ? "لديك عمل مُعاد أو مسودة يمكنك متابعتها." : "You have returned work or a draft to continue."}</span></div></section>}
      <section className="section" aria-labelledby="my-work-heading"><div className="section-heading"><h2 id="my-work-heading">{locale === "ar" ? "العمل الشخصي" : "My work"}</h2><Link to="/requests">{t("viewAll")}</Link></div>{loading ? <SkeletonRows rows={2} /> : requestState.phase === "error" || timesheetState.phase === "error" ? <Banner tone="error" role="alert">{t("errorNetwork")}</Banner> : <div className="work-surface"><ul className="compact-list">{attentionRequests.map((request) => <li key={request.id} className="compact-row"><div><Link to={`/requests/${request.id}`}><strong><bdi>{request.title}</bdi></strong></Link><div className="muted">{request.status === "RETURNED" ? (locale === "ar" ? "مطلوب تصحيح" : "Correction required") : t("draft")}</div></div><RequestStatusPill status={request.status} /></li>)}{attentionRequests.length === 0 && <li>{t("noRequestsYet")}</li>}</ul></div>}</section>
      {currentWeek && <section className="section" aria-labelledby="week-heading"><div className="section-heading"><h2 id="week-heading">{locale === "ar" ? "الأسبوع الحالي" : "Current week"}</h2><Link to="/timesheets">{t("openTimesheet")}</Link></div><div className="work-surface"><div className="status-action-row"><div><strong>{t("week")}: <bdi dir="ltr">{currentWeek.week_start}</bdi></strong><div className="muted">{locale === "ar" ? "المنطقة الزمنية للمؤسسة: القاهرة" : "Organization timezone: Cairo"}</div></div><TimesheetStatusPill status={currentWeek.status} /></div><div className="summary-strip"><div className="summary-item"><span className="summary-label">{t("totalHours")}</span><span className="summary-value">{formatMinutes(currentWeek.entries.reduce((sum, entry) => sum + entry.duration_minutes, 0), locale)}</span></div><div className="summary-item"><span className="summary-label">{t("breakTime")}</span><span className="summary-value">{formatMinutes(currentWeek.entries.reduce((sum, entry) => sum + entry.unpaid_break_minutes, 0), locale)}</span></div></div></div></section>}
      {capabilities.canReview && <section className="section" aria-labelledby="review-heading"><div className="section-heading"><h2 id="review-heading">{t("homeTeamQueue")}</h2><Link to="/reviews">{t("viewAll")}</Link></div><div className="work-surface">{reviewLoading ? <SkeletonRows rows={1} /> : reviewError ? <Banner tone="error" role="alert">{t("errorNetwork")}</Banner> : <><p className="muted">{locale === "ar" ? "المرؤوسون المباشرون النشطون فقط · ترتيب المراجعة محدد." : "Active direct reports only · queue order is deterministic."}</p><div className="summary-strip"><div className="summary-item"><span className="summary-value">{reviewRequestCount}</span><span className="summary-label">{t("reviewRequests")}</span></div><div className="summary-item"><span className="summary-value">{reviewTimesheetCount}</span><span className="summary-label">{t("reviewTimesheets")}</span></div></div></>}</div></section>}
      <section className="section" aria-labelledby="recent-notifications"><div className="section-heading"><h2 id="recent-notifications">{t("homeRecentNotifications")}</h2><Link to="/notifications">{t("viewAll")}</Link></div>{notificationState.phase === "loading" ? <SkeletonRows rows={2} /> : <div className="work-surface"><ul className="compact-list">{notificationItems.slice(0, 3).map((notification) => <li className="compact-row" key={notification.id}><div><strong>{notification.title[locale]}</strong><div className="muted">{formatDateTime(notification.created_at, locale)}</div></div><span className={`pill ${notification.is_read ? "pill-neutral" : "pill-info"}`}>{notification.is_read ? t("read") : t("unread")}</span></li>)}</ul></div>}</section>
    </div>
  );
}
