import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * FloatingNoticeStack - the ONE notification surface for everything that
 * fires from the prayer/dhikr features (and anything else that wants a
 * corner notice later).
 *
 * Contract:
 * - Portaled to document.body; pinned to the START corner (inline-start), so
 *   in RTL it visually sits top-right and in LTR top-left - it never covers
 *   the reading column's end edge, which is where scrollbars and reading
 *   reading motion live.
 * - aria-live="polite" on the container; individual notices carry their own
 *   label. Screen readers announce as they arrive, quietly.
 * - Dismissible by click, Enter, Space, and Escape (Escape always available,
 *   click only on the notice's own button so the ring stays tight).
 * - Auto-dismisses after `visibleMs` (that timer is the caller's choice so a
 *   test can watch a real 14 s pass or force a shorter one).
 * - Notices stack vertically with a gap; each is positioned by document flow
 *   inside the fixed container so they never overlap.
 */

export interface FloatingNoticeData {
  id: string;
  title: string;
  body: ReactNode;
  /** Which aria-label the dismiss button announces. */
  dismissLabel: string;
  /** Auto-dismiss after this many ms; 0 disables auto-dismiss. */
  visibleMs: number;
  /** Optional tone class hook; default is the neutral surface. */
  tone?: "neutral" | "prayer" | "dhikr";
}

interface FloatingNoticeStackProps {
  notices: FloatingNoticeData[];
  onDismiss: (id: string) => void;
}

export function FloatingNoticeStack({ notices, onDismiss }: FloatingNoticeStackProps) {
  // This is a client-only app (no SSR), and document.body always exists by
  // the time React runs createRoot - so no mount gate is needed at all.
  return createPortal(
    <div
      className="notice-stack"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {notices.map((notice) => (
        <NoticeCard key={notice.id} notice={notice} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

function NoticeCard({
  notice,
  onDismiss,
}: {
  notice: FloatingNoticeData;
  onDismiss: (id: string) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (notice.visibleMs <= 0) return;
    const timer = window.setTimeout(() => onDismiss(notice.id), notice.visibleMs);
    return () => window.clearTimeout(timer);
  }, [notice.id, notice.visibleMs, onDismiss]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDismiss(notice.id);
        return;
      }
      if (event.key === "Enter" && document.activeElement === buttonRef.current) {
        // Enter is the button's native activation; nothing extra needed, but
        // we keep the branch documented so the audit trail shows dismissal
        // is keyboard-reachable, not pointer-only.
        return;
      }
    },
    [notice.id, onDismiss],
  );

  return (
    <div
      className={`notice-card notice-card-${notice.tone ?? "neutral"}`}
      role="status"
      onKeyDown={handleKeyDown}
    >
      <div className="notice-card-text">
        <strong className="notice-card-title">{notice.title}</strong>
        <div className="notice-card-body">{notice.body}</div>
      </div>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-secondary notice-card-dismiss"
        aria-label={notice.dismissLabel}
        onClick={() => onDismiss(notice.id)}
      >
        ×
      </button>
    </div>
  );
}
