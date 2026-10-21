import { useEffect, useRef, useState } from "react";
import type { Viewer } from "cesium";
import { CONSTELLATION_ID_PREFIX, ConstellationOverlay } from "../constellationOverlay";
import { epochOf, fetchConstellation, shellCounts, CONSTELLATION_MAX_ELEMENT_AGE_DAYS, type Constellation } from "../constellationData";
import { beginWork } from "../pendingWork";
import type { TimeController } from "../timeline";

export interface ConstellationStatus {
  state: "idle" | "loading" | "ready" | "error";
  total?: number;
  /** Satellites drawn (reliable position at the scene time). */
  shown?: number;
  /** Elements more than 10 days from the scene time. */
  stale?: number;
  fetchedAt?: Date;
  shells?: { inclination: number; count: number }[];
}

// ~11,000 satellites propagate in ~20 ms, so twice a second is cheap and
// keeps close-up motion smooth.
const LIVE_UPDATE_MS = 500;

/**
 * A whole constellation (e.g. ~10,000 Starlink satellites): elements from
 * CelesTrak, SGP4 in a worker, one point per satellite. Live positions update
 * twice a second; away from live they follow the timeline.
 */
export function useConstellation(viewer: Viewer | null, visible: boolean, constellation: Constellation, timeline: TimeController) {
  const [status, setStatus] = useState<ConstellationStatus>({ state: "idle" });
  const overlayRef = useRef<ConstellationOverlay | null>(null);

  useEffect(() => {
    if (!viewer || !visible) { setStatus((s) => (s.state === "idle" ? s : { state: "idle" })); return; }
    let active = true;
    let worker: Worker | null = null;
    let overlay: ConstellationOverlay | null = null;
    let liveTimer: number | null = null;
    let unsubscribe: (() => void) | null = null;
    // One request in flight; a newer time waits until it returns.
    let inFlight = false;
    let queued: number | null = null;
    let requestId = 0;
    let finishWork: (() => void) | null = null;
    setStatus({ state: "loading" });

    const request = (time: number) => {
      if (!worker) return;
      if (!timeline.getState().live) finishWork ??= beginWork();
      if (inFlight) { queued = time; return; }
      inFlight = true;
      worker.postMessage({ type: "positions", id: ++requestId, time });
    };

    void fetchConstellation(constellation).then(({ records, fetchedAt }) => {
      if (!active || viewer.isDestroyed()) return;
      worker = new Worker(new URL("../constellationWorker.ts", import.meta.url), { type: "module" });
      overlay = new ConstellationOverlay(viewer, CONSTELLATION_ID_PREFIX + constellation.id + ":", records.map((r) => r.OBJECT_NAME));
      overlayRef.current = overlay;
      const shells = shellCounts(records);
      worker.onmessage = (event: MessageEvent) => {
        const message = event.data as { type: string; positions?: Float64Array; flags?: Uint8Array; time?: number };
        if (!active) return;
        if (message.type === "ready") {
          request(timeline.getState().live ? Date.now() : timeline.getState().time);
          return;
        }
        if (message.type !== "positions" || !message.positions || !message.flags) return;
        inFlight = false;
        overlay?.setPositions(message.positions, message.flags);
        const shown = message.flags.reduce((n, flag) => n + (flag ? 1 : 0), 0);
        const maxAge = CONSTELLATION_MAX_ELEMENT_AGE_DAYS * 86_400_000;
        const stale = records.reduce((n, r) => n + (Math.abs(message.time! - epochOf(r).getTime()) > maxAge ? 1 : 0), 0);
        setStatus((s) => (s.shown === shown && s.stale === stale && s.state === "ready" ? s : { state: "ready", total: records.length, shown, stale, fetchedAt, shells }));
        if (queued !== null) { const next = queued; queued = null; request(next); }
        else { finishWork?.(); finishWork = null; }
      };
      worker.onerror = (error) => {
        console.warn("Constellation worker failed.", error);
        if (active) setStatus({ state: "error" });
      };
      worker.postMessage({ type: "init", records });
      liveTimer = window.setInterval(() => {
        if (timeline.getState().live && document.visibilityState === "visible") request(Date.now());
      }, LIVE_UPDATE_MS);
      unsubscribe = timeline.subscribe((state) => request(state.live ? Date.now() : state.time));
    }).catch((error: unknown) => {
      console.warn(constellation.title + " elements unavailable; nothing drawn.", error);
      if (active) setStatus({ state: "error" });
    });

    return () => {
      active = false;
      finishWork?.();
      if (liveTimer !== null) window.clearInterval(liveTimer);
      unsubscribe?.();
      worker?.terminate();
      overlay?.dispose();
      overlayRef.current = null;
    };
  }, [viewer, visible, constellation, timeline]);

  const describe = (index: number) => overlayRef.current?.describe(index) ?? null;
  return { status, describe };
}
