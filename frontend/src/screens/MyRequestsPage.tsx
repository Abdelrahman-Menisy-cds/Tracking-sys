import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useServerData } from "../app/useServerData";
import { formatDateTime } from "../app/format";
import { listMyRequests } from "../app/requestsApi";
import type { RequestStatusType, ServerMyRequest } from "../app/serverTypes";
import { Banner, EmptyState, ErrorState, RequestStatusPill, SkeletonRows } from "../components/ui";
import OperationalTable, { type OperationalColumn } from "../components/data/OperationalTable";
import PageHeader from "../components/layout/PageHeader";
import { FilterIcon, PlusIcon } from "../components/icons";

function nextStage(request: ServerMyRequest, locale: "ar" | "en") {
  const ar = locale === "ar";
  if (request.status === "DRAFT" || request.status === "RETURNED") return ar ? "أنت — حفظ أو إرسال" : "You — save or submit";
  if (request.status === "PENDING_MANAGER") return ar ? "مراجعة المدير" : "Manager review";
  if (request.status === "PENDING_HR") return ar ? "مراجعة الموارد البشرية" : "HR review";
  return ar ? "لا يوجد إجراء مطلوب" : "No action required";
}

export default function MyRequestsPage() {
  const { t, locale } = useApp(); const navigate = useNavigate(); const [params, setParams] = useSearchParams();
  const statusFilter = params.get("status") ?? "all";
  const list = useServerData(() => listMyRequests(locale).then((payload) => payload.data), [locale]);
  usePageTitle(t("myRequestsTitle"));
  const rows = list.phase === "ready" ? list.data : [];
  const filtered = statusFilter === "all" ? rows : rows.filter((request) => request.status === statusFilter);
  const setFilter = (value: string) => { const next = new URLSearchParams(params); if (value === "all") next.delete("status"); else next.set("status", value); setParams(next); };
  const labels = { next: locale === "ar" ? "الخطوة التالية" : "Next stage", submitted: locale === "ar" ? "الإرسال" : "Submitted", action: locale === "ar" ? "الإجراء" : "Action" };
  const columns: OperationalColumn<ServerMyRequest>[] = [
    { key: "request", label: t("requestTitle"), render: (request) => <div><Link to={`/requests/${request.id}`}><bdi>{request.title}</bdi></Link><div className="muted"><bdi>{request.request_type.name}</bdi></div></div> },
    { key: "status", label: t("status"), render: (request) => <RequestStatusPill status={request.status} /> },
    { key: "next", label: labels.next, render: (request) => nextStage(request, locale) },
    /* The server does not expose submitted_at on the requester's own list, so
       the cell is honest: a draft says so, and everything else renders an
       empty marker rather than a fabricated date. */
    { key: "submitted", label: labels.submitted, render: (request) => request.status === "DRAFT" ? t("draft") : <span className="muted">—</span> },
    { key: "updated", label: t("lastUpdate"), render: (request) => formatDateTime(request.updated_at, locale) },
    { key: "action", label: labels.action, render: (request) => request.status === "DRAFT" || request.status === "RETURNED" ? <Link to={`/requests/${request.id}`}>{locale === "ar" ? "متابعة" : "Continue"}</Link> : <span className="muted">—</span> },
  ];
  return <div className="page"><PageHeader title={t("myRequestsTitle")} subtitle={locale === "ar" ? "نطاق العمل الشخصي" : "Personal scope"} primaryAction={<button className="btn btn-primary" onClick={() => navigate("/requests/new")}><PlusIcon />{t("newRequest")}</button>} />
    {list.phase === "loading" && <SkeletonRows rows={4} />}{list.phase === "error" && <ErrorState onRetry={list.retry} />}
    {list.phase === "ready" && <>
      <div className="filter-panel page-filter-panel">
        <div className="filter-toolbar"><label className="field"><span className="field-label"><FilterIcon />{t("status")}</span><select className="select" value={statusFilter} onChange={(event) => setFilter(event.target.value)}><option value="all">{t("taskFilterAllStatuses")}</option>{(["DRAFT", "PENDING_MANAGER", "PENDING_HR", "APPROVED", "RETURNED", "REJECTED", "CANCELLED"] as RequestStatusType[]).map((status) => <option key={status} value={status}>{status === "DRAFT" ? t("stDraft") : status === "PENDING_MANAGER" ? t("stPendingManager") : status === "PENDING_HR" ? t("stPendingHr") : status === "APPROVED" ? t("stApproved") : status === "RETURNED" ? t("stReturned") : status === "REJECTED" ? t("stRejected") : t("stCancelled")}</option>)}</select></label></div>
        {statusFilter !== "all" && <div className="applied-filters tasks-filter-chips" aria-label={t("taskFiltersApplied")}><span className="filter-chip">{t("status")}<button type="button" className="tasks-chip-remove" aria-label={t("taskFilterRemove").replace("%s", t("status"))} onClick={() => setFilter("all")}>×</button></span><button type="button" className="btn btn-secondary" onClick={() => setFilter("all")}>{t("taskFiltersClearAll")}</button></div>}
        <p className="page-meta tasks-result-count" role="status">{t("taskFiltersShowing").replace("%s", String(filtered.length)).replace("%s", String(rows.length))}</p>
      </div>
      {filtered.length === 0 ? <EmptyState message={rows.length === 0 ? t("noRequestsYet") : t("noRequestsFiltered")} action={rows.length === 0 ? <button className="btn btn-primary" onClick={() => navigate("/requests/new")}><PlusIcon />{t("newRequest")}</button> : <button className="btn btn-secondary" onClick={() => setFilter("all")}>{t("taskFiltersClearAll")}</button>} /> : <OperationalTable caption={locale === "ar" ? `${filtered.length} سجل في نطاقك الشخصي` : `${filtered.length} records in your personal scope`} columns={columns} records={filtered} />}
    </>}
  </div>;
}

/**
 * The new-request form. HONEST STATE (Brief H33): the contract's draft
 * endpoint needs a request_type_id, and the backend exposes NO endpoint that
 * lists the organisation's request types (the tool exists only inside the
 * assistant chat). Nothing is invented client-side: the type picker renders
 * its honest empty state, every field stays disabled, and the page says
 * exactly what is missing and what still works.
 */
export function NewRequestPage() {
  const { t, locale } = useApp(); const navigate = useNavigate();
  usePageTitle(t("newRequest"));
  const blocked = locale === "ar"
    ? "هذه الصفحة بانتظار الربط: نقطة |request-types| غير متاحة من الخادم بعد، فلا يمكن اختيار نوع طلب حقيقي أو إنشاء المسودة. البدل المتاح الآن: اطلب من مدام عفاف (المساعد) إنشاء الطلب نيابةً عنك."
    : "This screen is waiting on its wiring: no request-types endpoint exists server-side yet, so a real type cannot be picked and no draft can be created. For now, ask مدام عفاف (the assistant) to raise the request on your behalf.";
  const noTypes = locale === "ar"
    ? "قائمة أنواع الطلبات تصل من الخادم لاحقًا؛ لا يوجد نوع حقيقي للاختيار الآن."
    : "The request-types list arrives from the server later; there is no real type to pick yet.";
  const waitingTitle = locale === "ar" ? "بانتظار قائمة أنواع الطلبات من الخادم" : "Waiting on the server's request-types list";
  const dateField = (id: string, label: string, min?: string) => <label className="field"><span className="field-label">{label}</span><input id={id} className="input" type="date" dir="ltr" lang={locale} disabled title={waitingTitle} min={min || undefined} onChange={() => undefined} /></label>;
  const timeField = (id: string, label: string) => <label className="field"><span className="field-label">{label}</span><input id={id} className="input" type="time" dir="ltr" disabled title={waitingTitle} onChange={() => undefined} /></label>;
  const typeField = <div className="field type-field"><span className="field-label" id="request-type-label">{t("requestType")}</span><EmptyState message={noTypes} /></div>;
  const periodField = <fieldset className="quiet-inset field request-inset" disabled><legend className="field-label">{t("requestPeriod")}</legend>
    <div className="request-period-row">
      {dateField("request-period", t("requestPeriodFrom"))}
      {dateField("request-period-end", t("requestPeriodTo"))}
      {timeField("request-clock", t("requestPeriodFromTime"))}
      {timeField("request-clock-end", t("requestPeriodToTime"))}
    </div>
  </fieldset>;
  const reasonId = "request-reason-text";
  return <div className="page reading-page new-request-page"><PageHeader title={t("newRequest")} subtitle={t("newRequestSubtitle")} breadcrumb={<Link to="/requests">{t("myRequestsTitle")}</Link>} primaryAction={<span className="page-meta new-request-steps" aria-hidden="true">{t("newRequestSteps")}</span>} />
    <Banner tone="warning" role="alert" >{blocked}</Banner>
    <form className="work-surface" noValidate onSubmit={(event) => event.preventDefault()}>
      {typeField}
      {periodField}
      <label className="field"><span className="field-label">{t("requestReasonOptional")}</span><textarea id={reasonId} className="textarea" name="details" rows={3} maxLength={500} disabled title={waitingTitle} placeholder={t("requestReasonPlaceholder")} onChange={() => undefined} aria-describedby="reason-hint" /><span className="field-hint" id="reason-hint">{t("requestReasonHint")}</span></label>
      <label className="field request-attachments-field"><span className="field-label">{t("attachments")}</span>
        <span className="file-placeholder">{t("attachmentsDemo")}</span>
        <input type="file" disabled aria-hidden="true" aria-label={t("attachmentsDemo")} className="file-input-hidden" tabIndex={-1} />
      </label>
      <div className="form-actions request-stick-actions">
        <button className="btn btn-primary" type="button" disabled title={waitingTitle}>{t("submitRequest")}</button>
        <button className="btn btn-secondary" type="button" disabled title={waitingTitle}>{t("saveDraft")}</button>
        <button className="btn btn-ghost" type="button" onClick={() => navigate("/requests")}>{t("back")}</button>
      </div>
    </form>
  </div>;
}
