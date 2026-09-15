import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, usePageTitle, type ReviewDecision } from "../app/AppContext";
import { formatDateTime, formatMinutes, useMockList } from "../app/useMockList";
import { mockFetch, pickName, type RequestMock, type RequestStatus, type TimesheetMock, type TimesheetStatus } from "../mock/data";
import { Banner, Dialog, EmptyState, ErrorState, RequestStatusPill, SkeletonRows, TimesheetStatusPill } from "../components/ui";
import OperationalTable, { type OperationalColumn } from "../components/data/OperationalTable";
import PageHeader from "../components/layout/PageHeader";
import Timeline from "../components/record/Timeline";

function isRequest(record: RequestMock | TimesheetMock): record is RequestMock {
  return "request_type" in record;
}

function requestNextStage(request: RequestMock, locale: "ar" | "en") {
  if (request.status !== "PENDING_MANAGER") return locale === "ar" ? "لا يوجد إجراء مراجعة متاح" : "No review action available";
  if (request.request_type.requires_hr_approval) return locale === "ar" ? "بعد الاعتماد: مراجعة الموارد البشرية" : "After approval: HR review";
  return locale === "ar" ? "بعد الاعتماد: مكتمل" : "After approval: complete";
}

function requestStatusLabel(status: RequestStatus, locale: "ar" | "en") {
  const labels: Record<RequestStatus, { ar: string; en: string }> = {
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

function timesheetStatusLabel(status: TimesheetStatus, locale: "ar" | "en") {
  const labels: Record<TimesheetStatus, { ar: string; en: string }> = {
    DRAFT: { ar: "مسودة", en: "Draft" },
    SUBMITTED: { ar: "مُرسل للمراجعة", en: "Submitted for review" },
    RETURNED: { ar: "معاد للتعديل", en: "Returned for correction" },
    APPROVED: { ar: "معتمد", en: "Approved" },
    REJECTED: { ar: "مرفوض", en: "Rejected" },
  };
  return labels[status][locale];
}

export default function TeamReviewsPage() {
  const { t, locale, capabilities, teamRequestItems, teamTimesheetItems } = useApp();
  const [tab, setTab] = useState<"requests" | "timesheets">("requests");
  const [deciding, setDeciding] = useState<RequestMock | TimesheetMock | null>(null);
  const requestState = useMockList(() => mockFetch(teamRequestItems), [teamRequestItems]);
  const timesheetState = useMockList(() => mockFetch(teamTimesheetItems), [teamTimesheetItems]);
  usePageTitle(t("teamReviewsTitle"));

  if (!capabilities.canReview) {
    return <div className="page"><PageHeader title={t("teamReviewsTitle")} /><Banner tone="warning" role="alert">{t("relatedUnavailable")}</Banner><Link to="/">{t("navHome")}</Link></div>;
  }

  const requestColumns: OperationalColumn<RequestMock>[] = [
    { key: "request", label: t("requestTitle"), render: (request) => <div><Link to={`/reviews/requests/${request.id}`}><bdi>{request.title}</bdi></Link><div className="muted">{pickName(request.request_type.name, locale)}</div></div> },
    { key: "employee", label: t("employee"), render: (request) => <bdi>{pickName(request.requester_name, locale)}</bdi> },
    { key: "status", label: t("status"), render: (request) => <RequestStatusPill status={request.status} /> },
    { key: "submitted", label: t("submittedAt"), render: (request) => formatDateTime(request.submitted_at ?? request.created_at, locale) },
    { key: "next", label: locale === "ar" ? "المرحلة التالية" : "Next stage", render: (request) => requestNextStage(request, locale) },
    { key: "action", label: t("decision"), render: (request) => request.permissions.can_decide ? <button className="btn btn-primary" onClick={() => setDeciding(request)}>{t("decision")}</button> : <span className="muted">{locale === "ar" ? "لا يوجد إجراء" : "No action"}</span> },
  ];
  const timesheetColumns: OperationalColumn<TimesheetMock>[] = [
    { key: "week", label: t("week"), render: (sheet) => <strong><bdi dir="ltr">{sheet.week_start}</bdi></strong> },
    { key: "employee", label: t("employee"), render: (sheet) => <bdi>{pickName(sheet.employee_name, locale)}</bdi> },
    { key: "status", label: t("status"), render: (sheet) => <TimesheetStatusPill status={sheet.status} /> },
    { key: "duration", label: t("totalHours"), render: (sheet) => formatMinutes(sheet.entries.reduce((total, entry) => total + entry.duration_minutes, 0), locale) },
    { key: "submitted", label: t("submittedAt"), render: (sheet) => sheet.events.length ? formatDateTime(sheet.events[sheet.events.length - 1].created_at, locale) : "—" },
    { key: "action", label: t("decision"), render: (sheet) => sheet.permissions.can_decide ? <button className="btn btn-primary" onClick={() => setDeciding(sheet)}>{t("decision")}</button> : <span className="muted">{locale === "ar" ? "لا يوجد إجراء" : "No action"}</span> },
  ];

  const activeState = tab === "requests" ? requestState : timesheetState;
  const records = tab === "requests" ? teamRequestItems : teamTimesheetItems;

  return (
    <div className="page">
      <PageHeader title={t("teamReviewsTitle")} subtitle={locale === "ar" ? "النطاق: المرؤوسون المباشرون النشطون فقط · الأقدم إرسالًا أولًا · بيانات عرض تجريبية" : "Scope: active direct reports only · oldest submitted first · demo data"} />
      <div className="review-tabs" role="tablist" aria-label={t("teamReviewsTitle")} onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const next = event.key === (locale === "ar" ? "ArrowLeft" : "ArrowRight") ? "timesheets" : "requests";
        setTab(next);
        (event.currentTarget.querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
      }}>
        <button role="tab" data-tab="requests" id="tab-requests" aria-selected={tab === "requests"} aria-controls="panel-reviews" tabIndex={tab === "requests" ? 0 : -1} className="review-tab" onClick={() => setTab("requests")}>{t("reviewRequests")}</button>
        <button role="tab" data-tab="timesheets" id="tab-timesheets" aria-selected={tab === "timesheets"} aria-controls="panel-reviews" tabIndex={tab === "timesheets" ? 0 : -1} className="review-tab" onClick={() => setTab("timesheets")}>{t("reviewTimesheets")}</button>
      </div>
      <div role="tabpanel" id="panel-reviews" aria-labelledby={tab === "requests" ? "tab-requests" : "tab-timesheets"}>
        {activeState.phase === "loading" ? <SkeletonRows rows={3} /> : activeState.phase === "error" ? <ErrorState onRetry={activeState.retry} /> : activeState.phase === "empty" || records.length === 0 ? <EmptyState message={t("queueEmpty")} /> : tab === "requests" ? <OperationalTable caption={locale === "ar" ? `${teamRequestItems.length} طلبات بانتظار قرار ضمن نطاقك` : `${teamRequestItems.length} requests awaiting decision in your scope`} columns={requestColumns} records={teamRequestItems} /> : <OperationalTable caption={locale === "ar" ? `${teamTimesheetItems.length} سجلات وقت بانتظار قرار ضمن نطاقك` : `${teamTimesheetItems.length} timesheets awaiting decision in your scope`} columns={timesheetColumns} records={teamTimesheetItems} />}
      </div>
      {deciding ? <DecisionDialog record={deciding} onClose={() => setDeciding(null)} /> : null}
    </div>
  );
}

function DecisionDialog({ record, onClose }: { record: RequestMock | TimesheetMock; onClose: () => void }) {
  const { t, locale, decideDemoRequest, decideDemoTimesheet } = useApp();
  const [kind, setKind] = useState<ReviewDecision | null>(null);
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"editing" | "submitting" | "confirmed" | "error">("editing");
  const [returnedRecord, setReturnedRecord] = useState<RequestMock | TimesheetMock | null>(null);
  const name = isRequest(record) ? pickName(record.requester_name, locale) : pickName(record.employee_name, locale);
  const subject = isRequest(record) ? record.title : `${t("week")}: ${record.week_start}`;
  const currentStatus = isRequest(record) ? requestStatusLabel(record.status, locale) : timesheetStatusLabel(record.status, locale);
  const kindLabel = (decision: ReviewDecision) => decision === "APPROVE" ? t("approve") : decision === "REJECT" ? t("reject") : t("returnForCorrection");
  const resultingStage = (decision: ReviewDecision) => {
    if (decision === "RETURN") return t("stReturned");
    if (decision === "REJECT") return t("stRejected");
    if (isRequest(record) && record.request_type.requires_hr_approval) return t("stPendingHr");
    return t("stApproved");
  };

  const confirmDecision = async () => {
    if (!kind) return;
    if ((kind === "REJECT" || kind === "RETURN") && !comment.trim()) {
      setCommentError(kind === "RETURN" ? t("reasonRequired") : t("rejectReasonRequired"));
      return;
    }
    setPhase("submitting");
    try {
      const returned = isRequest(record)
        ? await decideDemoRequest(record.id, kind, comment.trim())
        : await decideDemoTimesheet(record.id, kind, comment.trim());
      setReturnedRecord(returned);
      setPhase("confirmed");
    } catch {
      setPhase("error");
    }
  };

  return (
    <Dialog title={t("decision")} onClose={onClose} dirty={Boolean(comment.trim()) && phase === "editing"} busy={phase === "submitting"}>
      {phase === "confirmed" && returnedRecord ? (
        <>
          <Banner tone="success">{locale === "ar" ? "أكدت طبقة العرض التجريبية القرار وحدّثت السجل. لن يُحفظ بعد إعادة تحميل الصفحة." : "The demo data layer confirmed the decision and updated the record. It will not persist after reload."}</Banner>
          <p>{t("decisionOn")}: <bdi>{subject}</bdi></p>
          <p>{t("currentState")}: <strong>{isRequest(returnedRecord) ? requestStatusLabel(returnedRecord.status, locale) : timesheetStatusLabel(returnedRecord.status, locale)}</strong></p>
          <div className="dialog-actions"><button className="btn btn-primary" onClick={onClose}>{t("close")}</button></div>
        </>
      ) : (
        <>
          {phase === "error" ? <Banner tone="error" role="alert">{t("errorNetwork")}</Banner> : null}
          <dl className="decision-facts">
            <div><dt>{t("decisionOn")}</dt><dd><bdi>{subject}</bdi></dd></div>
            <div><dt>{t("employee")}</dt><dd><bdi>{name}</bdi></dd></div>
            <div><dt>{t("currentState")}</dt><dd>{currentStatus}</dd></div>
            <div><dt>{locale === "ar" ? "إصدار السجل" : "Record version"}</dt><dd><bdi dir="ltr">{record.version}</bdi></dd></div>
            {kind ? <><div><dt>{t("decisionSummary")}</dt><dd>{kindLabel(kind)}</dd></div><div><dt>{locale === "ar" ? "الحالة الناتجة" : "Resulting state"}</dt><dd>{resultingStage(kind)}</dd></div></> : null}
          </dl>
          {!kind ? (
            <div className="decision-choices">
              <button className="btn btn-primary" onClick={() => setKind("APPROVE")}>{t("approve")}</button>
              <button className="btn btn-secondary" onClick={() => setKind("RETURN")}>{t("returnForCorrection")}</button>
              <button className="btn btn-danger" onClick={() => setKind("REJECT")}>{t("reject")}</button>
            </div>
          ) : (
            <>
              {(kind === "REJECT" || kind === "RETURN") ? <label className="field"><span className="field-label">{t("decisionComment")} ({locale === "ar" ? "مطلوب" : "required"})</span><textarea className="textarea" name="decision-comment" value={comment} aria-invalid={Boolean(commentError)} aria-describedby={commentError ? "decision-comment-error" : undefined} onChange={(event) => { setComment(event.target.value); setCommentError(null); }} />{commentError ? <span className="field-error" id="decision-comment-error">{commentError}</span> : null}</label> : null}
              <Banner tone="info">{locale === "ar" ? "انتقال تجريبي غير دائم؛ لا يوجد اتصال بخادم حقيقي." : "Non-persistent demo transition; no real server is connected."}</Banner>
              <div className="dialog-actions"><button className="btn btn-secondary" disabled={phase === "submitting"} onClick={() => setKind(null)}>{t("back")}</button><button className={kind === "REJECT" ? "btn btn-danger" : "btn btn-primary"} disabled={phase === "submitting"} onClick={confirmDecision}>{phase === "submitting" ? t("saving") : t("confirmDecision")}</button></div>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}

export function ReviewRequestDetailPage() {
  const { id } = useParams();
  const { t, locale, capabilities, teamRequestItems } = useApp();
  const state = useMockList(() => mockFetch(teamRequestItems.find((request) => request.id === id) ?? null, 250), [id, teamRequestItems]);
  usePageTitle(t("details"));
  if (!capabilities.canReview) return <div className="page"><PageHeader title={t("details")} /><Banner tone="warning" role="alert">{t("relatedUnavailable")}</Banner><Link to="/">{t("navHome")}</Link></div>;
  if (state.phase === "loading") return <SkeletonRows rows={3} />;
  if (state.phase === "error") return <ErrorState onRetry={state.retry} />;
  const request = state.phase === "ready" ? state.data : null;
  if (!request) return <div className="page"><PageHeader title={t("details")} /><Banner tone="warning" role="alert">{t("relatedUnavailable")}</Banner><Link to="/reviews">{t("back")}</Link></div>;
  return <div className="page reading-page"><PageHeader title={<bdi>{request.title}</bdi>} subtitle={`${t("employee")}: ${pickName(request.requester_name, locale)}`} breadcrumb={<Link to="/reviews">{t("teamReviewsTitle")}</Link>} /><div className="status-action-block"><RequestStatusPill status={request.status} /><p>{requestNextStage(request, locale)}</p></div><section className="work-surface section" aria-labelledby="review-details"><h2 id="review-details">{t("requestDetails")}</h2><p className="preserve-lines"><bdi>{request.details}</bdi></p></section><section className="section" aria-labelledby="review-history"><h2 id="review-history">{t("history")}</h2><Timeline events={request.events} /></section><Banner tone="info">{locale === "ar" ? "القرارات التجريبية غير دائمة ومتاحة من طابور المراجعات." : "Demo decisions are non-persistent and available from the review queue."}</Banner></div>;
}
