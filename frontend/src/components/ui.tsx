import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../app/AppContext";
import type { RequestStatus, TimesheetStatus } from "../mock/data";

type StatusKey = "stDraft" | "stPendingManager" | "stPendingHr" | "stApproved" | "stRejected" | "stReturned" | "stCancelled" | "stSubmitted";
type StatusMeta = { tone: string; key: StatusKey; icon: "draft" | "pending" | "approved" | "rejected" | "returned" | "cancelled" };

const requestStatusMeta: Record<RequestStatus, StatusMeta> = {
  DRAFT: { tone: "pill-neutral", key: "stDraft", icon: "draft" },
  PENDING_MANAGER: { tone: "pill-info", key: "stPendingManager", icon: "pending" },
  PENDING_HR: { tone: "pill-info", key: "stPendingHr", icon: "pending" },
  APPROVED: { tone: "pill-success", key: "stApproved", icon: "approved" },
  REJECTED: { tone: "pill-error", key: "stRejected", icon: "rejected" },
  RETURNED: { tone: "pill-warning", key: "stReturned", icon: "returned" },
  CANCELLED: { tone: "pill-neutral", key: "stCancelled", icon: "cancelled" },
};
const timesheetStatusMeta: Record<TimesheetStatus, StatusMeta> = {
  DRAFT: requestStatusMeta.DRAFT,
  SUBMITTED: { tone: "pill-info", key: "stSubmitted", icon: "pending" },
  RETURNED: requestStatusMeta.RETURNED,
  APPROVED: requestStatusMeta.APPROVED,
  REJECTED: requestStatusMeta.REJECTED,
};

function StatusIcon({ icon }: { icon: StatusMeta["icon"] }) {
  if (icon === "approved") return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m3 8 3 3 7-7" /></svg>;
  if (icon === "rejected") return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4 4 12" /></svg>;
  if (icon === "returned") return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 3 2 7l4 4M3 7h6a4 4 0 0 1 4 4v2" /></svg>;
  if (icon === "pending") return <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" /><path d="M8 5v3l2 1" /></svg>;
  if (icon === "cancelled") return <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" /><path d="M5 8h6" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4 2h6l2 2v10H4zM6 6h4M6 9h4" /></svg>;
}

function StatusPill({ meta }: { meta: StatusMeta }) {
  const { t } = useApp();
  return <span className={`pill ${meta.tone}`}><StatusIcon icon={meta.icon} />{t(meta.key)}</span>;
}

export function RequestStatusPill({ status }: { status: RequestStatus }) {
  return <StatusPill meta={requestStatusMeta[status]} />;
}

export function TimesheetStatusPill({ status }: { status: TimesheetStatus }) {
  return <StatusPill meta={timesheetStatusMeta[status]} />;
}

export function Banner({ tone, children, role = "status" }: { tone: "info" | "success" | "error" | "warning" | "neutral"; children: ReactNode; role?: "status" | "alert" }) {
  return <div className={`banner banner-${tone}`} role={role}>{children}</div>;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  const { t } = useApp();
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{t("loading")}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row" aria-hidden="true">
          <div className="skeleton" style={{ width: "42%", height: 18 }} />
          <div className="skeleton" style={{ width: "78%", height: 16 }} />
          <div className="skeleton" style={{ width: "26%", height: 16 }} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return <div className="empty-region"><p>{message}</p>{action}</div>;
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useApp();
  return <div className="error-region" role="alert"><p>{t("errorNetwork")}</p><button className="btn btn-secondary" onClick={onRetry}>{t("retry")}</button></div>;
}

export function Dialog({
  title,
  description,
  onClose,
  children,
  dirty = false,
  busy = false,
  restoreFocus = true,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  dirty?: boolean;
  busy?: boolean;
  /** Disable only when the caller restores focus to a stable post-mutation target. */
  restoreFocus?: boolean;
}) {
  const { t, locale } = useApp();
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const applicationRootRef = useRef<HTMLElement | null>(null);

  const requestClose = () => {
    if (busy) return;
    if (dirty && !window.confirm(locale === "ar" ? "سيتم تجاهل النص الذي أدخلته. هل تريد الإغلاق؟" : "Your entered text will be discarded. Close anyway?")) return;
    onClose();
  };

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const applicationRoot = document.querySelector<HTMLElement>(".app-shell");
    applicationRootRef.current = applicationRoot;
    const previousInert = applicationRoot?.inert ?? false;
    headingRef.current?.focus();
    document.body.style.overflow = "hidden";
    if (applicationRoot) applicationRoot.inert = true;
    return () => {
      document.body.style.overflow = previousOverflow;
      if (applicationRootRef.current) applicationRootRef.current.inert = previousInert;
      if (restoreFocus && previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [restoreFocus]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !overlayRef.current) return;
      const focusableItems = [...overlayRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
      if (!focusableItems.length) return;
      const firstItem = focusableItems[0];
      const lastItem = focusableItems[focusableItems.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  });

  return createPortal(
    <div className="dialog-overlay" ref={overlayRef} onMouseDown={(event) => { if (event.target === overlayRef.current) requestClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
        <div className="dialog-heading">
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>{title}</h2>
          <button className="btn btn-secondary" disabled={busy} onClick={requestClose} aria-label={t("close")}>{t("close")}</button>
        </div>
        {description ? <p id={descriptionId} className="muted">{description}</p> : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}
