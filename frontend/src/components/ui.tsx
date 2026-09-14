/** Shared UI atoms: status pills, banners, skeletons, dialog, empty/error states. */
import { useEffect, useRef, type ReactNode } from "react";
import { useApp } from "../app/AppContext";
import type { RequestStatus, TimesheetStatus } from "../mock/data";

/* ---------- status pill (text + icon, never color-only) ---------- */

const requestStatusMeta: Record<RequestStatus, { tone: string; icon: string; key: "stDraft" | "stPendingManager" | "stPendingHr" | "stApproved" | "stRejected" | "stReturned" | "stCancelled" }> = {
  DRAFT: { tone: "pill-neutral", icon: "✎", key: "stDraft" },
  PENDING_MANAGER: { tone: "pill-info", icon: "⏳", key: "stPendingManager" },
  PENDING_HR: { tone: "pill-info", icon: "⏳", key: "stPendingHr" },
  APPROVED: { tone: "pill-success", icon: "✓", key: "stApproved" },
  REJECTED: { tone: "pill-error", icon: "✕", key: "stRejected" },
  RETURNED: { tone: "pill-warning", icon: "↩", key: "stReturned" },
  CANCELLED: { tone: "pill-neutral", icon: "⊘", key: "stCancelled" },
};

const timesheetStatusMeta: Record<TimesheetStatus, { tone: string; icon: string; key: "stDraft" | "stSubmitted" | "stReturned" | "stApproved" | "stRejected" }> = {
  DRAFT: { tone: "pill-neutral", icon: "✎", key: "stDraft" },
  SUBMITTED: { tone: "pill-info", icon: "⏳", key: "stSubmitted" },
  RETURNED: { tone: "pill-warning", icon: "↩", key: "stReturned" },
  APPROVED: { tone: "pill-success", icon: "✓", key: "stApproved" },
  REJECTED: { tone: "pill-error", icon: "✕", key: "stRejected" },
};

export function RequestStatusPill({ status }: { status: RequestStatus }) {
  const { t } = useApp();
  const meta = requestStatusMeta[status];
  return (
    <span className={`pill ${meta.tone}`}>
      <span aria-hidden="true">{meta.icon}</span>
      {t(meta.key)}
    </span>
  );
}

export function TimesheetStatusPill({ status }: { status: TimesheetStatus }) {
  const { t } = useApp();
  const meta = timesheetStatusMeta[status];
  return (
    <span className={`pill ${meta.tone}`}>
      <span aria-hidden="true">{meta.icon}</span>
      {t(meta.key)}
    </span>
  );
}

/* ---------- banners ---------- */

export function Banner({
  tone,
  children,
  role = "status",
}: {
  tone: "info" | "success" | "error" | "warning" | "neutral";
  children: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div className={`banner banner-${tone}`} role={role}>
      <div>{children}</div>
    </div>
  );
}

/* ---------- skeleton ---------- */

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card" style={{ display: "grid", gap: 8 }}>
          <div className="skeleton" style={{ width: "45%", height: 18 }} />
          <div className="skeleton" style={{ width: "80%", height: 14 }} />
          <div className="skeleton" style={{ width: "30%", height: 14 }} />
        </div>
      ))}
    </div>
  );
}

/* ---------- empty / error ---------- */

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "var(--sp-12) var(--sp-4)" }}>
      <p style={{ fontSize: 40, margin: 0 }} aria-hidden="true">
        🗂️
      </p>
      <p>{message}</p>
      {action}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useApp();
  return (
    <Banner tone="error" role="alert">
      <div>
        <p style={{ margin: 0 }}>{t("errorNetwork")}</p>
        <button className="btn btn-secondary" onClick={onRetry} style={{ marginTop: 8 }}>
          {t("retry")}
        </button>
      </div>
    </Banner>
  );
}

/* ---------- accessible dialog with focus trap ---------- */

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useApp();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.classList.add("dialog-open");
    return () => {
      previouslyFocused?.focus();
      document.body.classList.remove("dialog-open");
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && overlayRef.current) {
        // simple focus trap
        const focusables = overlayRef.current.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="dialog-overlay"
      ref={overlayRef}
      onMouseDown={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
          <h2 ref={headingRef} tabIndex={-1} style={{ margin: 0 }}>
            {title}
          </h2>
          <button className="btn btn-secondary" onClick={onClose} aria-label={t("close")}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
