import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useServerData } from "../app/useServerData";
import { formatDateTime } from "../app/format";
import { ApiError } from "../app/api";
import {
  createRequestDraft,
  listMyRequestAttachments,
  listMyRequests,
  listRequestTypes,
  submitMyRequest,
  updateMyRequestDraft,
  uploadRequestAttachment,
  type ServerAttachmentRow,
} from "../app/requestsApi";
import type { RequestStatusType, ServerMyRequest, ServerRequestType } from "../app/serverTypes";
import { Banner, EmptyState, ErrorState, RequestStatusPill, SkeletonRows } from "../components/ui";
import OperationalTable, { type OperationalColumn } from "../components/data/OperationalTable";
import PageHeader from "../components/layout/PageHeader";
import { AlertTriangleIcon, FilterIcon, PlusIcon } from "../components/icons";

function nextStage(request: ServerMyRequest, locale: "ar" | "en") {
  const ar = locale === "ar";
  if (request.status === "DRAFT" || request.status === "RETURNED") return ar ? "أنت - حفظ أو إرسال" : "You - save or submit";
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
    { key: "submitted", label: labels.submitted, render: (request) => request.status === "DRAFT" ? t("draft") : <span className="muted">-</span> },
    { key: "updated", label: t("lastUpdate"), render: (request) => formatDateTime(request.updated_at, locale) },
    { key: "action", label: labels.action, render: (request) => request.status === "DRAFT" || request.status === "RETURNED" ? <Link to={`/requests/${request.id}`}>{locale === "ar" ? "متابعة" : "Continue"}</Link> : <span className="muted">-</span> },
  ];
  return <div className="page"><PageHeader title={t("myRequestsTitle")} subtitle={locale === "ar" ? "نطاق العمل الشخصي" : "Personal scope"} primaryAction={<button className="btn btn-primary" onClick={() => navigate("/requests/new")}><PlusIcon />{t("newRequest")}</button>} />
    {list.phase === "loading" && <SkeletonRows rows={4} />}{list.phase === "error" && <ErrorState onRetry={list.retry} />}
    {list.phase === "ready" && <>
      <div className="filter-panel page-filter-panel">
        <div className="filter-toolbar"><label className="field"><span className="field-label"><FilterIcon />{t("status")}</span>{/* ds-allow-native-select: dynamic-option picker; listbox rewrite is deferred */}
<select className="select" value={statusFilter} onChange={(event) => setFilter(event.target.value)}><option value="all">{t("taskFilterAllStatuses")}</option>{(["DRAFT", "PENDING_MANAGER", "PENDING_HR", "APPROVED", "RETURNED", "REJECTED", "CANCELLED"] as RequestStatusType[]).map((status) => <option key={status} value={status}>{status === "DRAFT" ? t("stDraft") : status === "PENDING_MANAGER" ? t("stPendingManager") : status === "PENDING_HR" ? t("stPendingHr") : status === "APPROVED" ? t("stApproved") : status === "RETURNED" ? t("stReturned") : status === "REJECTED" ? t("stRejected") : t("stCancelled")}</option>)}</select></label></div>
        {statusFilter !== "all" && <div className="applied-filters tasks-filter-chips" aria-label={t("taskFiltersApplied")}><span className="filter-chip">{t("status")}<button type="button" className="tasks-chip-remove" aria-label={t("taskFilterRemove").replace("%s", t("status"))} onClick={() => setFilter("all")}>×</button></span><button type="button" className="btn btn-secondary" onClick={() => setFilter("all")}>{t("taskFiltersClearAll")}</button></div>}
        <p className="page-meta tasks-result-count" role="status">{t("taskFiltersShowing").replace("%s", String(filtered.length)).replace("%s", String(rows.length))}</p>
      </div>
      {filtered.length === 0 ? <EmptyState message={rows.length === 0 ? t("noRequestsYet") : t("noRequestsFiltered")} action={rows.length === 0 ? <button className="btn btn-primary" onClick={() => navigate("/requests/new")}><PlusIcon />{t("newRequest")}</button> : <button className="btn btn-secondary" onClick={() => setFilter("all")}>{t("taskFiltersClearAll")}</button>} /> : <OperationalTable caption={locale === "ar" ? `${filtered.length} سجل في نطاقك الشخصي` : `${filtered.length} records in your personal scope`} columns={columns} records={filtered} />}
    </>}
  </div>;
}

/**
 * The new-request form — REAL since Brief H33b.
 *
 * The server's draft contract takes only {request_type_id, title, details}:
 * dates, reason-as-a-field and the status are all server-managed and a request
 * carrying them is refused 422. So this form sends exactly those three fields
 * and nothing else:
 *
 * - the type picker is fed by GET /request-types (the caller's company's
 *   ACTIVE types — the same rows the create endpoint accepts);
 * - the period is REAL because it travels inside the title as ISO dates
 *   (YYYY-MM-DD), which is the format the server's own period reader
 *   (review.advice.parse_request_period) reads back for the reviewer's advice;
 *   there is no separate start/end column on the server, and no clock column
 *   either, so a same-day hour window belongs in the reason text — the copy
 *   says so instead of offering a time input nothing would store;
 * - the reason is the accepted `details` field;
 * - attachments are uploaded to POST /requests/{id}/attachments once the draft
 *   exists (the endpoint is draft-scoped), and the submit waits for their
 *   malware scan to come back CLEAN because the server refuses a submission
 *   with a quarantined file.
 *
 * A failed read shows the server's own sentence and a retry; a failed
 * mutation shows the server's own sentence and keeps every entered value.
 */
type TypesState =
  | { phase: "loading" }
  | { phase: "ready"; rows: ServerRequestType[] }
  | { phase: "error"; message: string | null };

/** The title the server will store: type name + the period as ISO dates. */
function buildRequestTitle(typeName: string, fromDate: string, toDate: string, locale: "ar" | "en"): string {
  if (!fromDate) return "";
  if (!toDate || toDate === fromDate) return `${typeName} - ${fromDate}`;
  return `${typeName} - ${fromDate} ${locale === "ar" ? "إلى" : "to"} ${toDate}`;
}

function scanLabel(scanStatus: string, locale: "ar" | "en"): string {
  // The server emits the model's uppercase choices (PENDING/CLEAN/FAILED/REJECTED).
  if (scanStatus === "CLEAN") return locale === "ar" ? "فحص سليم" : "Scan clean";
  if (scanStatus === "PENDING") return locale === "ar" ? "بانتظار الفحص" : "Awaiting scan";
  return locale === "ar" ? "محجوز؛ الملف غير متاح" : "Quarantined; file unavailable";
}

export function NewRequestPage() {
  const { t, locale } = useApp();
  const navigate = useNavigate();
  usePageTitle(t("newRequest"));

  const [types, setTypes] = useState<TypesState>({ phase: "loading" });
  const [typesAttempt, setTypesAttempt] = useState(0);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState<ServerMyRequest | null>(null);
  const [attachments, setAttachments] = useState<ServerAttachmentRow[]>([]);
  const [busy, setBusy] = useState<"save" | "submit" | "upload" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "draft" | "submitted"; status: RequestStatusType; id: string } | null>(null);
  const [errors, setErrors] = useState<{ type?: string; from?: string; to?: string }>({});

  useEffect(() => {
    let cancelled = false;
    setTypes({ phase: "loading" });
    listRequestTypes(locale)
      .then((rows) => { if (!cancelled) setTypes({ phase: "ready", rows }); })
      .catch((error: unknown) => {
        if (!cancelled) setTypes({ phase: "error", message: error instanceof ApiError ? error.message : null });
      });
    return () => { cancelled = true; };
  }, [locale, typesAttempt]);

  // A quarantined (not yet CLEAN) attachment blocks the submit server-side, so
  // the page re-reads the list while a scan is outstanding instead of leaving a
  // stale "awaiting scan" that the operator cannot clear.
  const scanPending = attachments.some((attachment) => attachment.scan_status !== "CLEAN");
  useEffect(() => {
    if (!draft || !scanPending) return;
    const timer = window.setInterval(() => {
      void listMyRequestAttachments(draft.id, locale).then(setAttachments).catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [draft, scanPending, locale]);

  const selectedType = types.phase === "ready" ? types.rows.find((row) => row.id === typeId) ?? null : null;
  const title = selectedType ? buildRequestTitle(selectedType.name, fromDate, toDate, locale) : "";
  const submitted = notice?.kind === "submitted";
  const editable = !submitted && (draft === null || draft.status === "DRAFT" || draft.status === "RETURNED");

  const validate = () => {
    const next: { type?: string; from?: string; to?: string } = {};
    if (typeId === null) next.type = t("requestTypeRequired");
    if (!fromDate) next.from = t("requestPeriodFromRequired");
    else if (toDate && toDate < fromDate) next.to = t("requestPeriodReversed");
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const messageFor = (error: unknown) =>
    error instanceof ApiError && error.message ? error.message : t("requestRetryFailure");

  /** The draft the form's current values describe: created, or patched if changed. */
  const ensureDraft = async (): Promise<ServerMyRequest> => {
    if (!draft) {
      const created = await createRequestDraft({ requestTypeId: typeId as number, title, details: reason }, locale);
      setDraft(created);
      return created;
    }
    if (draft.title === title && draft.details === reason) return draft;
    const updated = await updateMyRequestDraft(draft.id, { title, details: reason }, locale);
    setDraft(updated);
    return updated;
  };

  const onSaveDraft = async () => {
    if (!validate()) return;
    setBusy("save");
    setFailure(null);
    try {
      const saved = await ensureDraft();
      setNotice({ kind: "draft", status: saved.status, id: saved.id });
    } catch (error: unknown) {
      setFailure(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = async () => {
    if (!validate()) return;
    if (scanPending) {
      setFailure(t("requestSubmitHeldByScan"));
      return;
    }
    setBusy("submit");
    setFailure(null);
    try {
      const saved = await ensureDraft();
      const result = await submitMyRequest(saved.id, saved.version, locale);
      setDraft(result);
      setNotice({ kind: "submitted", status: result.status, id: result.id });
    } catch (error: unknown) {
      setFailure(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  const onPickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !draft) return;
    setBusy("upload");
    setFailure(null);
    try {
      await uploadRequestAttachment(draft.id, file, locale);
      setAttachments(await listMyRequestAttachments(draft.id, locale));
    } catch (error: unknown) {
      setFailure(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  const dateField = (
    id: string,
    label: string,
    value: string,
    invalid: boolean,
    onChange: (next: string) => void,
    min?: string,
  ) => (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input
        id={id}
        className="input"
        type="date"
        dir="ltr"
        lang={locale}
        value={value}
        min={min || undefined}
        disabled={!editable}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );

  return (
    <div className="page reading-page new-request-page">
      <PageHeader
        title={t("newRequest")}
        subtitle={t("newRequestSubtitle")}
        breadcrumb={<Link to="/requests">{t("myRequestsTitle")}</Link>}
        primaryAction={<span className="page-meta new-request-steps" aria-hidden="true">{t("newRequestSteps")}</span>}
      />
      {failure && <Banner tone="error" role="alert">{failure}</Banner>}
      {notice && (
        <Banner tone={submitted ? "success" : "info"} role="status">
          {submitted ? t("requestSubmitted") : t("draftSaved")}{" "}
          <RequestStatusPill status={notice.status} />{" "}
          <Link to={`/requests/${notice.id}`}>{t("requestViewRecord")}</Link>
        </Banner>
      )}
      <form className="work-surface form-stack" noValidate onSubmit={(event) => event.preventDefault()}>
        <fieldset className="field request-type-field">
          <legend className="field-label">{t("requestType")}</legend>
          {types.phase === "loading" && <SkeletonRows rows={2} />}
          {types.phase === "error" && (
            <div className="error-region" role="alert">
              <AlertTriangleIcon className="state-icon" />
              <p>{types.message ?? t("requestTypesUnavailable")}</p>
              <button type="button" className="btn btn-secondary" onClick={() => setTypesAttempt((attempt) => attempt + 1)}>{t("retry")}</button>
            </div>
          )}
          {types.phase === "ready" && (types.rows.length === 0
            ? <EmptyState message={t("requestTypeEmpty")} />
            : <div className="role-segmented">
                {types.rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`role-segmented-option${typeId === row.id ? " is-selected" : ""}`}
                    aria-pressed={typeId === row.id}
                    disabled={!editable || draft !== null}
                    onClick={() => { setTypeId(row.id); setErrors((current) => ({ ...current, type: undefined })); }}
                  >
                    {row.name}
                    <span className="role-segmented-hint">{row.requires_hr_approval ? t("requestTypeHrRequired") : t("requestTypeHrNotRequired")}</span>
                  </button>
                ))}
              </div>)}
          {draft !== null && !submitted && <span className="field-hint">{t("requestTypeLockedAfterDraft")}</span>}
          {errors.type && <span className="field-error" role="alert">{errors.type}</span>}
        </fieldset>

        <fieldset className="quiet-inset field request-inset">
          <legend className="field-label">{t("requestPeriod")}</legend>
          <div className="request-period-row">
            {dateField("request-period", t("requestPeriodFrom"), fromDate, Boolean(errors.from), (next) => { setFromDate(next); setErrors((current) => ({ ...current, from: undefined, to: undefined })); })}
            {dateField("request-period-end", t("requestPeriodToOptional"), toDate, Boolean(errors.to), (next) => { setToDate(next); setErrors((current) => ({ ...current, to: undefined })); }, fromDate)}
          </div>
          <p className="field-hint" id="request-period-hint">{t("requestPeriodRealHint")}</p>
          {errors.from && <span className="request-inline-error" role="alert">{errors.from}</span>}
          {errors.to && <span className="request-inline-error" role="alert">{errors.to}</span>}
          {title && (
            <div className="request-receipt" aria-live="polite">
              <p className="request-receipt-line"><span className="field-hint">{t("requestTitlePreview").replace("%s", "")}</span><bdi>{title}</bdi></p>
            </div>
          )}
        </fieldset>

        <label className="field">
          <span className="field-label">{t("requestReasonOptional")}</span>
          <textarea
            id="request-reason-text"
            className="textarea"
            name="details"
            rows={3}
            maxLength={500}
            value={reason}
            disabled={!editable}
            placeholder={t("requestReasonPlaceholder")}
            aria-describedby="request-reason-hint"
            onChange={(event) => setReason(event.target.value)}
          />
          <span className="field-hint" id="request-reason-hint">{t("requestReasonHintReal")}</span>
          {reason.length >= 450 && <span className="reason-count is-warned">{t("requestReasonCountNear").replace("%s", String(reason.length))}</span>}
        </label>

        <div className="field request-attachments-field">
          <span className="field-label">{t("attachments")}</span>
          {draft === null ? (
            <p className="field-hint">{t("requestAttachmentsNeedDraft")}</p>
          ) : (
            <>
              {attachments.length === 0
                ? <p className="field-hint">{t("noAttachments")}</p>
                : <ul className="attachment-list">{attachments.map((attachment) => (
                    <li className="attachment-row" key={attachment.id}>
                      <bdi dir="ltr">{attachment.original_filename}</bdi>
                      <span className="muted">{attachment.content_type} · {Math.round(attachment.size_bytes / 1024)} KB · {scanLabel(attachment.scan_status, locale)}</span>
                    </li>
                  ))}</ul>}
              {scanPending && <span className="field-hint" role="status">{t("requestAttachmentScanPending")}</span>}
              {editable && (
                <label className="file-placeholder is-actionable">
                  <input
                    type="file"
                    className="file-input-hidden"
                    accept=".pdf,.png,.jpg,.jpeg,.docx"
                    disabled={busy !== null}
                    aria-label={t("requestAttachmentChoose")}
                    onChange={onPickFile}
                  />
                  {busy === "upload" ? t("requestAttachmentUploading") : t("requestAttachmentChoose")}
                </label>
              )}
              <p className="field-hint">{t("attachmentsNote")}</p>
            </>
          )}
        </div>

        <div className="form-actions request-stick-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy !== null || !editable || scanPending}
            title={scanPending ? t("requestSubmitHeldByScan") : undefined}
            onClick={onSubmit}
          >
            {busy === "submit" ? <><span className="spinner" aria-hidden="true" />{t("saving")}</> : t("submitRequest")}
          </button>
          <button className="btn btn-secondary" type="button" disabled={busy !== null || !editable} onClick={onSaveDraft}>
            {busy === "save" ? <><span className="spinner" aria-hidden="true" />{t("saving")}</> : t("saveDraft")}
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => navigate("/requests")}>{t("back")}</button>
        </div>
      </form>
    </div>
  );
}
