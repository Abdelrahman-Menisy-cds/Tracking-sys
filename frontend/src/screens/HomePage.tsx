import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useMockList, formatDateTime, formatMinutes, weekInterval } from "../app/useMockList";
import { demoUser, mockFetch } from "../mock/data";
import { EmptyState, ErrorState, RequestStatusPill, SkeletonRows, StatusPill, TimesheetStatusPill } from "../components/ui";
import { AlertTriangleIcon, BellIcon, CalendarIcon, ClockIcon, DocumentIcon, PlusIcon, PlayIcon } from "../components/icons";
import PageHeader from "../components/layout/PageHeader";

const WEEKLY_TARGET_MINUTES = 40 * 60;

function splitContextTitle(title: string) {
  const parts = title.split(" — ");
  if (parts.length < 2) return { title, meta: null };
  return { title: parts[0], meta: parts.slice(1).join(" — ") };
}

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
  const retryPersonal = () => { if (requestState.phase === "error") requestState.retry(); if (timesheetState.phase === "error") timesheetState.retry(); };
  const retryReview = () => { if (teamRequestState.phase === "error") teamRequestState.retry(); if (teamTimesheetState.phase === "error") teamTimesheetState.retry(); };
  const unreadCount = notificationItems.filter((notification) => !notification.is_read).length;
  const totalNotifications = notificationItems.length;
  const weekMinutes = currentWeek?.entries.reduce((sum, entry) => sum + entry.duration_minutes, 0) ?? 0;
  const breakMinutes = currentWeek?.entries.reduce((sum, entry) => sum + entry.unpaid_break_minutes, 0) ?? 0;
  const weekProgress = Math.min(100, Math.round((weekMinutes / WEEKLY_TARGET_MINUTES) * 100));
  const weekDelta = weekMinutes - WEEKLY_TARGET_MINUTES;
  const weekDeltaLabel = weekDelta >= 0
    ? (locale === "ar" ? `زائد ${formatMinutes(weekDelta, locale)}` : `${formatMinutes(weekDelta, locale)} over`)
    : (locale === "ar" ? `متبقي ${formatMinutes(Math.abs(weekDelta), locale)}` : `${formatMinutes(Math.abs(weekDelta), locale)} remaining`);

  return (
    <div className="page home-page">
      <PageHeader title={t("homeTitle")} subtitle={<>{t("homeWelcome")}, <bdi>{user.name[locale]}</bdi> · {locale === "ar" ? "فترة العمل الحالية" : "Current work period"}: <bdi>{currentWeek ? weekInterval(currentWeek.week_start, locale) : "—"}</bdi></>} primaryAction={<><Link className="btn btn-primary" to="/requests/new"><PlusIcon />{t("newRequest")}</Link><Link className="btn btn-secondary" to="/timesheets"><ClockIcon />{t("openTimesheet")}</Link></>} />
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
          <div className="work-surface week-card"><div className="status-action-row"><div><strong>{t("week")}: {weekInterval(currentWeek.week_start, locale)}</strong><div className="muted">{locale === "ar" ? "الهدف الأسبوعي: 40 ساعة · المنطقة الزمنية: القاهرة" : "Weekly target: 40 h · timezone: Cairo"}</div></div><TimesheetStatusPill status={currentWeek.status} /></div><div className="week-progress" aria-label={locale === "ar" ? "تقدم الأسبوع نحو هدف 40 ساعة" : "Weekly progress toward 40 hour target"}><div className="week-progress-track"><span style={{ inlineSize: `${weekProgress}%` }} /></div><div className="week-progress-meta"><strong>{weekProgress}%</strong><span>{weekDeltaLabel}</span></div></div><div className="summary-strip"><div className="summary-item"><span className="summary-label">{t("totalHours")}</span><span className="summary-value">{formatMinutes(weekMinutes, locale)}</span><span className="summary-context">{locale === "ar" ? "من 40 ساعة" : "of 40 h target"}</span></div><div className="summary-item"><span className="summary-label">{t("breakTime")}</span><span className="summary-value">{formatMinutes(breakMinutes, locale)}</span><span className="summary-context">{locale === "ar" ? "غير مدفوعة ضمن هذا الأسبوع" : "unpaid this week"}</span></div></div></div>
        </section>}
      </div>
      {capabilities.canReview && <section className="section" aria-labelledby="review-heading"><div className="section-heading"><h2 id="review-heading"><PlayIcon />{t("homeTeamQueue")} · {(reviewRequestCount ?? 0) + (reviewTimesheetCount ?? 0)}</h2><Link to="/reviews">{t("viewAll")}</Link></div><div className="work-surface">{reviewLoading ? <SkeletonRows rows={1} /> : reviewError ? <ErrorState onRetry={retryReview} /> : <><p className="muted">{locale === "ar" ? "المرؤوسون المباشرون النشطون فقط · ترتيب المراجعة محدد." : "Active direct reports only · queue order is deterministic."}</p><div className="summary-strip"><div className="summary-item"><span className="summary-value">{reviewRequestCount}</span><span className="summary-label">{t("reviewRequests")}</span></div><div className="summary-item"><span className="summary-value">{reviewTimesheetCount}</span><span className="summary-label">{t("reviewTimesheets")}</span></div></div></>}</div></section>}
      <section className="section" aria-labelledby="recent-notifications"><div className="section-heading"><h2 id="recent-notifications"><BellIcon />{t("homeRecentNotifications")} · {totalNotifications}</h2><Link to="/notifications">{t("viewAll")}</Link></div>{notificationState.phase === "loading" ? <SkeletonRows rows={2} /> : notificationState.phase === "error" ? <ErrorState onRetry={notificationState.retry} /> : notificationItems.length === 0 ? <EmptyState message={t("noNotifications")} action={<Link className="btn btn-secondary" to="/notifications">{t("viewAll")}</Link>} /> : <div className="work-surface"><ul className="compact-list">{notificationItems.slice(0, 3).map((notification) => <li className="compact-row" key={notification.id}><div><strong>{notification.title[locale]}</strong><div className="muted">{formatDateTime(notification.created_at, locale)}</div></div><StatusPill tone={notification.is_read ? "neutral" : "unread"} label={notification.is_read ? t("read") : t("unread")} icon={notification.is_read ? "approved" : "unread"} /></li>)}</ul>{unreadCount > 0 ? <p className="summary-context">{locale === "ar" ? `${unreadCount} غير مقروءة` : `${unreadCount} unread`}</p> : null}</div>}</section>
    </div>
  );
}
