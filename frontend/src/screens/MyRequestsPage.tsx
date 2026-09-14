/** S03 — My requests list + new-request editor with draft/submit and demo state controls. */
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp, usePageTitle } from "../app/AppContext";
import { useMockList, formatDateTime } from "../app/useMockList";
import { mockFetch, myRequests, requestTypes } from "../mock/data";
import { Banner, EmptyState, ErrorState, RequestStatusPill, SkeletonRows } from "../components/ui";

export default function MyRequestsPage() {
  const { t, locale } = useApp();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const list = useMockList(() => mockFetch(myRequests), []);
  usePageTitle(t("myRequestsTitle"));

  const filtered =
    list.phase === "ready"
      ? statusFilter === "all"
        ? myRequests
        : myRequests.filter((r) => r.status === statusFilter)
      : [];

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h1>{t("myRequestsTitle")}</h1>
        <button className="btn btn-primary" onClick={() => navigate("/requests/new")}>
          + {t("newRequest")}
        </button>
      </div>

      {list.phase === "loading" && <SkeletonRows rows={4} />}
      {list.phase === "error" && <ErrorState onRetry={list.retry} />}
      {list.phase === "empty" && <EmptyState message={t("noRequestsYet")} />}
      {list.phase === "ready" && (
        <>
          <label className="field" style={{ maxWidth: 280 }}>
            <span className="field-label">{t("status")}</span>
            <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">{locale === "ar" ? "الكل" : "All"}</option>
              <option value="DRAFT">{t("stDraft")}</option>
              <option value="PENDING_MANAGER">{t("stPendingManager")}</option>
              <option value="PENDING_HR">{t("stPendingHr")}</option>
              <option value="APPROVED">{t("stApproved")}</option>
              <option value="RETURNED">{t("stReturned")}</option>
              <option value="REJECTED">{t("stRejected")}</option>
            </select>
          </label>

          {filtered.length === 0 ? (
            <EmptyState message={t("noRequestsFiltered")} />
          ) : (
            <div className="table-wrap">
              <table>
                <caption className="field-hint" style={{ textAlign: "start" }}>
                  {filtered.length} {locale === "ar" ? "سجل" : "records"}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t("requestTitle")}</th>
                    <th scope="col">{t("requestType")}</th>
                    <th scope="col">{t("status")}</th>
                    <th scope="col">{t("lastUpdate")}</th>
                    <th scope="col">{t("details")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/requests/${r.id}`}>
                          <bdi>{r.title}</bdi>
                        </Link>
                      </td>
                      <td>{r.request_type.name[locale]}</td>
                      <td>
                        <RequestStatusPill status={r.status} />
                      </td>
                      <td>{formatDateTime(r.updated_at, locale)}</td>
                      <td>
                        <Link to={`/requests/${r.id}`}>{t("details")}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** S03 editor — new request draft (demo; no server submission is claimed). */
export function NewRequestPage() {
  const { t, locale } = useApp();
  const navigate = useNavigate();
  const titleRef = useRef<HTMLInputElement>(null);
  const [typeId, setTypeId] = useState<number>(requestTypes[0].id);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [errors, setErrors] = useState<{ title?: string }>({});
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const selectedType = requestTypes.find((r) => r.id === typeId) ?? requestTypes[0];

  const validate = (): boolean => {
    const next: { title?: string } = {};
    if (!title.trim()) next.title = locale === "ar" ? "أدخل عنوان الطلب." : "Enter a request title.";
    setErrors(next);
    if (next.title) titleRef.current?.focus();
    return Object.keys(next).length === 0;
  };

  const hasUnsaved = Boolean(title.trim() || details.trim());

  const save = (submit: boolean) => {
    if (!validate()) return;
    setBusy(true);
    // Demo only: simulates the explicit draft-save / submit acknowledgement.
    window.setTimeout(() => {
      setBusy(false);
      setSavedMsg(submit ? t("requestSubmitted") : t("draftSaved"));
      window.setTimeout(() => navigate("/requests"), 900);
    }, 500);
  };

  return (
    <>
      <h1>{t("newRequest")}</h1>
      <form style={{ maxWidth: "var(--form-max)" }} noValidate>
        <label className="field">
          <span className="field-label">{t("requestType")}</span>
          <select className="select" value={typeId} onChange={(e) => setTypeId(Number(e.target.value))}>
            {requestTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name[locale]}
              </option>
            ))}
          </select>
          <span className="field-hint">
            {selectedType.requires_hr_approval
              ? locale === "ar"
                ? "هذا النوع يتطلب مراجعة الموارد البشرية بعد المدير."
                : "This type requires HR review after the manager."
              : locale === "ar"
                ? "هذا النوع تتم مراجعته بواسطة المدير."
                : "This type is reviewed by the manager."}
          </span>
        </label>
        <label className="field">
          <span className="field-label">
            {t("requestTitle")} <span style={{ color: "var(--error-text)" }} aria-hidden="true">*</span>
            <span className="visually-hidden">({locale === "ar" ? "مطلوب" : "required"})</span>
          </span>
          <input
            ref={titleRef}
            className="input"
            value={title}
            required
            autoComplete="off"
            spellCheck={false}
            placeholder={locale === "ar" ? "مثال: طلب إجازة سنوية…" : "e.g. Annual leave request…"}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "title-error" : undefined}
            onChange={(e) => setTitle(e.target.value)}
          />
          {errors.title && (
            <span className="field-error" id="title-error" role="alert">
              {errors.title}
            </span>
          )}
        </label>
        <label className="field">
          <span className="field-label">{t("requestDetails")}</span>
          <textarea className="textarea" value={details} onChange={(e) => setDetails(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{t("attachments")}</span>
          <input className="input" type="file" disabled />
          <span className="field-hint">{t("attachmentsNote")}</span>
          <span className="field-hint">
            {locale === "ar"
              ? "(رفع المرفقات غير مفعّل في هذه النسخة التجريبية)"
              : "(attachment upload is not enabled in this demo build)"}
          </span>
        </label>

        {savedMsg && (
          <Banner tone="success" role="status">
            {savedMsg}
          </Banner>
        )}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              if (hasUnsaved) {
                setConfirmLeave(true);
              } else {
                navigate("/requests");
              }
            }}
          >
            {t("back")}
          </button>
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => save(false)}>
            {t("saveDraft")}
          </button>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => save(true)}>
            {busy ? (
              <>
                <span aria-hidden="true" className="spinner" />
                {t("saving")}
              </>
            ) : (
              t("submitRequest")
            )}
          </button>
        </div>

        {confirmLeave && (
          <Banner tone="warning" role="alert">
            <div>
              <p style={{ margin: "0 0 8px" }}>
                {locale === "ar"
                  ? "لديك تعديلات غير محفوظة. هل تريد الخروج دون حفظ؟"
                  : "You have unsaved changes. Leave without saving?"}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn btn-secondary"
                  type="button"
                  style={{ minHeight: 36 }}
                  onClick={() => {
                    setConfirmLeave(false);
                    navigate("/requests");
                  }}
                >
                  {locale === "ar" ? "خروج دون حفظ" : "Leave without saving"}
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  style={{ minHeight: 36 }}
                  onClick={() => setConfirmLeave(false)}
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          </Banner>
        )}
      </form>
    </>
  );
}
