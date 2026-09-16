import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getDemoMutationIssue,
  useApp,
  usePageTitle,
  type ReviewDecision,
} from "../app/AppContext";
import { formatDate, formatDateTime, formatMinutes, useMockList, weekInterval } from "../app/useMockList";
import {
  mockFetch,
  pickName,
  type RequestMock,
  type RequestStatus,
  type TimesheetMock,
  type TimesheetStatus,
} from "../mock/data";
import {
  Banner,
  Dialog,
  EmptyState,
  ErrorState,
  RequestStatusPill,
  SkeletonRows,
  TimesheetStatusPill,
} from "../components/ui";
import OperationalTable, { type OperationalColumn } from "../components/data/OperationalTable";
import PageHeader from "../components/layout/PageHeader";
import Timeline from "../components/record/Timeline";

function isRequest(record: RequestMock | TimesheetMock): record is RequestMock {
  return "request_type" in record;
}

function requestNextStage(request: RequestMock, locale: "ar" | "en") {
  if (request.status !== "PENDING_MANAGER") {
    return locale === "ar" ? "لا يوجد إجراء مراجعة متاح" : "No review action available";
  }
  if (request.request_type.requires_hr_approval) {
    return locale === "ar" ? "بعد الاعتماد: مراجعة الموارد البشرية" : "After approval: HR review";
  }
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
  const [queueResult, setQueueResult] = useState<{ subject: string; status: string; stage: string; version: number } | null>(null);
  const queueHeadingRef = useRef<HTMLHeadingElement>(null);
  const requestState = useMockList(() => mockFetch(teamRequestItems), [teamRequestItems]);
  const timesheetState = useMockList(() => mockFetch(teamTimesheetItems), [teamTimesheetItems]);
  usePageTitle(t("teamReviewsTitle"));

  if (!capabilities.canReview) {
    return (
      <div className="page">
        <PageHeader title={t("teamReviewsTitle")} />
        <Banner tone="warning" role="alert">{t("relatedUnavailable")}</Banner>
        <Link to="/">{t("navHome")}</Link>
      </div>
    );
  }

  const pendingRequests = teamRequestItems.filter(
    (request) => request.status === "PENDING_MANAGER" && request.permissions.can_decide,
  );
  const pendingTimesheets = teamTimesheetItems.filter(
    (sheet) => sheet.status === "SUBMITTED" && sheet.permissions.can_decide,
  );

  const requestColumns: OperationalColumn<RequestMock>[] = [
    {
      key: "request",
      label: t("requestTitle"),
      render: (request) => (
        <div>
          <Link to={`/reviews/requests/${request.id}`}><bdi>{request.title}</bdi></Link>
          <div className="muted">{pickName(request.request_type.name, locale)}</div>
        </div>
      ),
    },
    { key: "employee", label: t("employee"), render: (request) => <bdi>{pickName(request.requester_name, locale)}</bdi> },
    { key: "status", label: t("status"), render: (request) => <RequestStatusPill status={request.status} /> },
    { key: "submitted", label: t("submittedAt"), render: (request) => formatDateTime(request.submitted_at ?? request.created_at, locale) },
    { key: "next", label: locale === "ar" ? "المرحلة التالية" : "Next stage", render: (request) => requestNextStage(request, locale) },
    {
      key: "action",
      label: t("decision"),
      render: (request) => (
        <button className="btn btn-primary" onClick={() => setDeciding(request)}>
          {t("decision")}
        </button>
      ),
    },
  ];

  const timesheetColumns: OperationalColumn<TimesheetMock>[] = [
    {
      key: "week",
      label: t("week"),
      render: (sheet) => (
        <Link to={`/reviews/timesheets/${sheet.id}`}>
          <bdi>{weekInterval(sheet.week_start, locale)}</bdi>
        </Link>
      ),
    },
    { key: "employee", label: t("employee"), render: (sheet) => <bdi>{pickName(sheet.employee_name, locale)}</bdi> },
    { key: "status", label: t("status"), render: (sheet) => <TimesheetStatusPill status={sheet.status} /> },
    { key: "duration", label: t("totalHours"), render: (sheet) => formatMinutes(sheet.entries.reduce((total, entry) => total + entry.duration_minutes, 0), locale) },
    { key: "submitted", label: t("submittedAt"), render: (sheet) => sheet.events.length ? formatDateTime(sheet.events[sheet.events.length - 1].created_at, locale) : "—" },
    {
      key: "action",
      label: t("decision"),
      render: (sheet) => (
        <button className="btn btn-primary" onClick={() => setDeciding(sheet)}>
          {t("decision")}
        </button>
      ),
    },
  ];

  const activeState = tab === "requests" ? requestState : timesheetState;
  const records = tab === "requests" ? pendingRequests : pendingTimesheets;

  const closeAfterDecision = (record: RequestMock | TimesheetMock) => {
    const subject = isRequest(record) ? record.title : weekInterval(record.week_start, locale);
    const status = isRequest(record)
      ? requestStatusLabel(record.status, locale)
      : timesheetStatusLabel(record.status, locale);
    const stage = isRequest(record) && record.status === "PENDING_HR"
      ? t("stPendingHr")
      : status;
    setQueueResult({ subject, status, stage, version: record.version });
    setDeciding(null);
    window.setTimeout(() => queueHeadingRef.current?.focus(), 0);
  };

  return (
    <div className="page">
      <PageHeader
        title={t("teamReviewsTitle")}
        subtitle={locale === "ar"
          ? "النطاق التجريبي: المرؤوسون المباشرون النشطون فقط · الأقدم إرسالًا أولًا · لا يمثل تفويض خادم"
          : "Demo scope: active direct reports only · oldest submitted first · not server authorization"}
      />
      <h2 className="visually-hidden" ref={queueHeadingRef} tabIndex={-1} data-review-queue-heading>
        {locale === "ar" ? "طابور المراجعة المعلق" : "Pending review queue"}
      </h2>
      {queueResult ? (
        <Banner tone="success">
          <span>
            {locale === "ar" ? "تم تأكيد القرار التجريبي وإزالته من الطابور المعلق." : "The demo decision was confirmed and removed from the pending queue."}
            {" "}{t("decisionOn")}: <bdi>{queueResult.subject}</bdi> · {t("currentState")}: {queueResult.status} · {locale === "ar" ? "المرحلة الناتجة" : "Resulting stage"}: {queueResult.stage} · {locale === "ar" ? "الإصدار" : "Version"}: <bdi dir="ltr">{queueResult.version}</bdi>
          </span>
        </Banner>
      ) : null}
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
        {(activeState.phase === "empty" || (activeState.phase === "ready" && records.length === 0))
          ? <EmptyState message={locale === "ar" ? "لا توجد عناصر بانتظار مراجعتك حاليًا." : "Nothing is currently awaiting your review."} action={<Link className="btn btn-secondary" to="/">{t("navHome")}</Link>} />
          : null}
        {activeState.phase === "ready" && records.length > 0 && tab === "requests" ? (
          <OperationalTable
            caption={locale === "ar" ? `${pendingRequests.length} طلبات بانتظار قرار ضمن نطاق العرض` : `${pendingRequests.length} requests awaiting a decision in the demo scope`}
            columns={requestColumns}
            records={pendingRequests}
          />
        ) : null}
        {activeState.phase === "ready" && records.length > 0 && tab === "timesheets" ? (
          <>
            <p className="muted">{locale === "ar" ? "الأسابيع من الاثنين إلى الأحد · المنطقة الزمنية للمؤسسة: Africa/Cairo" : "Weeks run Monday–Sunday · organization timezone: Africa/Cairo"}</p>
            <OperationalTable
              caption={locale === "ar" ? `${pendingTimesheets.length} سجلات وقت بانتظار قرار ضمن نطاق العرض` : `${pendingTimesheets.length} timesheets awaiting a decision in the demo scope`}
              columns={timesheetColumns}
              records={pendingTimesheets}
            />
          </>
        ) : null}
      </div>
      {deciding ? (
        <DecisionDialog
          record={deciding}
          onCancel={() => setDeciding(null)}
          onConfirmed={closeAfterDecision}
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
  record: RequestMock | TimesheetMock;
  onCancel: () => void;
  onConfirmed: (record: RequestMock | TimesheetMock) => void;
}) {
  const { t, locale, decideDemoRequest, decideDemoTimesheet } = useApp();
  const [kind, setKind] = useState<ReviewDecision | null>(null);
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"editing" | "submitting" | "confirmed" | "conflict" | "unknown" | "error">("editing");
  const [returnedRecord, setReturnedRecord] = useState<RequestMock | TimesheetMock | null>(null);
  const closeAndRestoreQueue = () => {
    onCancel();
    window.setTimeout(() => document.querySelector<HTMLElement>("[data-review-queue-heading]")?.focus(), 0);
  };
  const name = isRequest(record) ? pickName(record.requester_name, locale) : pickName(record.employee_name, locale);
  const subject = isRequest(record) ? record.title : weekInterval(record.week_start, locale);
  const currentStatus = isRequest(record) ? requestStatusLabel(record.status, locale) : timesheetStatusLabel(record.status, locale);
  const kindLabel = (decision: ReviewDecision) => decision === "APPROVE" ? t("approve") : decision === "REJECT" ? t("reject") : t("returnForCorrection");
  const resultingStage = (decision: ReviewDecision, result = record) => {
    if (isRequest(result)) return requestStatusLabel(result.status, locale);
    if (decision === "RETURN") return t("stReturned");
    if (decision === "REJECT") return t("stRejected");
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
        ? await decideDemoRequest(record.id, kind, comment.trim(), record.version)
        : await decideDemoTimesheet(record.id, kind, comment.trim(), record.version);
      setReturnedRecord(returned);
      setPhase("confirmed");
    } catch (error) {
      const issue = getDemoMutationIssue(error);
      if (issue === "conflict") setPhase("conflict");
      else if (issue === "unknown") setPhase("unknown");
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
      onClose={phase === "confirmed" && returnedRecord ? () => onConfirmed(returnedRecord) : closeAndRestoreQueue}
      dirty={Boolean(comment.trim()) && phase === "editing"}
      busy={phase === "submitting"}
      restoreFocus={false}
    >
      {phase === "confirmed" && returnedRecord ? (
        <>
          <Banner tone="success">
            {locale === "ar" ? "أكدت طبقة العرض التجريبية القرار وحدّثت السجل. لن يُحفظ بعد إعادة تحميل الصفحة." : "The demo data layer confirmed the decision and updated the record. It will not persist after reload."}
          </Banner>
          <dl className="decision-facts">
            <div><dt>{t("decisionOn")}</dt><dd><bdi>{subject}</bdi></dd></div>
            <div><dt>{t("currentState")}</dt><dd><strong>{isRequest(returnedRecord) ? requestStatusLabel(returnedRecord.status, locale) : timesheetStatusLabel(returnedRecord.status, locale)}</strong></dd></div>
            <div><dt>{locale === "ar" ? "المرحلة الناتجة" : "Resulting stage"}</dt><dd><strong>{resultingStage(kind!, returnedRecord)}</strong></dd></div>
            <div><dt>{locale === "ar" ? "إصدار السجل المؤكد" : "Confirmed record version"}</dt><dd><bdi dir="ltr">{returnedRecord.version}</bdi></dd></div>
            <div><dt>{locale === "ar" ? "آخر حدث" : "Latest event"}</dt><dd>{formatDateTime(returnedRecord.events[returnedRecord.events.length - 1].created_at, locale)}</dd></div>
          </dl>
          <div className="dialog-actions">
            <button className="btn btn-primary" onClick={() => onConfirmed(returnedRecord)}>{t("close")}</button>
          </div>
        </>
      ) : phase === "conflict" || phase === "unknown" ? (
        <>
          <Banner tone="warning" role="alert">
            {phase === "conflict"
              ? locale === "ar" ? "تغيّر السجل منذ فتح القرار. لم نرسل القرار مرة أخرى. أغلق النافذة وافتح أحدث سجل قبل اتخاذ قرار جديد." : "The record changed after this decision opened. The decision was not replayed. Close and inspect the latest record before deciding again."
              : locale === "ar" ? "لم نتلقَّ تأكيدًا للقرار. لا نعرف إن كان قد طُبّق، ولن نعيد إرساله تلقائيًا. حدّث الطابور وتحقق من السجل قبل أي محاولة جديدة." : "Decision confirmation was not received. Its outcome is unknown and it will not be replayed automatically. Refresh the queue and inspect the record before any new attempt."}
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
                <div><dt>{locale === "ar" ? "الحالة المتوقعة" : "Expected resulting state"}</dt><dd>{kind === "APPROVE" && isRequest(record) && record.request_type.requires_hr_approval ? t("stPendingHr") : kind === "RETURN" ? t("stReturned") : kind === "REJECT" ? t("stRejected") : t("stApproved")}</dd></div>
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
              <Banner tone="info">{locale === "ar" ? "انتقال تجريبي غير دائم؛ لا يوجد اتصال بخادم حقيقي ولا يمثل هذا التفويض." : "Non-persistent demo transition; no real server is connected and this is not authorization."}</Banner>
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
  const { t, locale, capabilities, teamRequestItems } = useApp();
  const state = useMockList(() => mockFetch(teamRequestItems.find((request) => request.id === id) ?? null, 250), [id, teamRequestItems]);
  usePageTitle(t("details"));
  if (!capabilities.canReview) return <SafeReviewUnavailable />;
  if (state.phase === "loading") return <SkeletonRows rows={3} />;
  if (state.phase === "error") return <ErrorState onRetry={state.retry} />;
  const request = state.phase === "ready" ? state.data : null;
  if (!request) return <SafeReviewUnavailable backToReviews />;
  return (
    <div className="page reading-page">
      <PageHeader title={<bdi>{request.title}</bdi>} subtitle={`${t("employee")}: ${pickName(request.requester_name, locale)}`} breadcrumb={<Link to="/reviews">{t("teamReviewsTitle")}</Link>} />
      <div className="status-action-block"><RequestStatusPill status={request.status} /><p>{requestNextStage(request, locale)}</p></div>
      <section className="work-surface section" aria-labelledby="review-details"><h2 id="review-details">{t("requestDetails")}</h2><p className="preserve-lines"><bdi>{request.details}</bdi></p></section>
      <section className="section" aria-labelledby="review-history"><h2 id="review-history">{t("history")}</h2><Timeline events={request.events} /></section>
      <Banner tone="info">{locale === "ar" ? "هذه بيانات نطاق تجريبي وليست دليلاً على التفويض. القرارات غير دائمة ومتاحة من الطابور." : "This is demo-scoped data, not authorization evidence. Non-persistent decisions are available from the queue."}</Banner>
    </div>
  );
}

export function ReviewTimesheetDetailPage() {
  const { id } = useParams();
  const { t, locale, capabilities, teamTimesheetItems } = useApp();
  const state = useMockList(() => mockFetch(teamTimesheetItems.find((sheet) => sheet.id === id) ?? null, 250), [id, teamTimesheetItems]);
  usePageTitle(t("details"));
  if (!capabilities.canReview) return <SafeReviewUnavailable />;
  if (state.phase === "loading") return <SkeletonRows rows={3} />;
  if (state.phase === "error") return <ErrorState onRetry={state.retry} />;
  const sheet = state.phase === "ready" ? state.data : null;
  if (!sheet) return <SafeReviewUnavailable backToReviews />;
  const worked = sheet.entries.reduce((sum, entry) => sum + entry.duration_minutes, 0);
  const breaks = sheet.entries.reduce((sum, entry) => sum + entry.unpaid_break_minutes, 0);
  return (
    <div className="page reading-page">
      <PageHeader
        title={<>{t("week")}: <bdi>{weekInterval(sheet.week_start, locale)}</bdi></>}
        subtitle={`${t("employee")}: ${pickName(sheet.employee_name, locale)} · ${locale === "ar" ? "المنطقة الزمنية للمؤسسة" : "Organization timezone"}: Africa/Cairo`}
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
                <dt><bdi>{formatDate(entry.work_date, locale)}</bdi></dt>
                <dd>{formatMinutes(entry.duration_minutes, locale)} · {t("breakTime")}: {formatMinutes(entry.unpaid_break_minutes, locale)}{entry.description ? <> · <bdi>{entry.description}</bdi></> : null}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="muted">{locale === "ar" ? "لا توجد إدخالات ضمن الاستجابة التجريبية." : "No entries are present in the demo response."}</p>}
      </section>
      <section className="section" aria-labelledby="review-timesheet-history"><h2 id="review-timesheet-history">{t("history")}</h2><Timeline events={sheet.events} /></section>
      <Banner tone="info">{locale === "ar" ? "قرار سجل الوقت متاح من طابور المراجعة بعد فحص هذا الدليل." : "The timesheet decision is available from the review queue after inspecting this evidence."}</Banner>
    </div>
  );
}

function SafeReviewUnavailable({ backToReviews = false }: { backToReviews?: boolean }) {
  const { t } = useApp();
  return (
    <div className="page">
      <PageHeader title={t("details")} />
      <Banner tone="warning" role="alert">{t("relatedUnavailable")}</Banner>
      <Link to={backToReviews ? "/reviews" : "/"}>{backToReviews ? t("back") : t("navHome")}</Link>
    </div>
  );
}
