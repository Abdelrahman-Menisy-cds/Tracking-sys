import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useServerData } from "../app/useServerData";
import { formatDateTime, formatMinutes, weekInterval } from "../app/format";
import { listReviewRequests, getReviewRequest, decideRequest, listReviewAdvice } from "../app/requestsApi";
import { listReviewTimesheets, getReviewTimesheet, decideTimesheet } from "../app/timesheetsApi";
import type { AdviceSupport, AdviceVerdict, DecisionAction, ServerMyRequest, ServerMyTimesheet, ServerReviewAdvice, ServerReviewRequestRow, ServerReviewTimesheetRow, RequestStatusType, TimesheetStatusType } from "../app/serverTypes";
import { ApiError } from "../app/api";
import {
  Banner,
  Dialog,
  EmptyState,
  ErrorState,
  RequestStatusPill,
  SkeletonRows,
  StatusPill,
  TimesheetStatusPill,
} from "../components/ui";
import OperationalTable, { type OperationalColumn } from "../components/data/OperationalTable";
import PageHeader from "../components/layout/PageHeader";
import Timeline from "../components/record/Timeline";

/**
 * The review lane is now server-backed end to end: the queue and details ask
 * /review/* (the backend scopes every row by who is asking), and decisions go
 * through the Idempotency-Key'd decision endpoints. The queue keeps its
 * short-staffed columns and adds «رأي المساعد»: a server-computed rule verdict
 * with the assistant's Arabic explanation, fetched for the whole page in ONE
 * batched call (never once per row) and never blocking the decision button.
 * The old client-side "smart suggestion" is gone - nothing local could compute it.
 */

const DECISION_TO_ACTION: Record<"APPROVE" | "REJECT" | "RETURN", DecisionAction> = {
  APPROVE: "approve",
  REJECT: "reject",
  RETURN: "return",
};

/* The stage after the reviewer acts. It is driven by what the SERVER says this
   caller may do (permissions.can_decide) plus the row's own stage — never by a
   hard-coded manager stage, which told HR its PENDING_HR rows had "no review
   action available" while the row was decidable and the endpoint accepted the
   decision. */
function requestNextStage(request: ServerReviewRequestRow, locale: "ar" | "en") {
  const ar = locale === "ar";
  if (!request.permissions.can_decide) {
    return ar ? "لا يوجد إجراء مراجعة متاح" : "No review action available";
  }
  if (request.status === "PENDING_HR") {
    // HR's decision is the final stage for a request that reached HR.
    return ar ? "بعد الاعتماد: مكتمل" : "After approval: complete";
  }
  if (request.request_type.requires_hr_approval) {
    return ar ? "بعد الاعتماد: مراجعة الموارد البشرية" : "After approval: HR review";
  }
  return ar ? "بعد الاعتماد: مكتمل" : "After approval: complete";
}

function requestStatusLabel(status: RequestStatusType, locale: "ar" | "en") {
  const labels: Record<RequestStatusType, { ar: string; en: string }> = {
    DRAFT: { ar: "مسودة", en: "Draft" },
    PENDING_MANAGER: { ar: "بانتظار مراجعة المدير", en: "Awaiting manager review" },
    PENDING_HR: { ar: "بانتظار مراجعة الموارد البشرية", en: "Awaiting HR review" },
    APPROVED: { ar: "معتمد", en: "Approved" },
    REJECTED: { ar: "مرفوض", en: "Rejected" },
    RETURNED: { ar: "معاد للتعديل", en: "Returned for correction" },
    CANCELLED: { ar: "ملغى", en: "Cancelled" },
  };
  return labels[status][locale];
}

function timesheetStatusLabel(status: TimesheetStatusType, locale: "ar" | "en") {
  const labels: Record<TimesheetStatusType, { ar: string; en: string }> = {
    DRAFT: { ar: "مسودة", en: "Draft" },
    SUBMITTED: { ar: "مُرسل للمراجعة", en: "Submitted for review" },
    RETURNED: { ar: "معاد للتعديل", en: "Returned for correction" },
    APPROVED: { ar: "معتمد", en: "Approved" },
    REJECTED: { ar: "مرفوض", en: "Rejected" },
  };
  return labels[status][locale];
}

/* «رأي المساعد» - the verdict's visual weight: approve-leaning is success,
   reject-leaning is danger, a coverage warning is warning, none is neutral.
   The tone never affects the decision button, which is its own column. */
const ADVICE_TONE: Record<AdviceVerdict, "success" | "danger" | "warning" | "neutral"> = {
  RECOMMEND_APPROVE: "success",
  RECOMMEND_REJECT: "danger",
  NEEDS_ATTENTION: "warning",
  NO_OPINION: "neutral",
};

const ADVICE_ICON: Record<AdviceVerdict, "approved" | "rejected" | "returned" | "draft"> = {
  RECOMMEND_APPROVE: "approved",
  RECOMMEND_REJECT: "rejected",
  NEEDS_ATTENTION: "returned",
  NO_OPINION: "draft",
};

/* When the assistant's prose is absent, the heaviest rule reason is the honest
   fallback: the server computed it, so it is never invented client-side. */
const ADVICE_WEIGHT: Record<AdviceSupport, number> = { reject: 3, warn: 2, approve: 1, info: 0 };

function topAdviceReason(advice: ServerReviewAdvice, locale: "ar" | "en"): string {
  const ranked = [...advice.facts].sort((a, b) => ADVICE_WEIGHT[b.supports] - ADVICE_WEIGHT[a.supports]);
  const best = ranked[0];
  return best ? (locale === "ar" ? best.reason_ar : best.reason_en) : "";
}

export default function TeamReviewsPage() {
  const { t, locale } = useApp();
  const [tab, setTab] = useState<"requests" | "timesheets">("requests");
  /* A decision succeeded → version bump → refetch, so the queue never shows a settled row. */
  const [queueRefresh, setQueueRefresh] = useState(0);
  const [deciding, setDeciding] = useState<ServerReviewRequestRow | ServerReviewTimesheetRow | null>(null);
  const [queueResult, setQueueResult] = useState<null | { subject: string; status: string; stage: string; version: number }>(null);
  const queueHeadingRef = useRef<HTMLHeadingElement>(null);
  /* No status filter: the server scopes the queue to the caller, and the rows
     carry can_decide. Hard-coding PENDING_MANAGER left HR — whose work is the
     PENDING_HR stage — staring at an empty queue while 19 rows waited. The
     filter below keeps exactly what this caller may act on. */
  const requestState = useServerData(
    () => listReviewRequests(locale).then((payload) => payload.data),
    [locale, tab === "requests" ? queueRefresh : null],
  );
  /* Same rule as the requests queue: let the server scope it, then keep what
     this caller may decide. Pinning SUBMITTED hid every row from a caller whose
     stage is the one after it. */
  const timesheetState = useServerData(
    () => listReviewTimesheets(locale).then((payload) => payload.data),
    [locale, tab === "timesheets" ? queueRefresh : null],
  );
  usePageTitle(t("teamReviewsTitle"));

  const pendingRequests = requestState.phase === "ready" ? requestState.data.filter((request) => request.permissions.can_decide) : [];
  const pendingTimesheets = timesheetState.phase === "ready" ? timesheetState.data.filter((sheet) => sheet.permissions.can_decide) : [];

  /* One batched call for the whole visible page - the table must never fire
     once per row. The rule verdict is deterministic and always present; the
     Arabic explanation is the assistant's and may be absent (never faked). */
  const adviceIds = pendingRequests.map((request) => request.id);
  const adviceKey = adviceIds.join(",");
  const adviceState = useServerData(
    () => (adviceIds.length ? listReviewAdvice(adviceIds, locale) : Promise.resolve<Record<string, ServerReviewAdvice>>({})),
    [adviceKey, locale],
  );

  const adviceCell = (request: ServerReviewRequestRow) => {
    if (adviceState.phase === "loading") return <span className="muted">{t("reviewAdviceLoading")}</span>;
    if (adviceState.phase === "error") return <span className="muted">{t("reviewAdviceUnavailable")}</span>;
    const advice = adviceState.data[request.id];
    if (!advice) return <span className="muted">-</span>;
    const label = advice.verdict_label[locale] ?? advice.verdict_label.ar;
    const reason = advice.explanation.available && advice.explanation.text_ar
      ? advice.explanation.text_ar
      : topAdviceReason(advice, locale);
    return (
      <div>
        <StatusPill tone={ADVICE_TONE[advice.verdict]} label={label} icon={ADVICE_ICON[advice.verdict]} />
        {reason ? <div className="muted advice-reason"><bdi>{reason}</bdi></div> : null}
        {!advice.explanation.available ? <div className="muted">{t("reviewAdviceExplanationUnavailable")}</div> : null}
      </div>
    );
  };

  const requestColumns: OperationalColumn<ServerReviewRequestRow>[] = [
    {
      key: "request",
      label: t("requestTitle"),
      render: (request) => (
        <div>
          <Link to={`/reviews/requests/${request.id}`}><bdi>{request.title}</bdi></Link>
          <div className="muted"><bdi>{request.request_type.name}</bdi></div>
        </div>
      ),
    },
    { key: "employee", label: t("employee"), render: (request) => <bdi>{request.requester_name}</bdi> },
    { key: "status", label: t("status"), render: (request) => <RequestStatusPill status={request.status} /> },
    /* The server queue carries no submitted_at; creation time is the honest column. */
    { key: "submitted", label: t("submittedAt"), render: (request) => formatDateTime(request.created_at, locale) },
    { key: "next", label: locale === "ar" ? "المرحلة التالية" : "Next stage", render: (request) => requestNextStage(request, locale) },
    { key: "advice", label: t("reviewAdviceColumn"), render: (request) => adviceCell(request) },
    {
      key: "action",
      label: t("decision"),
      render: (request) => (
        request.permissions.can_decide
          ? <button className="btn btn-primary" onClick={() => setDeciding(request)}>{t("decision")}</button>
          : <span className="muted">-</span>
      ),
    },
  ];

  const timesheetColumns: OperationalColumn<ServerReviewTimesheetRow>[] = [
    {
      key: "week",
      label: t("week"),
      render: (sheet) => <Link to={`/reviews/timesheets/${sheet.id}`}>{weekInterval(sheet.week_start, locale)}</Link>,
    },
    { key: "employee", label: t("employee"), render: (sheet) => <bdi>{sheet.employee_name}</bdi> },
    { key: "status", label: t("status"), render: (sheet) => <TimesheetStatusPill status={sheet.status} /> },
    /* Summary queue rows carry no totals; the honest cell is the timestamp. */
    { key: "submitted", label: t("submittedAt"), render: (sheet) => formatDateTime(sheet.created_at, locale) },
    {
      key: "action",
      label: t("decision"),
      render: (sheet) => (
        sheet.permissions.can_decide
          ? <button className="btn btn-primary" onClick={() => setDeciding(sheet)}>{t("decision")}</button>
          : <span className="muted">-</span>
      ),
    },
  ];

  const activeState = tab === "requests" ? requestState : timesheetState;
  const records = tab === "requests" ? pendingRequests : pendingTimesheets;

  const closeAfterDecision = (subject: string, status: string, stage: string, version: number) => {
    setQueueResult({ subject, status, stage, version });
    setDeciding(null);
    setQueueRefresh((current) => current + 1);
    window.setTimeout(() => queueHeadingRef.current?.focus(), 0);
  };

  return (
    <div className="page">
      <PageHeader
        title={t("teamReviewsTitle")}
        subtitle={locale === "ar"
          ? "النطاق من الخادم: ما يُسمح لك بمراجعته فقط · الأقدم إرسالًا أولًا · القرارات تُرسل إلى الخادم"
          : "Scope comes from the server: only what you are allowed to review · oldest submitted first · decisions are sent to the server"}
      />
      <h2 className="visually-hidden" ref={queueHeadingRef} tabIndex={-1} data-review-queue-heading>
        {locale === "ar" ? "طابور المراجعة المعلق" : "Pending review queue"}
      </h2>
      {queueResult ? (
        <Banner tone="success">
          <span>
            {locale === "ar" ? "تم تنفيذ القرار على الخادم." : "The decision was applied on the server."}
            {" "}{t("decisionOn")}: <bdi>{queueResult.subject}</bdi> · {t("currentState")}: {queueResult.status} · {locale === "ar" ? "المرحلة الناتجة" : "Resulting stage"}: {queueResult.stage} · {locale === "ar" ? "الإصدار" : "Version"}: <bdi dir="ltr">{queueResult.version}</bdi>
          </span>
        </Banner>
      ) : null}
      <div className="work-surface review-queue">
        <div
          className="review-tabs"
          role="tablist"
          aria-label={t("teamReviewsTitle")}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next = event.key === (locale === "ar" ? "ArrowLeft" : "ArrowRight") ? "timesheets" : "requests";
            setTab(next);
            (event.currentTarget.querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
          }}
        >
          <button role="tab" data-tab="requests" id="tab-requests" aria-selected={tab === "requests"} aria-controls="panel-reviews" tabIndex={tab === "requests" ? 0 : -1} className="review-tab" onClick={() => setTab("requests")}>{t("reviewRequests")}</button>
          <button role="tab" data-tab="timesheets" id="tab-timesheets" aria-selected={tab === "timesheets"} aria-controls="panel-reviews" tabIndex={tab === "timesheets" ? 0 : -1} className="review-tab" onClick={() => setTab("timesheets")}>{t("reviewTimesheets")}</button>
        </div>
        <div role="tabpanel" id="panel-reviews" aria-labelledby={tab === "requests" ? "tab-requests" : "tab-timesheets"}>
          {activeState.phase === "loading" ? <SkeletonRows rows={3} /> : null}
          {activeState.phase === "error" ? <ErrorState onRetry={activeState.retry} /> : null}
          {activeState.phase === "ready" && records.length === 0
            ? <EmptyState message={t("queueEmpty")} action={<Link className="btn btn-secondary" to="/">{t("navHome")}</Link>} />
            : null}
          {activeState.phase === "ready" && records.length > 0 && tab === "requests" ? (
            <OperationalTable
              caption={locale === "ar" ? `${pendingRequests.length} طلبات بانتظار قرار ضمن نطاقك` : `${pendingRequests.length} requests awaiting your decision within your server scope`}
              columns={requestColumns}
              records={pendingRequests}
            />
          ) : null}
          {activeState.phase === "ready" && records.length > 0 && tab === "timesheets" ? (
            <>
              <p className="muted">{locale === "ar" ? "الأسابيع من الاثنين إلى الأحد · المنطقة الزمنية للمؤسسة: Africa/Cairo" : "Weeks run Monday-Sunday · organization timezone: Africa/Cairo"}</p>
              <OperationalTable
                caption={locale === "ar" ? `${pendingTimesheets.length} سجلات وقت بانتظار قرار ضمن نطاقك` : `${pendingTimesheets.length} timesheets awaiting your decision within your server scope`}
                columns={timesheetColumns}
                records={pendingTimesheets}
              />
            </>
          ) : null}
        </div>
      </div>
      {deciding ? (
        <DecisionDialog
          record={deciding}
          onCancel={() => setDeciding(null)}
          onConfirmed={(record, returnedStatus, stage, version) => {
            const subject = "requester_name" in record && "title" in record ? record.title : weekInterval(record.week_start, locale);
            closeAfterDecision(subject, returnedStatus, stage, version);
          }}
        />
      ) : null}
    </div>
  );
}

function DecisionDialog({
  record,
  onCancel,
  onConfirmed,
}: {
  record: ServerReviewRequestRow | ServerReviewTimesheetRow;
  onCancel: () => void;
  onConfirmed: (record: ServerReviewRequestRow | ServerReviewTimesheetRow, status: string, stage: string, version: number) => void;
}) {
  const { t, locale } = useApp();
  const isRequest = "title" in record;
  const [kind, setKind] = useState<"APPROVE" | "REJECT" | "RETURN" | null>(null);
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"editing" | "submitting" | "confirmed" | "conflict" | "unknown" | "error">("editing");
  const [returnedRecord, setReturnedRecord] = useState<ServerMyRequest | ServerMyTimesheet | null>(null);
  const closeAndRestoreQueue = () => {
    onCancel();
    window.setTimeout(() => document.querySelector<HTMLElement>("[data-review-queue-heading]")?.focus(), 0);
  };
  const name = isRequest ? (record as ServerReviewRequestRow).requester_name : (record as ServerReviewTimesheetRow).employee_name;
  const subject = isRequest ? (record as ServerReviewRequestRow).title : weekInterval((record as ServerReviewTimesheetRow).week_start, locale);
  const currentStatus = isRequest
    ? requestStatusLabel((record as ServerReviewRequestRow).status, locale)
    : timesheetStatusLabel((record as ServerReviewTimesheetRow).status, locale);
  const kindLabel = (decision: "APPROVE" | "REJECT" | "RETURN") => decision === "APPROVE" ? t("approve") : decision === "REJECT" ? t("reject") : t("returnForCorrection");
  const returnedStatusLabel = (returned: ServerMyRequest | ServerMyTimesheet) =>
    "entries" in returned ? timesheetStatusLabel(returned.status, locale) : requestStatusLabel(returned.status, locale);

  const confirmDecision = async () => {
    if (!kind) return;
    if ((kind === "REJECT" || kind === "RETURN") && !comment.trim()) {
      setCommentError(kind === "RETURN" ? t("reasonRequired") : t("rejectReasonRequired"));
      return;
    }
    setPhase("submitting");
    try {
      const returned: ServerMyRequest | ServerMyTimesheet = isRequest
        ? await decideRequest(record.id, DECISION_TO_ACTION[kind], comment.trim(), record.version, locale)
        : await decideTimesheet(record.id, DECISION_TO_ACTION[kind], comment.trim(), record.version, locale);
      setReturnedRecord(returned);
      setPhase("confirmed");
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 422)) setPhase("conflict");
      else if (error instanceof ApiError && error.status === undefined) setPhase("unknown");
      else setPhase("error");
    }
  };

  const reconcileWithoutReplay = () => {
    setPhase("editing");
    setKind(null);
    setCommentError(null);
    closeAndRestoreQueue();
  };

  return (
    <Dialog
      title={t("decision")}
      onClose={phase === "confirmed" && returnedRecord
        ? () => onConfirmed(record, returnedStatusLabel(returnedRecord), kind ? kindLabel(kind) : "", returnedRecord.version)
        : closeAndRestoreQueue}
      dirty={Boolean(comment.trim()) && phase === "editing"}
      busy={phase === "submitting"}
      restoreFocus={false}
    >
      {phase === "confirmed" && returnedRecord ? (
        <>
          <Banner tone="success">
            {locale === "ar" ? "تم تطبيق القرار على الخادم وحصل السجل على إصدار جديد." : "The decision was applied on the server and the record moved to a new version."}
          </Banner>
          <dl className="decision-facts">
            <div><dt>{t("decisionOn")}</dt><dd><bdi>{subject}</bdi></dd></div>
            <div><dt>{t("currentState")}</dt><dd><strong>{returnedStatusLabel(returnedRecord)}</strong></dd></div>
            <div><dt>{locale === "ar" ? "المرحلة الناتجة" : "Resulting stage"}</dt><dd><strong>{kind ? kindLabel(kind) : ""}</strong></dd></div>
            <div><dt>{locale === "ar" ? "إصدار السجل المؤكد" : "Confirmed record version"}</dt><dd><bdi dir="ltr">{returnedRecord.version}</bdi></dd></div>
          </dl>
          <div className="dialog-actions">
            <button className="btn btn-primary" onClick={() => onConfirmed(record, returnedStatusLabel(returnedRecord), kind ? kindLabel(kind) : "", returnedRecord.version)}>{t("close")}</button>
          </div>
        </>
      ) : phase === "conflict" || phase === "unknown" ? (

        <>
          <Banner tone="warning" role="alert">
            {phase === "conflict"
              ? locale === "ar" ? "تغيّر السجل منذ فتح القرار. لم نرسل القرار مرة أخرى. أغلق النافذة وافتح أحدث سجل قبل اتخاذ قرار جديد." : "The record changed after this decision opened. The decision was not replayed. Close and inspect the latest record before deciding again."
              : locale === "ar" ? "لم نتلقَّ تأكيدًا للقرار. لا نعرف إن كان قد طُبّق، ولن نعيد إرساله تلقائيًا. حدّث الطابور وتحقق من السجل قبل أي محاولة جديدة." : "Decision confirmation was not received. Its outcome is unknown and it will not be replayed automatically. Refresh the queue and inspect the record before any new attempt."}
          </Banner>
          <p>{locale === "ar" ? "تم الاحتفاظ بنص الملاحظة داخل هذه النافذة للرجوع إليه فقط؛ لن يُطبّق على سجل أحدث تلقائيًا." : "Your note remains visible in this dialog for reference only; it will not be applied to a newer record automatically."}</p>
          {comment ? <div className="quiet-inset preserve-lines"><bdi>{comment}</bdi></div> : null}
          <div className="dialog-actions">
            <button className="btn btn-primary" onClick={reconcileWithoutReplay}>{locale === "ar" ? "إغلاق وتحديث الطابور" : "Close and refresh queue"}</button>
          </div>
        </>
      ) : (
        <>
          {phase === "error" ? <Banner tone="error" role="alert">{t("errorNetwork")}</Banner> : null}
          <dl className="decision-facts">
            <div><dt>{t("decisionOn")}</dt><dd><bdi>{subject}</bdi></dd></div>
            <div><dt>{t("employee")}</dt><dd><bdi>{name}</bdi></dd></div>
            <div><dt>{t("currentState")}</dt><dd>{currentStatus}</dd></div>
            <div><dt>{locale === "ar" ? "إصدار السجل" : "Record version"}</dt><dd><bdi dir="ltr">{record.version}</bdi></dd></div>
            {kind ? (
              <>
                <div><dt>{t("decisionSummary")}</dt><dd>{kindLabel(kind)}</dd></div>
                <div><dt>{locale === "ar" ? "الحالة المتوقعة" : "Expected resulting state"}</dt><dd>{kind === "APPROVE" && isRequest && (record as ServerReviewRequestRow).request_type.requires_hr_approval ? t("stPendingHr") : kind === "RETURN" ? t("stReturned") : kind === "REJECT" ? t("stRejected") : t("stApproved")}</dd></div>
              </>
            ) : null}
          </dl>
          {!kind ? (
            <div className="decision-choices">
              <button className="btn btn-primary" onClick={() => setKind("APPROVE")}>{t("approve")}</button>
              <button className="btn btn-secondary" onClick={() => setKind("RETURN")}>{t("returnForCorrection")}</button>
              <button className="btn btn-danger" onClick={() => setKind("REJECT")}>{t("reject")}</button>
            </div>
          ) : (
            <>
              {kind === "REJECT" || kind === "RETURN" ? (
                <label className="field">
                  <span className="field-label">{t("decisionComment")} ({locale === "ar" ? "مطلوب" : "required"})</span>
                  <textarea
                    className="textarea"
                    name="decision-comment"
                    value={comment}
                    aria-invalid={Boolean(commentError)}
                    aria-describedby={commentError ? "decision-comment-error" : undefined}
                    onChange={(event) => {
                      setComment(event.target.value);
                      setCommentError(null);
                    }}
                  />
                  {commentError ? <span className="field-error" id="decision-comment-error">{commentError}</span> : null}
                </label>
              ) : null}
              <Banner tone="info">{locale === "ar" ? "يُرسل القرار إلى الخادم بمفتاح Idempotency فريد؛ لن يُعاد إرساله تلقائيًا عند فشل الشبكة." : "The decision is sent to the server with a unique Idempotency key; it is never replayed automatically on a network failure."}</Banner>
              <div className="dialog-actions">
                <button className="btn btn-secondary" disabled={phase === "submitting"} onClick={() => setKind(null)}>{t("back")}</button>
                <button className={kind === "REJECT" ? "btn btn-danger" : "btn btn-primary"} disabled={phase === "submitting"} onClick={confirmDecision}>{phase === "submitting" ? t("saving") : t("confirmDecision")}</button>
              </div>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}

export function ReviewRequestDetailPage() {
  const { id } = useParams();
  const { t, locale } = useApp();
  const state = useServerData(async () => {
    try {
      return await getReviewRequest(id ?? "", locale);
    } catch {
      return null;
    }
  }, [id, locale]);
  usePageTitle(t("details"));
  if (state.phase === "loading") return <div className="page"><PageHeader title={t("details")} /><SkeletonRows rows={3} /></div>;
  if (state.phase === "error") return <div className="page"><PageHeader title={t("details")} /><ErrorState onRetry={state.retry} /></div>;
  const request = state.phase === "ready" ? state.data : null;
  if (!request) return <SafeReviewUnavailable backToReviews />;
  return (
    <div className="page reading-page">
      <PageHeader title={<bdi>{request.title}</bdi>} subtitle={`${t("employee")}: ${request.requester_name}`} breadcrumb={<Link to="/reviews">{t("teamReviewsTitle")}</Link>} />
      <div className="status-action-block"><RequestStatusPill status={request.status} /><p>{requestNextStage(request, locale)}</p></div>
      {/* The review detail carries no picked period - the server serializes
          only type/title/details, so that block renders its honest empty state. */}
      <section className="work-surface section" aria-labelledby="review-period"><h2 id="review-period">{t("requestPeriod")}</h2><EmptyState message={locale === "ar" ? "الخادم لا يعرض الفترة المختارة على هذا المسار بعد." : "The server does not expose the picked period on this endpoint yet."} /></section>
      <section className="work-surface section" aria-labelledby="review-details"><h2 id="review-details">{t("requestReason")}</h2><p className="preserve-lines"><bdi>{request.details}</bdi></p></section>
      <section className="work-surface section" aria-labelledby="review-attachments"><h2 id="review-attachments">{t("attachments")}</h2>
        {request.attachments.length
          ? <ul className="attachment-list">{request.attachments.map((attachment) => <li className="attachment-row" key={attachment.id}><bdi dir="ltr">{attachment.original_filename}</bdi><span className="muted">{attachment.declared_content_type} · {Math.round(attachment.size_bytes / 1024)} KB · {attachment.scan_status === "clean" ? (locale === "ar" ? "فحص سليم" : "Scan clean") : attachment.scan_status === "pending" ? (locale === "ar" ? "بانتظار الفحص" : "Awaiting scan") : (locale === "ar" ? "محجوز؛ الملف غير متاح" : "Quarantined; file unavailable")}</span></li>)}</ul>
          : <EmptyState message={t("noAttachments")} />}
      </section>
      <section className="work-surface section" aria-labelledby="review-history"><h2 id="review-history">{t("history")}</h2><Timeline events={request.events} /></section>
      <Banner tone="info">{locale === "ar" ? "السجل من نطاق المراجعة على الخادم؛ القرارات تنفَّذ عبر نقطة النهاية الموثقة." : "This record is in your review scope on the server; decisions run through the documented endpoint."}</Banner>
    </div>
  );
}

export function ReviewTimesheetDetailPage() {
  const { id } = useParams();
  const { t, locale } = useApp();
  const state = useServerData(async () => {
    try {
      return await getReviewTimesheet(id ?? "", locale);
    } catch {
      return null;
    }
  }, [id, locale]);
  usePageTitle(t("details"));
  if (state.phase === "loading") return <div className="page"><PageHeader title={t("details")} /><SkeletonRows rows={3} /></div>;
  if (state.phase === "error") return <div className="page"><PageHeader title={t("details")} /><ErrorState onRetry={state.retry} /></div>;
  const sheet = state.phase === "ready" ? state.data : null;
  if (!sheet) return <SafeReviewUnavailable backToReviews />;
  const worked = sheet.entries.reduce((sum, entry) => sum + entry.duration_minutes, 0);
  const breaks = sheet.entries.reduce((sum, entry) => sum + entry.unpaid_break_minutes, 0);
  return (
    <div className="page reading-page">
      <PageHeader
        title={<>{t("week")}: {weekInterval(sheet.week_start, locale)}</>}
        subtitle={`${t("employee")}: ${sheet.employee_name} · ${locale === "ar" ? "المنطقة الزمنية للمؤسسة" : "Organization timezone"}: Africa/Cairo`}
        breadcrumb={<Link to="/reviews">{t("teamReviewsTitle")}</Link>}
      />
      <div className="status-action-block"><TimesheetStatusPill status={sheet.status} /><p>{locale === "ar" ? "راجع الأيام والمدة والراحة قبل اتخاذ القرار من الطابور." : "Review days, duration and breaks before deciding from the queue."}</p></div>
      <div className="summary-strip section">
        <div className="summary-item"><span className="summary-label">{t("totalHours")}</span><strong>{formatMinutes(worked, locale)}</strong></div>
        <div className="summary-item"><span className="summary-label">{t("breakTime")}</span><strong>{formatMinutes(breaks, locale)}</strong></div>
      </div>
      <section className="work-surface section" aria-labelledby="review-timesheet-entries">
        <h2 id="review-timesheet-entries">{t("entries")}</h2>
        {sheet.entries.length ? (
          <dl className="decision-facts">
            {sheet.entries.map((entry) => (
              <div key={entry.id}>
                <dt>{formatDateTime(entry.work_date, locale)}</dt>
                <dd>{formatMinutes(entry.duration_minutes, locale)} · {t("breakTime")}: {formatMinutes(entry.unpaid_break_minutes, locale)}{entry.description ? <> · <bdi>{entry.description}</bdi></> : null}</dd>
              </div>
            ))}
          </dl>
        ) : <EmptyState message={t("reviewEntriesEmpty")} />}
      </section>
      <section className="work-surface section" aria-labelledby="review-timesheet-history"><h2 id="review-timesheet-history">{t("history")}</h2><Timeline events={sheet.events} /></section>
      <Banner tone="info">{locale === "ar" ? "القرار من الطابور يُرسل إلى الخادم بمفتاح Idempotency فريد." : "The decision from the queue is sent to the server with a unique Idempotency key."}</Banner>
    </div>
  );
}

/**
 * The review detail endpoints answer 403/404 for anything outside the caller's
 * server-built scope - the shared client turns that into a catch - and a
 * ticket can also simply no longer be in scope. Either way there is NO local
 * copy to fall back on (the review fixtures are gone), so this renders the
 * honest unavailable state instead of a stale demo record.
 */
function SafeReviewUnavailable({ backToReviews }: { backToReviews?: boolean }) {
  const { t, locale } = useApp();
  return (
    <div className="page">
      <PageHeader title={t("details")} breadcrumb={<Link to="/reviews">{t("teamReviewsTitle")}</Link>} />
      <Banner tone="warning" role="alert">
        {locale === "ar"
          ? "لم يعثر الخادم على هذا السجل ضمن نطاق مراجعتك، أو لم يعد متاحًا. لا يوجد بديل محلي يُعرض بدلًا منه."
          : "The server found no such record inside your review scope, or it is no longer reachable. No local substitute is shown."}
      </Banner>
      <EmptyState
        message={locale === "ar" ? "السجل غير متاح ضمن نطاقك." : "The record is not available within your scope."}
        action={<Link className="btn btn-secondary" to={backToReviews ? "/reviews" : "/"}>{backToReviews ? t("teamReviewsTitle") : t("navHome")}</Link>}
      />
    </div>
  );
}
