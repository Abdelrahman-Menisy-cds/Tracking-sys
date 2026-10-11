import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useMockList, formatDateTime } from "../app/useMockList";
import { mockFetch, requestTypes, type RequestMock, type RequestStatus } from "../mock/data";
import { buildRequestTitle, draftPeriodFields, durationWarningText, periodKindOf, validateDraft, type DraftIssue, type RequestDraft } from "../app/requestDraft";
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
  const [typeId, setTypeId] = useState(requestTypes[0].id); const [startDate, setStartDate] = useState(""); const [endDate, setEndDate] = useState(""); const [startTime, setStartTime] = useState(""); const [endTime, setEndTime] = useState(""); const [reason, setReason] = useState(""); const [issue, setIssue] = useState<DraftIssue | null>(null); const [savedMessage, setSavedMessage] = useState<null | { kind: "success" | "error"; text: string }>(null); const [busy, setBusy] = useState(false); const [confirmLeave, setConfirmLeave] = useState(false);
  const selectedType = requestTypes.find((requestType) => requestType.id === typeId) ?? requestTypes[0];
  const draft: RequestDraft = { requestType: selectedType, startDate, endDate, startTime, endTime, reason };
  const kind = periodKindOf(selectedType);
  const derivedTitle = buildRequestTitle(draft, locale);
  const receiptWarning = durationWarningText(draft, locale);
  /* hasUnsaved compares against the LAST-SAVED snapshot (critique 4.8): after a successful
     save the snapshot moves, so «رجوع» stops claiming unsaved changes that no longer exist. */
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const currentSnapshot = JSON.stringify([typeId, startDate, endDate, startTime, endTime, reason.trim()]);
  const hasUnsaved = Boolean(startDate || endDate || startTime || endTime || reason.trim()) && currentSnapshot !== (savedSnapshot ?? JSON.stringify([typeId, "", "", "", "", ""]));
  const receiptId = "request-receipt";
  usePageTitle(t("newRequest"));
  const focusIssue = (problem: DraftIssue) => window.setTimeout(() => (problem.field === "clock" ? clockRef.current : periodRef.current)?.focus(), 0);
  const save = async (submit: boolean) => {
    const problem = validateDraft(draft, locale);
    setIssue(problem);
    if (problem) { focusIssue(problem); return; }
    setBusy(true);
    try {
      await saveDemoRequest({ typeId, title: derivedTitle, details: reason.trim(), ...draftPeriodFields(draft), submit });
      setSavedSnapshot(JSON.stringify([typeId, startDate, endDate, startTime, endTime, reason.trim()]));
      setSavedMessage({ kind: "success", text: submit ? t("requestSubmitSuccess") : t("requestDraftSuccess") });
      if (submit) {
        /* §3 (critical blocker): the page's job is done — navigate to the list. The saved
           request is at the top of myRequestItems, so the new row IS the first one. */
        navigate("/requests");
        return;
      }
    } catch {
      setSavedMessage({ kind: "error", text: t("requestRetryFailure") });
    } finally {
      setBusy(false);
    }
  };
  const tryLeave = () => (hasUnsaved ? setConfirmLeave(true) : navigate("/requests"));
  /* §4: the failing control gets aria-invalid + a describedby pointer to the error line; both
     clear the moment validation passes again (issue === null). */
  const issueId = issue ? `request-issue-${issue.field}` : undefined;
  const dateField = (id: string, label: string, value: string, onChange: (next: string) => void, ref?: typeof periodRef, min?: string) => <label className="field"><span className="field-label">{label}</span><input id={id} ref={ref} className="input" type="date" dir="ltr" lang={locale} value={value} min={min || undefined} onChange={(event) => onChange(event.target.value)} aria-invalid={issue?.field === "period" ? "true" : undefined} aria-describedby={(issue?.field === "period" ? issueId : receiptId)} /></label>;
  const timeField = (id: string, label: string, value: string, onChange: (next: string) => void, ref?: typeof clockRef) => <label className="field"><span className="field-label">{label}</span><input id={id} ref={ref} className="input" type="time" dir="ltr" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={issue?.field === "clock" ? "true" : undefined} aria-describedby={issue?.field === "clock" ? issueId : receiptId} /></label>;
  /* H13d review fixes, both measured on the served build:
     - an error must clear the moment its field is valid again: only the submit gate RAISES an
       issue, and editing re-runs that gate while one is showing, so `aria-invalid` and the inline
       message go away as soon as the draft is valid;
     - the picker is ONE tab stop with RTL-aware arrow keys, and each option describes its OWN path
       line — the old group-level aria-describedby pointed at an id no element carried. */
  const revalidate = (next: Partial<RequestDraft>) => { if (issue) setIssue(validateDraft({ ...draft, ...next }, locale)); };
  const onStartDate = (value: string) => { setStartDate(value); revalidate({ startDate: value }); };
  const onEndDate = (value: string) => { setEndDate(value); revalidate({ endDate: value }); };
  const onStartTime = (value: string) => { setStartTime(value); revalidate({ startTime: value }); };
  const onEndTime = (value: string) => { setEndTime(value); revalidate({ endTime: value }); };
  const chooseType = (next: (typeof requestTypes)[number], moveFocus: boolean) => {
    setTypeId(next.id);
    /* §3: the picked values survive a type switch; the receipt re-runs itself below. */
    revalidate({ requestType: next });
    if (moveFocus) window.requestAnimationFrame(() => document.getElementById(`request-type-option-${next.id}`)?.focus());
  };
  const moveType = (event: { key: string; preventDefault: () => void }, index: number) => {
    const rtl = document.documentElement.getAttribute("dir") === "rtl";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const backward = rtl ? "ArrowRight" : "ArrowLeft";
    const step = event.key === forward || event.key === "ArrowDown" ? 1 : event.key === backward || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    chooseType(requestTypes[(index + step + requestTypes.length) % requestTypes.length], true);
  };
  const typeField = <div className="field type-field"><span className="field-label" id="request-type-label">{t("requestType")}</span><div className="role-segmented" role="radiogroup" aria-labelledby="request-type-label">{requestTypes.map((requestType, index) => {
    const selected = typeId === requestType.id;
    const pathId = `request-type-path-${requestType.id}`;
    return <button key={requestType.id} id={`request-type-option-${requestType.id}`} type="button" role="radio" aria-checked={selected} aria-label={requestType.name[locale]} aria-describedby={pathId} tabIndex={selected ? 0 : -1} className={`role-segmented-option${selected ? " is-selected" : ""}`} onClick={() => chooseType(requestType, false)} onKeyDown={(event) => moveType(event, index)}>{requestType.name[locale]}<span className="role-segmented-hint" id={pathId}>{requestType.requires_hr_approval ? t("requestTypePathManagerHr") : t("requestTypePathManager")}</span></button>;
  })}</div></div>;
  const periodField = <fieldset className="quiet-inset field request-inset"><legend className="field-label">{t("requestPeriod")}</legend>
    <div className="request-period-row">
      {kind === "PART_DAY"
        ? <>{dateField("request-period", t("requestPeriodDate"), startDate, onStartDate, periodRef)}{timeField("request-clock", t("requestPeriodFromTime"), startTime, onStartTime, clockRef)}{timeField("request-clock-end", t("requestPeriodToTime"), endTime, onEndTime)}</>
        : <>{dateField("request-period", kind === "SINGLE_DATE" ? t("requestPeriodDate") : t("requestPeriodFrom"), startDate, onStartDate, periodRef)}{kind === "FULL_DAYS" && dateField("request-period-end", t("requestPeriodTo"), endDate, onEndDate, undefined, startDate)}</>}
    </div>
    {kind === "SINGLE_DATE" && <span className="field-hint request-single-hint">{t("requestPeriodSingleOnly")}</span>}
    {issue && <span id={issueId} className="request-inline-error">{issue.message}</span>}
    {startDate ? <div id={receiptId} className="request-receipt">
      {receiptWarning
        ? <span className="request-receipt-line request-live-warning"><bdi>{receiptWarning}</bdi></span>
        : <span className="request-receipt-line"><bdi>{derivedTitle}</bdi></span>}
    </div> : null}
  </fieldset>;
  const reasonId = "request-reason-text";
  return <div className="page reading-page new-request-page"><PageHeader title={t("newRequest")} subtitle={t("newRequestSubtitle")} breadcrumb={<Link to="/requests">{t("myRequestsTitle")}</Link>} primaryAction={<span className="page-meta new-request-steps" aria-hidden="true">{t("newRequestSteps")}</span>} />
    {issue && <div className="banner banner-error" role="alert" tabIndex={-1} ref={summaryRef}><a href={issue.field === "clock" ? "#request-clock" : "#request-period"} onClick={() => (issue.field === "clock" ? clockRef.current : periodRef.current)?.focus()}>{issue.message}</a></div>}
    <form className="work-surface" noValidate onSubmit={(event) => event.preventDefault()}>
      {typeField}
      {periodField}
      <label className="field"><span className="field-label">{t("requestReasonOptional")}</span><textarea id={reasonId} className="textarea" name="details" rows={3} maxLength={500} placeholder={t("requestReasonPlaceholder")} value={reason} onChange={(event) => setReason(event.target.value)} aria-describedby="reason-hint" /><span className="field-hint" id="reason-hint">{`${t("requestReasonHint")} ${reason.length >= 440 ? t("requestReasonCountNear").replace("%s", String(reason.length)) : ""}`}</span></label>
      <label className="field request-attachments-field"><span className="field-label">{t("attachments")}</span>
        <span className="file-placeholder">{t("attachmentsDemo")}</span>
        <input type="file" disabled aria-hidden="true" aria-label={t("attachmentsDemo")} className="file-input-hidden" tabIndex={-1} />
        <span className="field-hint" id="attachment-demo">{t("attachmentsNote")}</span>
      </label>
      {savedMessage && <Banner tone={savedMessage.kind === "success" ? "success" : "error"} role={savedMessage.kind === "error" ? "alert" : "status"}>{savedMessage.text}</Banner>}
      <div className="form-actions request-stick-actions">
        <button className="btn btn-primary" type="button" disabled={busy} aria-busy={busy} onClick={() => save(true)}>{busy ? <><span className="spinner" aria-hidden="true" />{t("saving")}</> : t("submitRequest")}</button>
        <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => save(false)}>{t("saveDraft")}</button>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={tryLeave}>{t("back")}</button>
      </div>
      {confirmLeave && <Banner tone="warning" role="alert"><div><p>{locale === "ar" ? "لديك تعديلات غير محفوظة. هل تريد الخروج دون حفظ؟" : "You have unsaved changes. Leave without saving?"}</p><div className="confirm-leave-actions"><button className="btn btn-primary" type="button" onClick={() => setConfirmLeave(false)}>{t("cancel")}</button><button className="btn btn-danger" type="button" onClick={() => navigate("/requests")}>{locale === "ar" ? "خروج دون حفظ" : "Leave without saving"}</button></div></div></Banner>}
    </form>
  </div>;
}
