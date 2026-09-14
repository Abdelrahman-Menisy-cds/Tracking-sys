import { useEffect, useRef, type ReactNode } from "react";
import { useApp } from "../app/AppContext";
import type { RequestStatus, TimesheetStatus } from "../mock/data";

type StatusKey = "stDraft" | "stPendingManager" | "stPendingHr" | "stApproved" | "stRejected" | "stReturned" | "stCancelled" | "stSubmitted";
type StatusMeta = { tone: string; icon: string; key: StatusKey };

const requestStatusMeta: Record<RequestStatus, StatusMeta> = {
  DRAFT: { tone: "pill-neutral", icon: "○", key: "stDraft" },
  PENDING_MANAGER: { tone: "pill-info", icon: "◷", key: "stPendingManager" },
  PENDING_HR: { tone: "pill-info", icon: "◷", key: "stPendingHr" },
  APPROVED: { tone: "pill-success", icon: "✓", key: "stApproved" },
  REJECTED: { tone: "pill-error", icon: "×", key: "stRejected" },
  RETURNED: { tone: "pill-warning", icon: "↩", key: "stReturned" },
  CANCELLED: { tone: "pill-neutral", icon: "–", key: "stCancelled" },
};
const timesheetStatusMeta: Record<TimesheetStatus, StatusMeta> = {
  DRAFT: requestStatusMeta.DRAFT,
  SUBMITTED: { tone: "pill-info", icon: "◷", key: "stSubmitted" },
  RETURNED: requestStatusMeta.RETURNED,
  APPROVED: requestStatusMeta.APPROVED,
  REJECTED: requestStatusMeta.REJECTED,
};

function StatusPill({ meta }: { meta: StatusMeta }) {
  const { t } = useApp();
  return <span className={`pill ${meta.tone}`}><span aria-hidden="true">{meta.icon}</span>{t(meta.key)}</span>;
}
export function RequestStatusPill({ status }: { status: RequestStatus }) { return <StatusPill meta={requestStatusMeta[status]} />; }
export function TimesheetStatusPill({ status }: { status: TimesheetStatus }) { return <StatusPill meta={timesheetStatusMeta[status]} />; }

export function Banner({ tone, children, role = "status" }: { tone: "info" | "success" | "error" | "warning" | "neutral"; children: ReactNode; role?: "status" | "alert" }) {
  return <div className={`banner banner-${tone}`} role={role}>{children}</div>;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  const { t } = useApp();
  return <div aria-busy="true" aria-live="polite"><span className="visually-hidden">{t("loading")}</span>{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton-row" aria-hidden="true"><div className="skeleton" style={{ width: "42%", height: 18 }} /><div className="skeleton" style={{ width: "78%", height: 16 }} /><div className="skeleton" style={{ width: "26%", height: 16 }} /></div>)}</div>;
}
export function EmptyState({ message, action }: { message: string; action?: ReactNode }) { return <div className="empty-region"><p>{message}</p>{action}</div>; }
export function ErrorState({ onRetry }: { onRetry: () => void }) { const { t } = useApp(); return <div className="error-region" role="alert"><p>{t("errorNetwork")}</p><button className="btn btn-secondary" onClick={onRetry}>{t("retry")}</button></div>; }

export function Dialog({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  const { t } = useApp(); const headingRef = useRef<HTMLHeadingElement>(null); const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const previouslyFocused = document.activeElement as HTMLElement | null; headingRef.current?.focus(); document.body.classList.add("dialog-open"); return () => { document.body.classList.remove("dialog-open"); previouslyFocused?.focus(); }; }, []);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); return; } if (event.key !== "Tab" || !overlayRef.current) return; const focusables = [...overlayRef.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]; if (!focusables.length) return; const first = focusables[0]; const last = focusables[focusables.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }; document.addEventListener("keydown", onKey, true); return () => document.removeEventListener("keydown", onKey, true); }, [onClose]);
  return <div className="dialog-overlay" ref={overlayRef} onMouseDown={(event) => { if (event.target === overlayRef.current) onClose(); }}><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby={description ? "dialog-description" : undefined}><div className="dialog-heading"><h2 id="dialog-title" ref={headingRef} tabIndex={-1}>{title}</h2><button className="btn btn-secondary" onClick={onClose} aria-label={t("close")}>×</button></div>{description && <p id="dialog-description" className="muted">{description}</p>}{children}</div></div>;
}
