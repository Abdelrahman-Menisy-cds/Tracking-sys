/**
 * S06 — Manager/HR review queue (requests + timesheets tabs) and S04 decision modal.
 * Decisions require explicit confirmation; reject/return require a visible reason.
 * No preselected adverse decision; focus is trapped in the dialog.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../app/AppContext";
import { useMockList, formatDateTime, formatMinutes } from "../app/useMockList";
import {
  mockFetch,
  teamRequests,
  teamTimesheets,
  pickName,
  type RequestMock,
  type TimesheetMock,
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

type DecisionKind = "APPROVE" | "REJECT" | "RETURN";

export default function TeamReviewsPage() {
  const { t, locale } = useApp();
  const [tab, setTab] = useState<"requests" | "timesheets">("requests");
  const [deciding, setDeciding] = useState<RequestMock | TimesheetMock | null>(null);

  const reqState = useMockList(() => mockFetch(teamRequests), []);
  const tsState = useMockList(() => mockFetch(teamTimesheets), []);

  return (
    <>
      <h1>{t("teamReviewsTitle")}</h1>
      <p style={{ color: "var(--text-muted)" }}>
        {locale === "ar"
          ? "النطاق: المرؤوسون المباشرون فقط (نطاق تجريبي)."
          : "Scope: active direct reports only (demo scope)."}
      </p>

      <div role="tablist" aria-label={t("teamReviewsTitle")} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          role="tab"
          aria-selected={tab === "requests"}
          className={`btn ${tab === "requests" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setTab("requests")}
        >
          {t("reviewRequests")}
        </button>
        <button
          role="tab"
          aria-selected={tab === "timesheets"}
          className={`btn ${tab === "timesheets" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setTab("timesheets")}
        >
          {t("reviewTimesheets")}
        </button>
      </div>

      {tab === "requests" ? (
        reqState.phase === "loading" ? (
          <SkeletonRows rows={3} />
        ) : reqState.phase === "error" ? (
          <ErrorState onRetry={reqState.retry} />
        ) : reqState.phase === "empty" ? (
          <EmptyState message={t("queueEmpty")} />
        ) : teamRequests.length === 0 ? (
          <EmptyState message={t("queueEmpty")} />
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {teamRequests.map((r) => (
              <li key={r.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <Link to={`/reviews/requests/${r.id}`}>
                      <bdi>{r.title}</bdi>
                    </Link>
                    <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
                      {t("requester")}: <bdi>{pickName(r.requester_name, locale)}</bdi> ·{" "}
                      {t("requestType")}: {pickName(r.request_type.name, locale)} ·{" "}
                      {formatDateTime(r.submitted_at ?? r.created_at, locale)}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <RequestStatusPill status={r.status} />
                    {r.permissions.can_decide && (
                      <button className="btn btn-primary" onClick={() => setDeciding(r)}>
                        {t("decision")}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : tsState.phase === "loading" ? (
        <SkeletonRows rows={3} />
      ) : tsState.phase === "error" ? (
        <ErrorState onRetry={tsState.retry} />
      ) : tsState.phase === "empty" ? (
        <EmptyState message={t("queueEmpty")} />
      ) : teamTimesheets.length === 0 ? (
        <EmptyState message={t("queueEmpty")} />
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {teamTimesheets.map((ts) => (
            <li key={ts.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <strong>
                    {t("week")}: {ts.week_start}
                  </strong>
                  <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
                    {t("employee")}: <bdi>{pickName(ts.employee_name, locale)}</bdi> ·{" "}
                    {t("totalHours")}: {formatMinutes(ts.entries.reduce((s, e) => s + e.duration_minutes, 0), locale)}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <TimesheetStatusPill status={ts.status} />
                  {ts.permissions.can_decide && (
                    <button className="btn btn-primary" onClick={() => setDeciding(ts)}>
                      {t("decision")}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {deciding && <DecisionDialog record={deciding} onClose={() => setDeciding(null)} />}
    </>
  );
}

function isRequest(r: RequestMock | TimesheetMock): r is RequestMock {
  return (r as RequestMock).request_type !== undefined;
}

function DecisionDialog({ record, onClose }: { record: RequestMock | TimesheetMock; onClose: () => void }) {
  const { t, locale } = useApp();
  const [kind, setKind] = useState<DecisionKind | null>(null);
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const name = isRequest(record)
    ? pickName(record.title ? record.requester_name : record.requester_name, locale)
    : pickName(record.employee_name, locale);
  const subject = isRequest(record) ? record.title : `${t("week")}: ${record.week_start}`;
  const currentStatus = isRequest(record) ? record.status : record.status;

  const choose = (k: DecisionKind) => {
    setKind(k);
    setCommentError(null);
  };

  const doConfirm = () => {
    if ((kind === "REJECT" || kind === "RETURN") && !comment.trim()) {
      setCommentError(kind === "RETURN" ? t("reasonRequired") : t("rejectReasonRequired"));
      return;
    }
    setDone(true);
  };

  const kindLabel = (k: DecisionKind) => (k === "APPROVE" ? t("approve") : k === "REJECT" ? t("reject") : t("returnForCorrection"));

  return (
    <Dialog title={t("decision")} onClose={onClose}>
      {done ? (
        <>
          <Banner tone="info">{t("decisionSent")}</Banner>
          <p>
            {t("decisionOn")}: <bdi>{subject}</bdi> — <strong>{kindLabel(kind!)}</strong>
          </p>
          <div className="dialog-actions">
            <button className="btn btn-primary" onClick={onClose}>
              {t("close")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            {t("decisionOn")}: <strong><bdi>{subject}</bdi></strong>
            <br />
            {t("requester")}/{t("employee")}: <bdi>{name}</bdi>
            <br />
            {t("currentState")}: {currentStatus}
          </p>

          {!kind ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {/* No preselected decision; adverse actions are not defaults */}
              <button className="btn btn-primary" onClick={() => choose("APPROVE")}>
                ✓ {t("approve")}
              </button>
              <button className="btn btn-secondary" onClick={() => choose("RETURN")}>
                ↩ {t("returnForCorrection")}
              </button>
              <button className="btn btn-danger" onClick={() => choose("REJECT")}>
                ✕ {t("reject")}
              </button>
            </div>
          ) : (
            <>
              <p>
                <strong>{t("decisionSummary")}:</strong> {kindLabel(kind)}
              </p>
              {(kind === "REJECT" || kind === "RETURN") && (
                <label className="field">
                  <span className="field-label">{t("decisionComment")} *</span>
                  <textarea
                    className="textarea"
                    value={comment}
                    aria-invalid={!!commentError}
                    aria-describedby={commentError ? "decision-comment-error" : undefined}
                    onChange={(e) => {
                      setComment(e.target.value);
                      setCommentError(null);
                    }}
                  />
                  {commentError && (
                    <span className="field-error" id="decision-comment-error">
                      {commentError}
                    </span>
                  )}
                </label>
              )}
              <div className="dialog-actions">
                <button className="btn btn-secondary" onClick={() => setKind(null)}>
                  {t("back")}
                </button>
                <button
                  className={`btn ${kind === "APPROVE" ? "btn-primary" : kind === "REJECT" ? "btn-danger" : "btn-secondary"}`}
                  onClick={doConfirm}
                >
                  {t("confirmDecision")}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}

/** Reviewer-facing request detail (read-only, from review scope). */
export function ReviewRequestDetailPage() {
  const { id } = useParams();
  const { t, locale } = useApp();
  const state = useMockList(() => mockFetch(teamRequests.find((r) => r.id === id) ?? null, 250), [id]);

  if (state.phase === "loading") return <SkeletonRows rows={3} />;
  if (state.phase === "error") return <ErrorState onRetry={state.retry} />;
  const request = state.phase === "ready" ? state.data : null;

  if (!request) {
    return (
      <>
        <h1>{t("details")}</h1>
        <Banner tone="warning" role="alert">{t("relatedUnavailable")}</Banner>
        <Link to="/reviews">{t("back")}</Link>
      </>
    );
  }

  return (
    <>
      <nav aria-label={t("back")}>
        <Link to="/reviews">← {t("teamReviewsTitle")}</Link>
      </nav>
      <header style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "12px 0" }}>
        <h1 style={{ margin: 0 }}>
          <bdi>{request.title}</bdi>
        </h1>
        <RequestStatusPill status={request.status} />
      </header>
      <p style={{ color: "var(--text-muted)" }}>
        {t("requester")}: <bdi>{pickName(request.requester_name, locale)}</bdi>
      </p>
      <section className="card">
        <h2>{t("requestDetails")}</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>
          <bdi>{request.details}</bdi>
        </p>
      </section>
      <section className="card">
        <h2>{t("history")}</h2>
        <ol style={{ paddingInlineStart: 20 }}>
          {request.events.map((ev) => (
            <li key={ev.id}>
              <strong>{ev.action}</strong> → {ev.to_status} — <bdi>{ev.actor}</bdi>
              <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{formatDateTime(ev.created_at, locale)}</div>
              {ev.comment && (
                <div style={{ marginInlineStart: 8 }}>
                  <bdi>{ev.comment}</bdi>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>
      <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
        {locale === "ar"
          ? "القرارات تُتخذ من طابور المراجعات في هذه النسخة التجريبية."
          : "Decisions are taken from the review queue in this demo build."}
      </p>
    </>
  );
}
