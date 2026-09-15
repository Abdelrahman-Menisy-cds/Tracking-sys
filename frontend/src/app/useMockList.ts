import { useCallback, useEffect, useState } from "react";
import { stateDemoControl } from "../mock/data";

export type ListState<T> =
  | { phase: "loading" }
  | { phase: "error"; retry: () => void }
  | { phase: "empty"; forced: boolean }
  | { phase: "ready"; data: T };

export function useMockList<T>(load: () => Promise<T>, deps: unknown[] = []): ListState<T> {
  const [state, setState] = useState<ListState<T>>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    stateDemoControl.fixture = "ready";
    setAttempt((currentAttempt) => currentAttempt + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setState({ phase: "loading" });
      if (stateDemoControl.fixture === "loading") return;
      if (stateDemoControl.fixture === "error") {
        setState({ phase: "error", retry });
        return;
      }
      if (stateDemoControl.fixture === "empty") {
        setState({ phase: "empty", forced: true });
        return;
      }
      try {
        const loadedData = await load();
        if (!cancelled) setState({ phase: "ready", data: loadedData });
      } catch {
        if (!cancelled) setState({ phase: "error", retry });
      }
    };

    const handleFixtureChange = () => setAttempt((currentAttempt) => currentAttempt + 1);
    window.addEventListener("demo-fixture-change", handleFixtureChange);
    void run();
    return () => {
      cancelled = true;
      window.removeEventListener("demo-fixture-change", handleFixtureChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt, retry]);

  return state;
}

export function formatDate(isoDate: string, locale: "ar" | "en"): string {
  return new Date(isoDate).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatDateTime(isoDate: string, locale: "ar" | "en"): string {
  return new Date(isoDate).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Cairo",
    timeZoneName: "short",
  });
}

export function formatMinutes(minutes: number, locale: "ar" | "en"): string {
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return locale === "ar" ? `${hours} ساعة و${remainderMinutes} دقيقة` : `${hours} h ${remainderMinutes} min`;
}
