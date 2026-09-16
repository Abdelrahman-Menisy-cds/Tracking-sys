import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { formatDateTime, useMockList } from "../app/useMockList";
import { mockFetch } from "../mock/data";
import { EmptyState, ErrorState, SkeletonRows, StatusPill } from "../components/ui";
import PageHeader from "../components/layout/PageHeader";

export default function NotificationsPage() {
  const { t, locale, notificationItems, markNotificationRead } = useApp();
  const list = useMockList(() => mockFetch(notificationItems), [notificationItems]);
  usePageTitle(t("notificationsTitle"));

  return (
    <div className="page">
      <PageHeader title={t("notificationsTitle")} subtitle={locale === "ar" ? `${notificationItems.length} إشعارات · بيانات تجريبية غير دائمة` : `${notificationItems.length} notifications · non-persistent demo data`} />
      {list.phase === "loading" ? <SkeletonRows rows={3} /> : null}
      {list.phase === "error" ? <ErrorState onRetry={list.retry} /> : null}
      {list.phase === "empty" ? <EmptyState message={t("noNotifications")} action={<Link className="btn btn-secondary" to="/">{t("navHome")}</Link>} /> : null}
      {list.phase === "ready" ? notificationItems.length === 0 ? <EmptyState message={t("noNotifications")} action={<Link className="btn btn-secondary" to="/">{t("navHome")}</Link>} /> : (
        <div className="work-surface">
          <ul className="compact-list">
            {notificationItems.map((notification) => (
              <li className="compact-row notification-row" key={notification.id}>
                <div>
                  <div className="notification-title">
                    <StatusPill tone={notification.is_read ? "neutral" : "unread"} label={notification.is_read ? t("read") : t("unread")} icon={notification.is_read ? "approved" : "unread"} />
                    <strong>{notification.title[locale]}</strong>
                  </div>
                  <p><bdi>{notification.body[locale]}</bdi></p>
                  <div className="muted">{formatDateTime(notification.created_at, locale)}{notification.related_object && !notification.related_object.available ? <> · {t("relatedRecord")}: {t("relatedUnavailable")}</> : null}</div>
                </div>
                <div className="row-actions" aria-label={locale === "ar" ? "إجراءات الإشعار" : "Notification actions"}>
                  {!notification.is_read ? <button className="btn btn-secondary" onClick={() => markNotificationRead(notification.id)}>{t("markRead")}</button> : null}
                  {notification.related_object?.available ? <Link className="btn btn-secondary" to={`/requests/${notification.related_object.id}`}>{locale === "ar" ? "فتح السجل" : "Open record"}</Link> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
