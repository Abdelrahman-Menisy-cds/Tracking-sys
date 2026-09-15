import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { formatDateTime, useMockList } from "../app/useMockList";
import { mockFetch } from "../mock/data";
import { EmptyState, ErrorState, SkeletonRows } from "../components/ui";
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
      {list.phase === "empty" ? <EmptyState message={t("noNotifications")} /> : null}
      {list.phase === "ready" ? notificationItems.length === 0 ? <EmptyState message={t("noNotifications")} /> : (
        <div className="work-surface">
          <ul className="compact-list">
            {notificationItems.map((notification) => (
              <li className="compact-row notification-row" key={notification.id}>
                <div>
                  <div className="notification-title">
                    <span className={`pill ${notification.is_read ? "pill-neutral" : "pill-info"}`}>{notification.is_read ? t("read") : t("unread")}</span>
                    <strong>{notification.title[locale]}</strong>
                  </div>
                  <p><bdi>{notification.body[locale]}</bdi></p>
                  <div className="muted">{formatDateTime(notification.created_at, locale)}{notification.related_object && !notification.related_object.available ? <> · {t("relatedRecord")}: {t("relatedUnavailable")}</> : null}</div>
                </div>
                {!notification.is_read ? <button className="btn btn-secondary" onClick={() => markNotificationRead(notification.id)}>{t("markRead")}</button> : null}
                {notification.related_object?.available ? <Link className="btn btn-secondary" to={`/requests/${notification.related_object.id}`}>{locale === "ar" ? "فتح السجل" : "Open record"}</Link> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
