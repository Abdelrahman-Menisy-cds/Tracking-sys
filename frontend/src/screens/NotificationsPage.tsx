import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { formatDateTime } from "../app/format";
import { useServerData } from "../app/useServerData";
import { listNotifications, setNotificationRead } from "../app/notificationsApi";
import type { ServerNotification } from "../app/serverTypes";
import { Banner, EmptyState, ErrorState, SkeletonRows, StatusPill } from "../components/ui";
import PageHeader from "../components/layout/PageHeader";

/**
 * Brief H33 - the notifications page asks the server (GET /notifications;
 * the backend scopes every row to the caller). The only mutation the
 * contract exposes is the READ STATE (PATCH /notifications/{id}/read-state):
 * the old client-side «remove»/«clear» never existed server-side and would
 * resurrect on the next load, so they are gone rather than faked.
 */
export default function NotificationsPage() {
  const { t, locale } = useApp();
  const list = useServerData<ServerNotification[]>(() => listNotifications(locale).then((payload) => payload.data), [locale]);
  const [items, setItems] = useState<ServerNotification[] | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<number | null>(null);
  usePageTitle(t("notificationsTitle"));

  const notifications = items ?? (list.phase === "ready" ? list.data : []);

  useEffect(() => {
    if (list.phase === "ready") setItems(list.data);
  }, [list]);

  useEffect(() => {
    if (!listRef.current) return;
    if (list.phase === "loading") return;
    if (!(notifications.length > 0)) pageRef.current?.focus();
  }, [list.phase, notifications.length]);

  const markRead = async (id: number) => {
    setMarkingId(id);
    setReadError(null);
    try {
      await setNotificationRead(id, true, locale);
      // The server decided; the local copy adopts exactly its answer.
      setItems((current) => (current ?? []).map((notification) => (notification.id === id
        ? { ...notification, is_read: true, read_at: new Date().toISOString() }
        : notification)));
    } catch {
      setReadError(locale === "ar" ? "تعذّر تسجيل الإشعار كمقروء. أعد المحاولة." : "Could not mark the notification read. Try again.");
    } finally {
      setMarkingId(null);
    }
  };

  const hasNotifications = notifications.length > 0;

  return (
    <div className="page" ref={pageRef}>
      <PageHeader
        title={t("notificationsTitle")}
        subtitle={locale === "ar" ? `${notifications.length} إشعارات` : `${notifications.length} notifications`}
      />
      {readError ? <Banner tone="error" role="alert">{readError}</Banner> : null}
      {list.phase === "loading" ? <SkeletonRows rows={3} /> : null}
      {list.phase === "error" ? <ErrorState onRetry={list.retry} /> : null}
      {list.phase === "ready" && !hasNotifications ? (
        <EmptyState message={t("noNotifications")} action={<Link className="btn btn-secondary" to="/">{t("navHome")}</Link>} />
      ) : null}
      {list.phase === "ready" && hasNotifications ? (
        <div className="work-surface" ref={gridRef}>
          <ul className="compact-list" ref={listRef} tabIndex={-1}>
            {notifications.map((notification) => {
              const title = notification.title;
              const available = notification.related_object?.type === "request" && notification.related_object.available;
              return (
                <li className={`compact-row notification-row${available ? " notification-row--link" : ""}`} key={notification.id}>
                  <div>
                    <div className="notification-title">
                      <StatusPill tone={notification.is_read ? "neutral" : "unread"} label={notification.is_read ? t("read") : t("unread")} icon={notification.is_read ? "approved" : "unread"} />
                      {available ? (
                        <Link
                          className="notification-title-link"
                          to={`/requests/${notification.related_object!.id}`}
                          aria-label={`${t("openRelatedRecord")}: ${title}`}
                          onKeyDown={(event) => {
                            if (event.key === " ") {
                              event.preventDefault();
                              event.currentTarget.click();
                            }
                          }}
                        >
                          <strong>{title}</strong>
                        </Link>
                      ) : <strong>{title}</strong>}
                    </div>
                    <p><bdi>{notification.body}</bdi></p>
                    <div className="muted">{formatDateTime(notification.created_at, locale)}{notification.related_object && !notification.related_object.available ? <> · {t("relatedRecord")}: {t("relatedUnavailable")}</> : null}</div>
                  </div>
                  <div className="notification-actions">
                    <div className="row-actions" aria-label={locale === "ar" ? "إجراءات الإشعار" : "Notification actions"}>
                      <div className="row-action-slot">
                        {!notification.is_read ? (
                          <button
                            className="btn btn-secondary"
                            type="button"
                            disabled={markingId === notification.id}
                            onClick={() => void markRead(notification.id)}
                          >
                            {markingId === notification.id ? t("saving") : t("markRead")}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
