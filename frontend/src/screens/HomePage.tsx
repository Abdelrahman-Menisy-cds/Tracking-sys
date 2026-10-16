import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useServerData } from "../app/useServerData";
import { formatDateTime, weekInterval } from "../app/format";
import { listMyRequests, listReviewRequests } from "../app/requestsApi";
import { listMyTimesheets, listReviewTimesheets } from "../app/timesheetsApi";
import { listNotifications } from "../app/notificationsApi";
import type { ServerNotification, ServerMyTimesheet } from "../app/serverTypes";
import { EmptyState, ErrorState, RequestStatusPill, SkeletonRows, StatusPill, TimesheetStatusPill } from "../components/ui";
import { AlertTriangleIcon, BellIcon, CalendarIcon, ClockIcon, DocumentIcon, PlusIcon, PlayIcon } from "../components/icons";
import PageHeader from "../components/layout/PageHeader";

function splitContextTitle(title: string) {
  const parts = title.split(" - ");
  if (parts.length < 2) return { title, meta: null };
  return { title: parts[0], meta: parts.slice(1).join(" - ") };
}

export default function HomePage() {
  const { t, locale, serverAccount, capabilities } = useApp();
  usePageTitle(t("homeTitle"));
  /* Every dashboard summary reads the SERVER's own scope - no client tenant,
     no fixture rows; an empty queue is an honest empty card. */
  const requestState = useServerData(() => listMyRequests(locale).then((payload) => payload.data), [locale]);
  const timesheetState = useServerData(() => listMyTimesheets(locale).then((payload) => payload.data), [locale]);
  const notificationState = useServerData(() => listNotifications(locale).then((payload) => payload.data), [locale]);
  const reviewRequestsState = useServerData(() => listReviewRequests(locale, { status: "PENDING_MANAGER" }).then((payload) => payload.data), [locale]);
  const reviewTimesheetsState = useServerData(() => listReviewTimesheets(locale, { status: "SUBMITTED" }).then((payload) => payload.data), [locale]);
  const reviewQueue = capabilities.canReview ? { requests: reviewRequestsState, timesheets: reviewTimesheetsState } : null;
  const notifications: ServerNotification[] = notificationState.phase === "ready" ? notificationState.data : [];
  const attentionRequests = requestState.phase === "ready"
    ? requestState.data.filter((request) => ["RETURNED", "DRAFT"].includes(request.status))
    : [];
  const reviewRequestCount = reviewQueue?.requests.phase === "ready" ? reviewQueue.requests.data.length : null;
  const reviewTimesheetCount = reviewQueue?.timesheets.phase === "ready" ? reviewQueue.timesheets.data.length : null;
  const currentWeek: ServerMyTimesheet | null = timesheetState.phase === "ready" ? timesheetState.data[0] ?? null : null;
  const loading = requestState.phase === "loading" || timesheetState.phase === "loading";
  const reviewLoading = reviewQueue?.requests.phase === "loading" || reviewQueue?.timesheets.phase === "loading";
  const retryPersonal = () => { if (requestState.phase === "error") requestState.retry(); if (timesheetState.phase === "error") timesheetState.retry(); };
  const unreadCount = notifications.filter((notification) => !notification.is_read).length;
  const totalNotifications = notifications.length;

  return (
    <div className="page home-page">
      <PageHeader title={t("homeTitle")} subtitle={<>{t("homeWelcome")}, <bdi>{serverAccount?.full_name ?? "-"}</bdi> · {locale === "ar" ? "فترة العمل الحالية" : "Current work period"}: <bdi>{currentWeek ? weekInterval(currentWeek.week_start, locale) : "-"}</bdi></>} primaryAction={<><Link className="btn btn-primary" to="/requests/new"><PlusIcon />{t("newRequest")}</Link><Link className="btn btn-secondary" to="/timesheets"><ClockIcon />{t("openTimesheet")}</Link></>} />
      {attentionRequests.length > 0 && <section className="attention-strip" aria-label={locale === "ar" ? "يحتاج إلى انتباه" : "Needs attention"}><AlertTriangleIcon /><div><strong>{locale === "ar" ? "يحتاج إلى انتباه" : "Needs your attention"}</strong><span>{locale === "ar" ? "لديك عمل مُعاد أو مسودة يمكنك متابعتها." : "You have returned work or a draft to continue."}</span></div><Link className="btn btn-secondary btn-compact" to="/requests">{locale === "ar" ? "متابعة الطلبات" : "Review requests"}</Link></section>}
      <div className="dashboard-grid">
        <section className="section" aria-labelledby="my-work-heading">
          <div className="section-heading"><h2 id="my-work-heading"><DocumentIcon />{locale === "ar" ? `العمل الشخصي · ${attentionRequests.length}` : `My work · ${attentionRequests.length}`}</h2><Link to="/requests">{t("viewAll")}</Link></div>
          {loading ? <SkeletonRows rows={2} /> : requestState.phase === "error" || timesheetState.phase === "error" ? <ErrorState onRetry={retryPersonal} /> : attentionRequests.length === 0 ? <EmptyState message={t("noRequestsYet")} action={<Link className="btn btn-secondary" to="/requests">{t("viewAll")}</Link>} /> : <div className="work-surface"><ul className="compact-list">{attentionRequests.map((request) => {
            const split = splitContextTitle(request.title);
            const openRequestLabel = locale === "ar" ? `فتح الطلب: ${split.title}` : `Open request: ${split.title}`;
            return <li key={request.id} className="compact-row"><div><Link to={`/requests/${request.id}`}><strong><bdi>{split.title}</bdi></strong></Link>{split.meta ? <div className="muted"><bdi>{split.meta}</bdi></div> : null}<div className="muted">{request.status === "RETURNED" ? (locale === "ar" ? "مطلوب تصحيح" : "Correction required") : t("draft")}</div></div><Link className="actionable-pill" to={`/requests/${request.id}`} aria-label={openRequestLabel}><RequestStatusPill status={request.status} /></Link></li>;
          })}</ul></div>}
        </section>
        {currentWeek && <section className="section" aria-labelledby="week-heading">
          <div className="section-heading"><h2 id="week-heading"><CalendarIcon />{locale === "ar" ? "الأسبوع الحالي" : "Current week"}</h2><Link to="/timesheets">{t("openTimesheet")}</Link></div>
          {/* The list endpoint carries no entry totals; the card renders what
              is confirmed (status + interval) and leaves the numbers open. */}
          <div className="work-surface week-card"><div className="status-action-row"><div><strong>{t("week")}: {weekInterval(currentWeek.week_start, locale)}</strong><div className="muted">{locale === "ar" ? "الهدف الأسبوعي: 40 ساعة · المنطقة الزمنية: القاهرة" : "Weekly target: 40 h · timezone: Cairo"}</div></div><TimesheetStatusPill status={currentWeek.status} /></div><div className="week-progress-meta"><strong>{t("openTimesheet")}</strong></div></div>
        </section>}
      </div>
      {capabilities.canReview && reviewQueue && <section className="section" aria-labelledby="review-heading"><div className="section-heading"><h2 id="review-heading"><PlayIcon />{t("homeTeamQueue")} · {(reviewRequestCount ?? 0) + (reviewTimesheetCount ?? 0)}</h2><Link to="/reviews">{t("viewAll")}</Link></div><div className="work-surface">{reviewLoading ? <SkeletonRows rows={1} /> : reviewQueue.requests.phase === "error" ? <ErrorState onRetry={reviewQueue.requests.retry} /> : reviewQueue.timesheets.phase === "error" ? <ErrorState onRetry={reviewQueue.timesheets.retry} /> : <><p className="muted">{locale === "ar" ? "المرؤوسون المباشرون النشطون فقط · ترتيب المراجعة محدد." : "Active direct reports only · queue order is deterministic."}</p><div className="summary-strip"><div className="summary-item"><span className="summary-value"><bdi dir="ltr">{reviewRequestCount ?? 0}</bdi></span><span className="summary-label">{t("reviewRequests")}</span></div><div className="summary-item"><span className="summary-value"><bdi dir="ltr">{reviewTimesheetCount ?? 0}</bdi></span><span className="summary-label">{t("reviewTimesheets")}</span></div></div></>}</div></section>}
      <section className="section" aria-labelledby="recent-notifications"><div className="section-heading"><h2 id="recent-notifications"><BellIcon />{t("homeRecentNotifications")} · {totalNotifications}</h2><Link to="/notifications">{t("viewAll")}</Link></div>{notificationState.phase === "loading" ? <SkeletonRows rows={2} /> : notificationState.phase === "error" ? <ErrorState onRetry={notificationState.retry} /> : notifications.length === 0 ? <EmptyState message={t("noNotifications")} action={<Link className="btn btn-secondary" to="/notifications">{t("viewAll")}</Link>} /> : <div className="work-surface"><ul className="compact-list">{notifications.slice(0, 3).map((notification) => <li className="compact-row" key={notification.id}><div><strong><bdi>{notification.title}</bdi></strong><div className="muted">{formatDateTime(notification.created_at, locale)}</div></div><StatusPill tone={notification.is_read ? "neutral" : "unread"} label={notification.is_read ? t("read") : t("unread")} icon={notification.is_read ? "approved" : "unread"} /></li>)}</ul>{unreadCount > 0 ? <p className="summary-context">{locale === "ar" ? `${unreadCount} غير مقروءة` : `${unreadCount} unread`}</p> : null}</div>}</section>
    </div>
  );
}
