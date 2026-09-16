import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useMockList, formatDateTime } from "../app/useMockList";
import { mockFetch, requestTypes, type RequestMock, type RequestStatus } from "../mock/data";
import { Banner, EmptyState, ErrorState, RequestStatusPill, SkeletonRows } from "../components/ui";
import OperationalTable, { type OperationalColumn } from "../components/data/OperationalTable";
import PageHeader from "../components/layout/PageHeader";
import { CloseIcon, FilterIcon, PlusIcon } from "../components/icons";

function nextStage(request: RequestMock, locale: "ar" | "en") {
  const ar = locale === "ar";
  if (request.status === "DRAFT" || request.status === "RETURNED") return ar ? "أنت — حفظ أو إرسال" : "You — save or submit";
  if (request.status === "PENDING_MANAGER") return ar ? "مراجعة المدير" : "Manager review";
  if (request.status === "PENDING_HR") return ar ? "مراجعة الموارد البشرية" : "HR review";
  return ar ? "لا يوجد إجراء مطلوب" : "No action required";
}
function correctionReason(request: RequestMock) { return [...request.events].reverse().find((event) => event.action === "RETURN")?.comment; }

export default function MyRequestsPage() {
  const { t, locale, myRequestItems } = useApp(); const navigate = useNavigate(); const [params, setParams] = useSearchParams();
  const statusFilter = params.get("status") ?? "all"; const list = useMockList(() => mockFetch(myRequestItems), [myRequestItems]); usePageTitle(t("myRequestsTitle"));
  const filtered = list.phase === "ready" ? statusFilter === "all" ? myRequestItems : myRequestItems.filter((request) => request.status === statusFilter) : [];
  const setFilter = (value: string) => { const next = new URLSearchParams(params); if (value === "all") next.delete("status"); else next.set("status", value); setParams(next); };
  const labels = { next: locale === "ar" ? "الخطوة التالية" : "Next stage", submitted: locale === "ar" ? "الإرسال" : "Submitted", action: locale === "ar" ? "الإجراء" : "Action" };
  const columns: OperationalColumn<RequestMock>[] = [
    { key: "request", label: t("requestTitle"), render: (request) => <div><Link to={`/requests/${request.id}`}><bdi>{request.title}</bdi></Link><div className="muted">{request.request_type.name[locale]}</div>{request.status === "RETURNED" && <div className="correction-reason">{correctionReason(request)}</div>}</div> },
    { key: "status", label: t("status"), render: (request) => <RequestStatusPill status={request.status} /> },
    { key: "next", label: labels.next, render: (request) => nextStage(request, locale) },
    { key: "submitted", label: labels.submitted, render: (request) => request.submitted_at ? formatDateTime(request.submitted_at, locale) : t("draft") },
    { key: "updated", label: t("lastUpdate"), render: (request) => formatDateTime(request.updated_at, locale) },
    { key: "action", label: labels.action, render: (request) => request.status === "DRAFT" || request.status === "RETURNED" ? <Link to={`/requests/${request.id}`}>{locale === "ar" ? "متابعة" : "Continue"}</Link> : <span className="muted">—</span> },
  ];
  return <div className="page"><PageHeader title={t("myRequestsTitle")} subtitle={locale === "ar" ? "نطاق العمل الشخصي · بيانات تجريبية محدثة الآن" : "Personal scope · demo data refreshed now"} primaryAction={<button className="btn btn-primary" onClick={() => navigate("/requests/new")}><PlusIcon />{t("newRequest")}</button>} />
    {list.phase === "loading" && <SkeletonRows rows={4} />}{list.phase === "error" && <ErrorState onRetry={list.retry} />}{list.phase === "empty" && <EmptyState message={t("noRequestsYet")} />}
    {list.phase === "ready" && <><div className="filter-toolbar"><label className="field"><span className="field-label"><FilterIcon />{t("status")}</span><select className="select" value={statusFilter} onChange={(event) => setFilter(event.target.value)}><option value="all">{locale === "ar" ? "كل الحالات" : "All statuses"}</option>{(["DRAFT", "PENDING_MANAGER", "PENDING_HR", "APPROVED", "RETURNED", "REJECTED", "CANCELLED"] as RequestStatus[]).map((status) => <option key={status} value={status}>{status === "DRAFT" ? t("stDraft") : status === "PENDING_MANAGER" ? t("stPendingManager") : status === "PENDING_HR" ? t("stPendingHr") : status === "APPROVED" ? t("stApproved") : status === "RETURNED" ? t("stReturned") : status === "REJECTED" ? t("stRejected") : t("stCancelled")}</option>)}</select></label></div>{statusFilter !== "all" && <div className="applied-filters"><span>{locale === "ar" ? "الفلاتر المطبقة:" : "Applied filters:"}</span><span className="filter-chip">{t("status")}<button className="btn btn-secondary" onClick={() => setFilter("all")}><CloseIcon />{locale === "ar" ? "مسح" : "Clear"}</button></span></div>}{filtered.length === 0 ? <EmptyState message={t("noRequestsFiltered")} action={<button className="btn btn-secondary" onClick={() => setFilter("all")}>{locale === "ar" ? "مسح الفلاتر" : "Clear filters"}</button>} /> : <OperationalTable caption={locale === "ar" ? `${filtered.length} سجل في نطاقك الشخصي` : `${filtered.length} records in your personal scope`} columns={columns} records={filtered} />}</>}
  </div>;
}

export function NewRequestPage() {
  const { t, locale, saveDemoRequest } = useApp(); const navigate = useNavigate(); const titleRef = useRef<HTMLInputElement>(null); const summaryRef = useRef<HTMLDivElement>(null);
  const [typeId, setTypeId] = useState(requestTypes[0].id); const [title, setTitle] = useState(""); const [details, setDetails] = useState(""); const [titleError, setTitleError] = useState<string | null>(null); const [savedMessage, setSavedMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [confirmLeave, setConfirmLeave] = useState(false); const [confirmSubmit, setConfirmSubmit] = useState(false);
  const selectedType = requestTypes.find((requestType) => requestType.id === typeId) ?? requestTypes[0]; const hasUnsaved = Boolean(title.trim() || details.trim()); usePageTitle(t("newRequest"));
  const validate = () => { if (title.trim()) { setTitleError(null); return true; } setTitleError(locale === "ar" ? "أدخل عنوان الطلب." : "Enter a request title."); window.setTimeout(() => summaryRef.current?.focus(), 0); return false; };
  const save = async (submit: boolean) => {
    if (!validate()) return;
    if (submit && !confirmSubmit) {
      setConfirmSubmit(true);
      return;
    }
    setBusy(true);
    try {
      const returned = await saveDemoRequest({ typeId, title: title.trim(), details, submit });
      setSavedMessage(locale === "ar"
        ? `${submit ? "أرسلت" : "حفظت"} طبقة العرض التجريبية الطلب بالحالة «${returned.status === "DRAFT" ? t("stDraft") : t("stPendingManager")}». هذا التغيير غير دائم وسيختفي بعد إعادة تحميل الصفحة.`
        : `The demo data layer ${submit ? "submitted" : "saved"} the request as “${returned.status === "DRAFT" ? t("stDraft") : t("stPendingManager")}”. This change is non-persistent and will disappear after reload.`);
      setConfirmSubmit(false);
    } catch {
      setSavedMessage(locale === "ar" ? "لم تؤكد طبقة العرض التغيير. احتفظنا بالقيم؛ أعد المحاولة." : "The demo data layer did not confirm the change. Your values are preserved; retry.");
    } finally {
      setBusy(false);
    }
  };
  return <div className="page reading-page"><PageHeader title={t("newRequest")} subtitle={locale === "ar" ? "مسودة جديدة · اختر النوع ثم أدخل التفاصيل" : "New draft · choose a type, then enter details"} breadcrumb={<Link to="/requests">{t("myRequestsTitle")}</Link>} />
    {titleError && <div className="banner banner-error" role="alert" tabIndex={-1} ref={summaryRef}><a href="#request-title" onClick={() => titleRef.current?.focus()}>{titleError}</a></div>}
    <form className="work-surface" noValidate onSubmit={(event) => event.preventDefault()}><label className="field"><span className="field-label">{t("requestType")}</span><select className="select" name="request-type" value={typeId} onChange={(event) => setTypeId(Number(event.target.value))}>{requestTypes.map((requestType) => <option key={requestType.id} value={requestType.id}>{requestType.name[locale]}</option>)}</select><span className="field-hint">{selectedType.requires_hr_approval ? (locale === "ar" ? "المسار: المدير ثم الموارد البشرية." : "Review path: manager, then HR.") : (locale === "ar" ? "المسار: مراجعة المدير." : "Review path: manager review.")}</span></label>
      <label className="field"><span className="field-label">{t("requestTitle")} ({locale === "ar" ? "مطلوب" : "required"})</span><input id="request-title" ref={titleRef} className="input" name="title" value={title} required autoComplete="off" spellCheck={false} aria-invalid={Boolean(titleError)} aria-describedby={titleError ? "title-error" : undefined} onChange={(event) => setTitle(event.target.value)} />{titleError && <span className="field-error" id="title-error">{titleError}</span>}</label>
      <label className="field"><span className="field-label">{t("requestDetails")}</span><textarea className="textarea" name="details" value={details} onChange={(event) => setDetails(event.target.value)} /></label>
      <fieldset className="quiet-inset field"><legend className="field-label">{t("attachments")}</legend><input className="input" type="file" disabled aria-describedby="attachment-demo" /><span id="attachment-demo" className="field-hint">{locale === "ar" ? "رفع المرفقات غير متاح في النسخة التجريبية. سيعرض النظام سياسة الخادم عند الربط." : "Uploads are unavailable in this demo. Server policy will be shown when integrated."}</span></fieldset>
      {confirmSubmit && <div className="attention-strip"><div><strong>{locale === "ar" ? "ملخص الإرسال" : "Submission summary"}</strong><p>{locale === "ar" ? `ستحدّث طبقة العرض التجريبية «${title}» إلى حالة بانتظار مراجعة المدير. سيصبح للقراءة فقط داخل الجلسة الحالية، والتغيير غير دائم.` : `The demo data layer will update “${title}” to Awaiting manager review. It will become read-only for this session, and the transition is non-persistent.`}</p></div></div>}
      {savedMessage && <Banner tone="success">{savedMessage}</Banner>}<div className="form-actions"><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => hasUnsaved ? setConfirmLeave(true) : navigate("/requests")}>{t("back")}</button><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => save(false)}>{t("saveDraft")}</button><button className="btn btn-primary" type="button" disabled={busy} onClick={() => save(true)}>{busy ? <><span className="spinner" aria-hidden="true" />{t("saving")}</> : confirmSubmit ? t("confirmDecision") : t("submitRequest")}</button></div>
      {confirmLeave && <Banner tone="warning" role="alert"><div><p>{locale === "ar" ? "لديك تعديلات غير محفوظة. هل تريد الخروج دون حفظ؟" : "You have unsaved changes. Leave without saving?"}</p><div className="form-actions"><button className="btn btn-secondary" type="button" onClick={() => navigate("/requests")}>{locale === "ar" ? "خروج دون حفظ" : "Leave without saving"}</button><button className="btn btn-primary" type="button" onClick={() => setConfirmLeave(false)}>{t("cancel")}</button></div></div></Banner>}
    </form>
  </div>;
}
