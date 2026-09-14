/** S10 — Notifications: read/unread with text label (not color-only), mark-read, safe unavailable links. */
import { useState } from "react";
import { useApp, usePageTitle } from "../app/AppContext";
import { useMockList, formatDateTime } from "../app/useMockList";
import { mockFetch, notifications as seedNotifications, type NotificationMock } from "../mock/data";
import { Banner, EmptyState, ErrorState, SkeletonRows } from "../components/ui";

export default function NotificationsPage() {
  const { t, locale } = useApp();
  const list = useMockList(() => mockFetch(seedNotifications), []);
  usePageTitle(t("notificationsTitle"));
  const [items, setItems] = useState<NotificationMock[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const data = items ?? seedNotifications;

  const markRead = (id: string) => {
    // Demo only: local state change; real mark-read is a server mutation with retry.
    setItems(data.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)));
    setReadError(null);
  };

  return (
    <>
      <h1>{t("notificationsTitle")}</h1>
      {list.phase === "loading" && <SkeletonRows rows={3} />}
      {list.phase === "error" && <ErrorState onRetry={list.retry} />}
      {list.phase === "empty" && <EmptyState message={t("noNotifications")} />}
      {list.phase === "ready" &&
        (data.length === 0 ? (
          <EmptyState message={t("noNotifications")} />
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {data.map((n) => (
              <li key={n.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <span className={`pill ${n.is_read ? "pill-neutral" : "pill-info"}`}>
                      {n.is_read ? t("read") : t("unread")}
                    </span>{" "}
                    <strong>{n.title[locale]}</strong>
                    <p style={{ margin: "4px 0" }}>
                      <bdi>{n.body[locale]}</bdi>
                    </p>
                    <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
                      {formatDateTime(n.created_at, locale)}
                    </div>
                    {n.related_object && !n.related_object.available && (
                      <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--text-muted)" }}>
                        {t("relatedRecord")}: {t("relatedUnavailable")}
                      </p>
                    )}
                  </div>
                  {!n.is_read && (
                    <button className="btn btn-secondary" onClick={() => markRead(n.id)}>
                      {t("markRead")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ))}
      {readError && (
        <Banner tone="error" role="alert">
          {readError}
        </Banner>
      )}
    </>
  );
}
