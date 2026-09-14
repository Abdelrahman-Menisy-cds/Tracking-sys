import { useState } from "react";
import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useMockList, formatDateTime } from "../app/useMockList";
import { mockFetch, notifications as seedNotifications, type NotificationMock } from "../mock/data";
import { EmptyState, ErrorState, SkeletonRows } from "../components/ui";
import PageHeader from "../components/layout/PageHeader";

export default function NotificationsPage() {
  const { t, locale } = useApp(); usePageTitle(t("notificationsTitle")); const list = useMockList(() => mockFetch(seedNotifications), []); const [items, setItems] = useState<NotificationMock[] | null>(null); const data = items ?? seedNotifications;
  const markRead = (id: string) => setItems(data.map((notification) => notification.id === id ? { ...notification, is_read: true, read_at: new Date().toISOString() } : notification));
  return <div className="page"><PageHeader title={t("notificationsTitle")} subtitle={locale === "ar" ? `${data.length} إشعارات · تحديث تجريبي` : `${data.length} notifications · demo data`} />{list.phase === "loading" && <SkeletonRows rows={3} />}{list.phase === "error" && <ErrorState onRetry={list.retry} />}{list.phase === "empty" && <EmptyState message={t("noNotifications")} />}{list.phase === "ready" && (data.length === 0 ? <EmptyState message={t("noNotifications")} /> : <div className="work-surface"><ul className="compact-list">{data.map((notification) => <li className="compact-row notification-row" key={notification.id}><div><div className="notification-title"><span className={`pill ${notification.is_read ? "pill-neutral" : "pill-info"}`}>{notification.is_read ? t("read") : t("unread")}</span><strong>{notification.title[locale]}</strong></div><p><bdi>{notification.body[locale]}</bdi></p><div className="muted">{formatDateTime(notification.created_at, locale)}{notification.related_object && !notification.related_object.available && <> · {t("relatedRecord")}: {t("relatedUnavailable")}</>}</div></div>{!notification.is_read && <button className="btn btn-secondary" onClick={() => markRead(notification.id)}>{t("markRead")}</button>}{notification.related_object?.available && <Link className="btn btn-secondary" to={`/requests/${notification.related_object.id}`}>{locale === "ar" ? "فتح السجل" : "Open record"}</Link>}</li>)}</ul></div>)}</div>;
}
