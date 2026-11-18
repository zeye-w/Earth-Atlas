import { useEffect, useRef } from "react";
import type { Viewer } from "cesium";
import { fetchSpace, SPACE_REFRESH_MS, type SpaceSnapshot } from "../spaceData";
import { SpaceOverlay } from "../spaceOverlay";
import { usePolledData, type PollStatus } from "../hooks/usePolledData";
import type { TimeController, TimeState } from "../timeline";
import { now } from "../clock";
import { useLocale } from "../i18n";

export interface SpaceState { status: PollStatus; snapshot: SpaceSnapshot | null }

const sceneTime = (state: TimeState) => (state.live ? now() : state.time);

/** Near-Earth asteroids and deep space probes (/api/space), on the globe and for the panel. */
export function useSpace(viewer: Viewer | null, layers: { asteroids: boolean; probes: boolean }, selected: string | null, timeline: TimeController): SpaceState {
  const active = layers.asteroids || layers.probes;
  const locale = useLocale();
  const poll = usePolledData(fetchSpace, { enabled: active, intervalMs: SPACE_REFRESH_MS, refreshOnVisible: true, keepDataOnError: true });
  const overlayRef = useRef<SpaceOverlay | null>(null);

  useEffect(() => {
    if (!viewer || !active) return;
    const overlay = new SpaceOverlay(viewer);
    overlayRef.current = overlay;
    return () => { overlay.dispose(); overlayRef.current = null; };
  }, [viewer, active]);

  // Redraw on new data or choices; follow the timeline (live: every minute).
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.set(poll.data, layers, sceneTime(timeline.getState()), selected, locale);
    const off = timeline.subscribe((state) => overlay.setTime(sceneTime(state)));
    const timer = window.setInterval(() => { if (timeline.getState().live && document.visibilityState === "visible") overlay.setTime(now()); }, 60_000);
    return () => { off(); window.clearInterval(timer); };
  }, [poll.data, layers.asteroids, layers.probes, selected, timeline, active, viewer, locale]);

  return { status: poll.status, snapshot: poll.data };
}
