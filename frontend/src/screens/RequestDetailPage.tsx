import { Link, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useMockList, formatDateTime } from "../app/useMockList";
import { mockFetch, pickName, type RequestMock } from "../mock/data";
import { Banner, EmptyState, ErrorState, RequestStatusPill, SkeletonRows } from "../components/ui";
import Timeline from "../components/record/Timeline";
import PageHeader from "../components/layout/PageHeader";

function nextStage(status: string, locale: "ar" | "en") { if (status === "RETURNED") return locale === "ar" ? "أنت — صحح ثم أرسل" : "You — correct and submit"; if (status === "PENDING_MANAGER") return locale === "ar" ? "مراجعة المدير" : "Manager review"; if (status === "PENDING_HR") return locale === "ar" ? "مراجعة الموارد البشرية" : "HR review"; return locale === "ar" ? "لا يوجد إجراء مطلوب" : "No action required"; }
function correctionReason(events: { action: string; comment: string }[]) { return [...events].reverse().find((event) => event.action === "RETURN")?.comment; }

export default function RequestDetailPage() {
  const { id } = useParams(); const { t, locale, myRequestItems } = useApp(); usePageTitle(t("details"));
  // Personal detail resolves only from the personal, already-scoped query.
  // Never merge review data into this route: an unknown/out-of-scope ID gets
  // the same neutral response as a missing record.
  const state = useMockList<RequestMock | null>(() => mockFetch(myRequestItems.find((request) => request.id === id) ?? null, 250), [id, myRequestItems]);
  if (state.phase === "loading") return <SkeletonRows rows={3} />; if (state.phase === "error") return <ErrorState onRetry={state.retry} />; const request = state.phase === "ready" ? state.data : null;
  if (!request) return <div className="page"><PageHeader title={t("details")} /><Banner tone="warning" role="alert">{t("relatedUnavailable")}</Banner><Link to="/requests">{t("back")}</Link></div>;
  const reason = correctionReason(request.events);
  return <div className="page"><PageHeader title={<bdi>{request.title}</bdi>} subtitle={`${pickName(request.request_type.name, locale)} · ${t("requester")}: ${pickName(request.requester_name, locale)}`} breadcrumb={<Link to="/requests">{t("myRequestsTitle")}</Link>} />
    <div className="record-header"><div className="record-header-main"><div className="record-meta"><span>{t("requestType")}: {pickName(request.request_type.name, locale)}</span><span>{t("lastUpdate")}: {formatDateTime(request.updated_at, locale)}</span><span dir="ltr" translate="no">ID: <bdi>{request.id}</bdi></span></div><RequestStatusPill status={request.status} /></div><div className="status-action-block"><div className="status-action-row"><strong>{locale === "ar" ? "الخطوة التالية" : "Next stage"}</strong><span>{nextStage(request.status, locale)}</span></div>{reason && <p>{locale === "ar" ? "سبب الإعادة:" : "Correction reason:"} <bdi>{reason}</bdi></p>}{(request.status === "RETURNED" || request.status === "DRAFT") && <Link className="btn btn-primary" to="/requests/new">{locale === "ar" ? "متابعة التصحيح" : "Continue correction"}</Link>}</div></div>
    <section className="work-surface section" aria-labelledby="request-details"><h2 id="request-details">{t("requestDetails")}</h2><p className="preserve-lines"><bdi>{request.details}</bdi></p></section>
    <section className="work-surface section" aria-labelledby="request-attachments"><h2 id="request-attachments">{t("attachments")}</h2>{request.attachments.length === 0 ? <EmptyState message={t("noAttachments")} action={<span className="muted">{t("attachmentsNote")}</span>} /> : <ul className="attachment-list">{request.attachments.map((attachment) => <li className="attachment-row" key={attachment.id}><bdi dir="ltr">{attachment.original_filename}</bdi><span className="muted">{attachment.declared_content_type} · {Math.round(attachment.size_bytes / 1024)} KB · {attachment.scan_status === "clean" ? (locale === "ar" ? "فحص سليم" : "Scan clean") : attachment.scan_status === "pending" ? (locale === "ar" ? "بانتظار الفحص" : "Awaiting scan") : (locale === "ar" ? "محجوز؛ الملف غير متاح" : "Quarantined; file unavailable")}</span></li>)}</ul>}</section>
    <section className="section" aria-labelledby="request-history"><h2 id="request-history">{t("history")}</h2><Timeline events={request.events} /></section>
  </div>;
}
