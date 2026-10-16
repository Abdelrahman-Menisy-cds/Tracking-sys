import { Link, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useServerData } from "../app/useServerData";
import { formatDateTime } from "../app/format";
import { getMyRequest, listMyRequestAttachments } from "../app/requestsApi";
import type { ServerMyRequest } from "../app/serverTypes";
import { Banner, EmptyState, ErrorState, RequestStatusPill, SkeletonRows } from "../components/ui";
import PageHeader from "../components/layout/PageHeader";

function nextStage(status: ServerMyRequest["status"], locale: "ar" | "en") { if (status === "RETURNED") return locale === "ar" ? "أنت — صحح ثم أرسل" : "You — correct and submit"; if (status === "PENDING_MANAGER") return locale === "ar" ? "مراجعة المدير" : "Manager review"; if (status === "PENDING_HR") return locale === "ar" ? "مراجعة الموارد البشرية" : "HR review"; return locale === "ar" ? "لا يوجد إجراء مطلوب" : "No action required"; }

/**
 * The requester's own record detail — GET /requests/{id} plus its own
 * attachments endpoint. The server does NOT expose the event trail, a
 * requester_name, or the picked period on this endpoint, so those blocks
 * render their honest states instead of fixture content (Brief H33).
 */
export default function RequestDetailPage() {
  const { id } = useParams(); const { t, locale, serverAccount } = useApp(); usePageTitle(t("details"));
  // Personal detail resolves only from the personal, already-scoped query.
  // Never merge review data into this route: an unknown/out-of-scope ID gets
  // the same neutral response as a missing record.
  const state = useServerData<ServerMyRequest | null>(async () => {
    try {
      return await getMyRequest(id ?? "", locale);
    } catch {
      return null;
    }
  }, [id, locale]);
  const attachments = useServerData(() => (id ? listMyRequestAttachments(id, locale) : Promise.resolve([])), [id, locale]);
  if (state.phase === "loading") return <div className="page"><PageHeader title={t("details")} /><SkeletonRows rows={3} /></div>;
  if (state.phase === "error") return <div className="page"><PageHeader title={t("details")} /><ErrorState onRetry={state.retry} /></div>;
  const request = state.phase === "ready" ? state.data : null;
  if (!request) return <div className="page"><PageHeader title={t("details")} /><Banner tone="warning" role="alert">{t("relatedUnavailable")}</Banner><Link to="/requests">{t("back")}</Link></div>;
  return <div className="page"><PageHeader title={<bdi>{request.title}</bdi>} subtitle={`${request.request_type.name} · ${t("requester")}: ${serverAccount?.full_name ?? (locale === "ar" ? "أنت" : "you")}`} breadcrumb={<Link to="/requests">{t("myRequestsTitle")}</Link>} />
    <div className="work-surface record-header"><div className="record-header-main"><div className="record-meta"><span>{t("requestType")}: <bdi>{request.request_type.name}</bdi></span><span>{t("lastUpdate")}: {formatDateTime(request.updated_at, locale)}</span><span dir="ltr" translate="no">ID: <bdi>{request.id}</bdi></span></div><RequestStatusPill status={request.status} /></div><div className="status-action-block"><div className="status-action-row"><strong>{locale === "ar" ? "الخطوة التالية" : "Next stage"}</strong><span>{nextStage(request.status, locale)}</span></div>{(request.status === "RETURNED" || request.status === "DRAFT") && <Link className="btn btn-primary" to="/requests/new">{locale === "ar" ? "متابعة التصحيح" : "Continue correction"}</Link>}</div></div>
    <section className="work-surface section" aria-labelledby="request-details"><h2 id="request-details">{t("requestReason")}</h2><p className="preserve-lines"><bdi>{request.details}</bdi></p></section>
    <section className="work-surface section" aria-labelledby="request-attachments"><h2 id="request-attachments">{t("attachments")}</h2>
      {attachments.phase === "loading" ? <SkeletonRows rows={1} /> : attachments.phase === "error" ? <ErrorState onRetry={attachments.retry} /> : attachments.data.length === 0 ? <EmptyState message={t("noAttachments")} action={<span className="muted">{t("attachmentsNote")}</span>} /> : <ul className="attachment-list">{attachments.data.map((attachment) => <li className="attachment-row" key={attachment.id}><bdi dir="ltr">{attachment.original_filename}</bdi><span className="muted">{attachment.content_type} · {Math.round(attachment.size_bytes / 1024)} KB · {attachment.scan_status === "clean" ? (locale === "ar" ? "فحص سليم" : "Scan clean") : attachment.scan_status === "pending" ? (locale === "ar" ? "بانتظار الفحص" : "Awaiting scan") : (locale === "ar" ? "محجوز؛ الملف غير متاح" : "Quarantined; file unavailable")}</span></li>)}</ul>}
    </section>
    <section className="work-surface section" aria-labelledby="request-history"><h2 id="request-history">{t("history")}</h2><EmptyState message={locale === "ar" ? "لا يتوفر سجل الأحداث من الخادم لهذا السجل بعد." : "The server does not return an event trail for this record yet."} /></section>
  </div>;
}
