import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useMockList, formatDateTime } from "../app/useMockList";
import { mockFetch, requestTypes, type RequestMock, type RequestStatus } from "../mock/data";
import { buildRequestTitle, draftPeriodFields, durationText, periodKindOf, validateDraft, type DraftIssue, type RequestDraft } from "../app/requestDraft";
import { Banner, EmptyState, ErrorState, RequestStatusPill, SkeletonRows } from "../components/ui";
import OperationalTable, { type OperationalColumn } from "../components/data/OperationalTable";
import PageHeader from "../components/layout/PageHeader";
import { FilterIcon, PlusIcon } from "../components/icons";

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
    {list.phase === "loading" && <SkeletonRows rows={4} />}{list.phase === "error" && <ErrorState onRetry={list.retry} />}{list.phase === "empty" && <EmptyState message={t("noRequestsYet")} action={<button className="btn btn-primary" onClick={() => navigate("/requests/new")}><PlusIcon />{t("newRequest")}</button>} />}
    {list.phase === "ready" && <>
      <div className="filter-panel page-filter-panel">
        <div className="filter-toolbar"><label className="field"><span className="field-label"><FilterIcon />{t("status")}</span><select className="select" value={statusFilter} onChange={(event) => setFilter(event.target.value)}><option value="all">{t("taskFilterAllStatuses")}</option>{(["DRAFT", "PENDING_MANAGER", "PENDING_HR", "APPROVED", "RETURNED", "REJECTED", "CANCELLED"] as RequestStatus[]).map((status) => <option key={status} value={status}>{status === "DRAFT" ? t("stDraft") : status === "PENDING_MANAGER" ? t("stPendingManager") : status === "PENDING_HR" ? t("stPendingHr") : status === "APPROVED" ? t("stApproved") : status === "RETURNED" ? t("stReturned") : status === "REJECTED" ? t("stRejected") : t("stCancelled")}</option>)}</select></label></div>
        {statusFilter !== "all" && <div className="applied-filters tasks-filter-chips" aria-label={t("taskFiltersApplied")}><span className="filter-chip">{t("status")}<button type="button" className="tasks-chip-remove" aria-label={t("taskFilterRemove").replace("%s", t("status"))} onClick={() => setFilter("all")}>×</button></span><button type="button" className="btn btn-secondary" onClick={() => setFilter("all")}>{t("taskFiltersClearAll")}</button></div>}
        <p className="page-meta tasks-result-count" role="status">{t("taskFiltersShowing").replace("%s", String(filtered.length)).replace("%s", String(myRequestItems.length))}</p>
      </div>
      {filtered.length === 0 ? <EmptyState message={t("noRequestsFiltered")} action={<button className="btn btn-secondary" onClick={() => setFilter("all")}>{t("taskFiltersClearAll")}</button>} /> : <OperationalTable caption={locale === "ar" ? `${filtered.length} سجل في نطاقك الشخصي` : `${filtered.length} records in your personal scope`} columns={columns} records={filtered} />}
    </>}
  </div>;
}

export function NewRequestPage() {
  const { t, locale, saveDemoRequest } = useApp(); const navigate = useNavigate(); const periodRef = useRef<HTMLInputElement>(null); const clockRef = useRef<HTMLInputElement>(null); const summaryRef = useRef<HTMLDivElement>(null);
  const [typeId, setTypeId] = useState(requestTypes[0].id); const [startDate, setStartDate] = useState(""); const [endDate, setEndDate] = useState(""); const [startTime, setStartTime] = useState("09:00"); const [endTime, setEndTime] = useState("11:00"); const [reason, setReason] = useState(""); const [issue, setIssue] = useState<DraftIssue | null>(null); const [savedMessage, setSavedMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [confirmLeave, setConfirmLeave] = useState(false);
  const selectedType = requestTypes.find((requestType) => requestType.id === typeId) ?? requestTypes[0];
  const draft: RequestDraft = { requestType: selectedType, startDate, endDate, startTime, endTime, reason };
  const kind = periodKindOf(selectedType); const duration = durationText(draft, locale); const hasUnsaved = Boolean(startDate || endDate || reason.trim());
  usePageTitle(t("newRequest"));
  const focusIssue = (problem: DraftIssue) => window.setTimeout(() => (problem.field === "clock" ? clockRef.current : periodRef.current)?.focus(), 0);
  const save = async (submit: boolean) => {
    const problem = validateDraft(draft, locale);
    setIssue(problem);
    if (problem) { focusIssue(problem); return; }
    setBusy(true);
    try {
      const returned = await saveDemoRequest({ typeId, title: buildRequestTitle(draft, locale), details: reason.trim(), ...draftPeriodFields(draft), submit });
      setSavedMessage(locale === "ar"
        ? `${submit ? "أرسلت" : "حفظت"} طبقة العرض التجريبية الطلب بالحالة «${returned.status === "DRAFT" ? t("stDraft") : t("stPendingManager")}». هذا التغيير غير دائم وسيختفي بعد إعادة تحميل الصفحة.`
        : `The demo data layer ${submit ? "submitted" : "saved"} the request as “${returned.status === "DRAFT" ? t("stDraft") : t("stPendingManager")}”. This change is non-persistent and will disappear after reload.`);
    } catch {
      setSavedMessage(locale === "ar" ? "لم تؤكد طبقة العرض التغيير. احتفظنا بالقيم؛ أعد المحاولة." : "The demo data layer did not confirm the change. Your values are preserved; retry.");
    } finally {
      setBusy(false);
    }
  };
  const dateField = (id: string, label: string, value: string, onChange: (next: string) => void, ref?: typeof periodRef, min?: string) => <label className="field"><span className="field-label">{label}</span><input id={id} ref={ref} className="input" type="date" value={value} min={min || undefined} onChange={(event) => onChange(event.target.value)} /></label>;
  const timeField = (id: string, label: string, value: string, onChange: (next: string) => void, ref?: typeof clockRef) => <label className="field"><span className="field-label">{label}</span><input id={id} ref={ref} className="input" type="time" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
  return <div className="page reading-page"><PageHeader title={t("newRequest")} subtitle={locale === "ar" ? "طلب جديد · اختر النوع والمدة من التقويم" : "New request · choose a type and pick the period"} breadcrumb={<Link to="/requests">{t("myRequestsTitle")}</Link>} />
    {issue && <div className="banner banner-error" role="alert" tabIndex={-1} ref={summaryRef}><a href={issue.field === "clock" ? "#request-clock" : "#request-period"} onClick={() => (issue.field === "clock" ? clockRef.current : periodRef.current)?.focus()}>{issue.message}</a></div>}
    <form className="work-surface" noValidate onSubmit={(event) => event.preventDefault()}><label className="field"><span className="field-label">{t("requestType")}</span><select className="select" name="request-type" value={typeId} onChange={(event) => { setTypeId(Number(event.target.value)); setIssue(null); }}>{requestTypes.map((requestType) => <option key={requestType.id} value={requestType.id}>{requestType.name[locale]}</option>)}</select><span className="field-hint">{selectedType.requires_hr_approval ? (locale === "ar" ? "المسار: المدير ثم الموارد البشرية." : "Review path: manager, then HR.") : (locale === "ar" ? "المسار: مراجعة المدير." : "Review path: manager review.")}</span></label>
      <fieldset className="quiet-inset field"><legend className="field-label">{t("requestPeriod")}</legend>
        {kind === "PART_DAY"
          ? <>{dateField("request-period", t("requestPeriodDate"), startDate, setStartDate, periodRef)}{timeField("request-clock", t("requestPeriodFromTime"), startTime, setStartTime, clockRef)}{timeField("request-clock-end", t("requestPeriodToTime"), endTime, setEndTime)}</>
          : <>{dateField("request-period", kind === "SINGLE_DATE" ? t("requestPeriodDate") : t("requestPeriodFrom"), startDate, setStartDate, periodRef)}{kind === "FULL_DAYS" && dateField("request-period-end", t("requestPeriodTo"), endDate, setEndDate, undefined, startDate)}</>}
        <span className="field-hint">{duration ? `${t("requestPeriodHint")} ${duration}` : t("requestPeriodHint")}</span>
      </fieldset>
      <label className="field"><span className="field-label">{t("requestReason")}</span><textarea className="textarea" name="details" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <fieldset className="quiet-inset field"><legend className="field-label">{t("attachments")}</legend><input className="input" type="file" disabled aria-describedby="attachment-demo" /><span id="attachment-demo" className="field-hint">{locale === "ar" ? "رفع المرفقات غير متاح في النسخة التجريبية. سيعرض النظام سياسة الخادم عند الربط." : "Uploads are unavailable in this demo. Server policy will be shown when integrated."}</span></fieldset>
      {savedMessage && <Banner tone="success">{savedMessage}</Banner>}<div className="form-actions"><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => hasUnsaved ? setConfirmLeave(true) : navigate("/requests")}>{t("back")}</button><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => save(false)}>{t("saveDraft")}</button><button className="btn btn-primary" type="button" disabled={busy} onClick={() => save(true)}>{busy ? <><span className="spinner" aria-hidden="true" />{t("saving")}</> : t("submitRequest")}</button></div>
      {confirmLeave && <Banner tone="warning" role="alert"><div><p>{locale === "ar" ? "لديك تعديلات غير محفوظة. هل تريد الخروج دون حفظ؟" : "You have unsaved changes. Leave without saving?"}</p><div className="form-actions"><button className="btn btn-secondary" type="button" onClick={() => navigate("/requests")}>{locale === "ar" ? "خروج دون حفظ" : "Leave without saving"}</button><button className="btn btn-primary" type="button" onClick={() => setConfirmLeave(false)}>{t("cancel")}</button></div></div></Banner>}
    </form>
  </div>;
}
