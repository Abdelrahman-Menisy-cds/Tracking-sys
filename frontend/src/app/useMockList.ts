/**
 * useMockList: shared async-list hook exercising loading / empty / error states
 * against the mock data layer with simulated latency and reviewer-controlled
 * forced states (failNext / loadingNext / emptyNext).
 */
import { useEffect, useState } from "react";
import { stateDemoControl } from "../mock/data";

export type ListState<T> =
  | { phase: "loading" }
  | { phase: "error"; retry: () => void }
  | { phase: "empty"; forced: boolean }
  | { phase: "ready"; data: T };

export function useMockList<T>(load: () => Promise<T>, deps: unknown[] = []): ListState<T> {
  const [state, setState] = useState<ListState<T>>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (stateDemoControl.loadingNext) {
      // stay in loading until reviewer toggles off via next retry
    }
    const run = async () => {
      setState({ phase: "loading" });
      try {
        const data = await load();
        if (!cancelled) {
          if (stateDemoControl.emptyNext) {
            stateDemoControl.emptyNext = false;
            setState({ phase: "empty", forced: true });
          } else {
            setState({ phase: "ready", data });
          }
        }
      } catch {
        if (!cancelled) {
          setState({ phase: "error", retry: () => setAttempt((n) => n + 1) });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return state;
}

/** Formats an ISO date for the active locale. */
export function formatDate(isoDate: string, locale: "ar" | "en"): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatDateTime(isoDate: string, locale: "ar" | "en"): string {
  const d = new Date(isoDate);
  return d.toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Hours + minutes from canonical minutes (never decimal hours). */
export function formatMinutes(mins: number, locale: "ar" | "en"): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return locale === "ar" ? `${h} ساعة و${m} دقيقة` : `${h} h ${m} min`;
}
