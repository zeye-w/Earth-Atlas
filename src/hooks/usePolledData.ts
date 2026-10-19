import { useEffect, useRef, useState } from "react";

export type PollStatus = "idle" | "loading" | "ready" | "error";

export interface Polled<T> {
  status: PollStatus;
  data: T | null;
  error: unknown;
}

export interface PollOptions {
  /** Fetch only while true; turning it off resets to idle and aborts. */
  enabled: boolean;
  intervalMs: number;
  /** Changing this restarts polling (e.g. a selected time range). */
  key?: unknown;
  /** Also refresh when the tab becomes visible again. */
  refreshOnVisible?: boolean;
  /** Keep the last good data when a refresh fails. */
  keepDataOnError?: boolean;
}

const IDLE: Polled<never> = { status: "idle", data: null, error: null };

/**
 * Shared lifecycle for live data feeds: fetch on enable, refresh on an
 * interval while the tab is visible, abort on disable/unmount, never run two
 * requests at once, and keep showing ready data while a refresh is in flight.
 */
export function usePolledData<T>(fetcher: (signal: AbortSignal) => Promise<T>, options: PollOptions): Polled<T> {
  const { enabled, intervalMs, key, refreshOnVisible = false, keepDataOnError = false } = options;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [state, setState] = useState<Polled<T>>(IDLE);

  useEffect(() => {
    if (!enabled) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      setState((current) => (current.status === "ready" ? current : { status: "loading", data: current.data, error: null }));
      try {
        const data = await fetcherRef.current(controller.signal);
        if (!controller.signal.aborted) setState({ status: "ready", data, error: null });
      } catch (error) {
        if (!controller.signal.aborted) setState((current) => ({ status: "error", data: keepDataOnError ? current.data : null, error }));
      } finally {
        inFlight = false;
      }
    };
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(refresh, intervalMs);
    if (refreshOnVisible) document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      if (refreshOnVisible) document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, intervalMs, key, refreshOnVisible, keepDataOnError]);

  return state;
}
