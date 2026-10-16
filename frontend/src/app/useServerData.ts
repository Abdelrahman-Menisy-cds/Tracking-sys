import { useCallback, useEffect, useState } from "react";

/**
 * Brief H33 - the ONE server list read hook, replacing the demo-fixture hook.
 *
 * Same render contract the screens already branch on (loading / error+retry /
 * ready), minus the demo fixture control: whatever the server answers IS the
 * state. An empty list is a ready, empty array - the screen renders its honest
 * empty state; nothing is ever substituted for it.
 */
export type ListState<T> =
  | { phase: "loading" }
  | { phase: "error"; retry: () => void }
  | { phase: "ready"; data: T };

export function useServerData<T>(load: () => Promise<T>, deps: unknown[] = []): ListState<T> {
  const [state, setState] = useState<ListState<T>>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((currentAttempt) => currentAttempt + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    void (async () => {
      try {
        const loadedData = await load();
        if (!cancelled) setState({ phase: "ready", data: loadedData });
      } catch {
        if (!cancelled) setState({ phase: "error", retry });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt, retry]);

  return state;
}
