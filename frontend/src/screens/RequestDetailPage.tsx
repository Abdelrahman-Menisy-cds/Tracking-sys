/** S04 — Request detail: header, details, attachments, append-only history. */
import { Link, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useMockList, formatDateTime } from "../app/useMockList";
import { mockFetch, myRequests, teamRequests, pickName } from "../mock/data";
import { Banner, ErrorState, RequestStatusPill, SkeletonRows } from "../components/ui";

export default function RequestDetailPage() {
  const { id } = useParams();
  const { t, locale } = useApp();
  usePageTitle(t("details"));

  const all = [...myRequests, ...teamRequests];
  const state = useMockList(() => mockFetch(all.find((r) => r.id === id) ?? null, 250), [id]);

  if (state.phase === "loading") return <SkeletonRows rows={3} />;
  if (state.phase === "error") return <ErrorState onRetry={state.retry} />;
  const request = state.phase === "ready" ? state.data : null;

  if (!request) {
    return (
      <>
        <h1>{t("details")}</h1>
        <Banner tone="warning" role="alert">
          {t("relatedUnavailable")}
        </Banner>
        <Link to="/requests">{t("back")}</Link>
      </>
    );
  }

  return (
    <>
      <nav aria-label={t("back")}>
        <Link to="/requests">← {t("myRequestsTitle")}</Link>
      </nav>
      <header style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "12px 0" }}>
        <h1 style={{ margin: 0 }}>
          <bdi>{request.title}</bdi>
        </h1>
        <RequestStatusPill status={request.status} />
      </header>
      <p style={{ color: "var(--text-muted)" }}>
        {t("requestType")}: {pickName(request.request_type.name, locale)} · {t("requester")}:{" "}
        <bdi>{pickName(request.requester_name, locale)}</bdi> · ID: <bdi dir="ltr">{request.id}</bdi>
      </p>

      <section className="card" aria-labelledby="req-details">
        <h2 id="req-details">{t("requestDetails")}</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>
          <bdi>{request.details}</bdi>
        </p>
      </section>

      <section className="card" aria-labelledby="req-atts">
        <h2 id="req-atts">{t("attachments")}</h2>
        {request.attachments.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>{t("noAttachments")}</p>
        ) : (
          <ul>
            {request.attachments.map((a) => (
              <li key={a.id}>
                <bdi dir="ltr">{a.original_filename}</bdi>{" "}
                <span style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  ({Math.round(a.size_bytes / 1024)} KB ·{" "}
                  {a.scan_status === "clean"
                    ? locale === "ar"
                      ? "فحص سليم"
                      : "scan clean"
                    : a.scan_status}{" "}
                  · {formatDateTime(a.created_at, locale)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="req-history">
        <h2 id="req-history">{t("history")}</h2>
        <ol style={{ paddingInlineStart: 20 }}>
          {request.events.map((ev) => (
            <li key={ev.id} style={{ marginBottom: 8 }}>
              <strong>{ev.action}</strong> {ev.from_status ? `(${ev.from_status} → ${ev.to_status})` : `→ ${ev.to_status}`}{" "}
              — <bdi>{ev.actor}</bdi>
              <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
                {formatDateTime(ev.created_at, locale)}
              </div>
              {ev.comment && (
                <div style={{ marginInlineStart: 8 }}>
                  <bdi>{ev.comment}</bdi>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
