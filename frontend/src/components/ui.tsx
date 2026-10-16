import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../app/AppContext";
import type { RequestStatusType as RequestStatus, TimesheetStatusType as TimesheetStatus } from "../app/serverTypes";
import { AlertTriangleIcon, BellIcon, CheckIcon, ClockIcon, CloseIcon, DocumentIcon, InfoIcon, RtlArrowBackIcon } from "./icons";

type StatusKey = "stDraft" | "stPendingManager" | "stPendingHr" | "stApproved" | "stRejected" | "stReturned" | "stCancelled" | "stSubmitted" | "unread" | "read";
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "unread";
type StatusMeta = { tone: StatusTone; key: StatusKey; icon: "draft" | "pending" | "approved" | "rejected" | "returned" | "cancelled" | "unread" };

const requestStatusMeta: Record<RequestStatus, StatusMeta> = {
  DRAFT: { tone: "neutral", key: "stDraft", icon: "draft" },
  PENDING_MANAGER: { tone: "info", key: "stPendingManager", icon: "pending" },
  PENDING_HR: { tone: "info", key: "stPendingHr", icon: "pending" },
  APPROVED: { tone: "success", key: "stApproved", icon: "approved" },
  REJECTED: { tone: "danger", key: "stRejected", icon: "rejected" },
  RETURNED: { tone: "warning", key: "stReturned", icon: "returned" },
  CANCELLED: { tone: "neutral", key: "stCancelled", icon: "cancelled" },
};
const timesheetStatusMeta: Record<TimesheetStatus, StatusMeta> = {
  DRAFT: requestStatusMeta.DRAFT,
  SUBMITTED: { tone: "info", key: "stSubmitted", icon: "pending" },
  RETURNED: requestStatusMeta.RETURNED,
  APPROVED: requestStatusMeta.APPROVED,
  REJECTED: requestStatusMeta.REJECTED,
};

function StatusIcon({ icon }: { icon: StatusMeta["icon"] }) {
  if (icon === "approved") return <CheckIcon size={16} />;
  if (icon === "rejected") return <CloseIcon size={16} />;
  if (icon === "returned") return <RtlArrowBackIcon locale="ar" size={16} />;
  if (icon === "pending") return <ClockIcon size={16} />;
  if (icon === "unread") return <BellIcon size={16} />;
  if (icon === "cancelled") return <CloseIcon size={16} />;
  return <DocumentIcon size={16} />;
}

export function StatusPill({ tone, label, icon = "draft" }: { tone: StatusTone; label: string; icon?: StatusMeta["icon"] }) {
  return <span className={`pill pill-${tone}`}><StatusIcon icon={icon} />{label}</span>;
}

function StatusPillFromMeta({ meta }: { meta: StatusMeta }) {
  const { t } = useApp();
  return <StatusPill tone={meta.tone} label={t(meta.key)} icon={meta.icon} />;
}

export function RequestStatusPill({ status }: { status: RequestStatus }) {
  return <StatusPillFromMeta meta={requestStatusMeta[status]} />;
}

export function TimesheetStatusPill({ status }: { status: TimesheetStatus }) {
  return <StatusPillFromMeta meta={timesheetStatusMeta[status]} />;
}

export function Banner({ tone, children, role = "status" }: { tone: "info" | "success" | "error" | "warning" | "neutral"; children: ReactNode; role?: "status" | "alert" }) {
  const icon = tone === "success" ? <CheckIcon /> : tone === "warning" || tone === "error" ? <AlertTriangleIcon /> : <InfoIcon />;
  return <div className={`banner banner-${tone}`} role={role}>{icon}<div>{children}</div></div>;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  const { t } = useApp();
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{t("loading")}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row" aria-hidden="true">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-body" />
          <div className="skeleton skeleton-meta" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return <div className="empty-region"><InfoIcon className="state-icon" /><p>{message}</p><div className="state-actions">{action}</div></div>;
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useApp();
  return <div className="error-region" role="alert"><AlertTriangleIcon className="state-icon" /><p>{t("errorNetwork")}</p><button className="btn btn-secondary" onClick={onRetry}>{t("retry")}</button></div>;
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
