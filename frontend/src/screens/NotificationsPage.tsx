import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { formatDateTime, useMockList } from "../app/useMockList";
import { mockFetch } from "../mock/data";
import { Banner, EmptyState, ErrorState, SkeletonRows, StatusPill } from "../components/ui";
import PageHeader from "../components/layout/PageHeader";
import { TrashIcon } from "../components/icons";

export default function NotificationsPage() {
  const {
    t,
    locale,
    notificationItems,
    markNotificationRead,
    removeNotification,
    clearNotifications,
  } = useApp();
  const list = useMockList(() => mockFetch(notificationItems), [notificationItems]);
  const [confirmClear, setConfirmClear] = useState(false);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const focusAfterRemoveRef = useRef<string | null>(null);
  usePageTitle(t("notificationsTitle"));

  useEffect(() => {
    if (confirmClear) window.setTimeout(() => confirmationRef.current?.focus(), 0);
  }, [confirmClear]);

  useEffect(() => {
    if (!focusAfterRemoveRef.current || list.phase === "loading") return;
    const targetId = focusAfterRemoveRef.current;
    focusAfterRemoveRef.current = null;
    window.setTimeout(() => {
      const target = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(".notification-remove") ?? [])]
        .find((button) => button.dataset.notificationId === targetId);
      (target ?? listRef.current ?? pageRef.current)?.focus();
    }, 0);
  }, [list.phase, notificationItems]);

  const removeOne = (id: string) => {
    const currentIndex = notificationItems.findIndex((notification) => notification.id === id);
    const remaining = notificationItems.filter((notification) => notification.id !== id);
    focusAfterRemoveRef.current = remaining[currentIndex]?.id ?? remaining[currentIndex - 1]?.id ?? "__page__";
    removeNotification(id);
  };

  const hasNotifications = notificationItems.length > 0;
  const clearAction = hasNotifications ? (
    <button className="btn btn-danger" type="button" onClick={() => setConfirmClear(true)}>
      <TrashIcon size={17} />
      {t("clearNotifications")}
    </button>
  ) : undefined;

  return (
    <div className="page" ref={pageRef}>
      <PageHeader
        title={t("notificationsTitle")}
        subtitle={locale === "ar" ? `${notificationItems.length} إشعارات · بيانات تجريبية غير دائمة` : `${notificationItems.length} notifications · non-persistent demo data`}
        primaryAction={clearAction}
      />
      {confirmClear && hasNotifications ? (
        <div ref={confirmationRef} className="notification-confirmation" tabIndex={-1}>
          <Banner tone="warning" role="alert">
            <p>{t("confirmClearNotifications")}</p>
            <div className="form-actions">
              <button className="btn btn-danger" type="button" onClick={() => { clearNotifications(); setConfirmClear(false); }}>
                {t("confirmClear")}
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => setConfirmClear(false)}>
                {t("cancel")}
              </button>
            </div>
          </Banner>
        </div>
      ) : null}
      {list.phase === "loading" ? <SkeletonRows rows={3} /> : null}
      {list.phase === "error" ? <ErrorState onRetry={list.retry} /> : null}
      {list.phase === "empty" ? <EmptyState message={t("noNotifications")} action={<Link className="btn btn-secondary" to="/">{t("navHome")}</Link>} /> : null}
      {list.phase === "ready" ? notificationItems.length === 0 ? <EmptyState message={t("noNotifications")} action={<Link className="btn btn-secondary" to="/">{t("navHome")}</Link>} /> : (
        <div className="work-surface">
          <ul className="compact-list" ref={listRef} tabIndex={-1}>
            {notificationItems.map((notification) => {
              const title = notification.title[locale];
              return (
                <li className="compact-row notification-row" key={notification.id}>
                  <div>
                    <div className="notification-title">
                      <StatusPill tone={notification.is_read ? "neutral" : "unread"} label={notification.is_read ? t("read") : t("unread")} icon={notification.is_read ? "approved" : "unread"} />
                      <strong>{title}</strong>
                    </div>
                    <p><bdi>{notification.body[locale]}</bdi></p>
                    <div className="muted">{formatDateTime(notification.created_at, locale)}{notification.related_object && !notification.related_object.available ? <> · {t("relatedRecord")}: {t("relatedUnavailable")}</> : null}</div>
                  </div>
                  <div className="notification-actions">
                    <div className="row-actions" aria-label={locale === "ar" ? "إجراءات الإشعار" : "Notification actions"}>
                      <div className="row-action-slot">
                        {!notification.is_read ? <button className="btn btn-secondary" type="button" onClick={() => markNotificationRead(notification.id)}>{t("markRead")}</button> : null}
                      </div>
                      <div className="row-action-slot">
                        {notification.related_object?.available ? <Link className="btn btn-secondary" to={`/requests/${notification.related_object.id}`}>{locale === "ar" ? "فتح السجل" : "Open record"}</Link> : null}
                      </div>
                    </div>
                    <button
                      className="btn btn-danger icon-button notification-remove"
                      type="button"
                      data-notification-id={notification.id}
                      aria-label={`${t("removeNotificationNamed")}${title}`}
                      title={`${t("removeNotificationNamed")}${title}`}
                      onClick={() => removeOne(notification.id)}
                    >
                      <TrashIcon size={18} />
                    </button>
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
