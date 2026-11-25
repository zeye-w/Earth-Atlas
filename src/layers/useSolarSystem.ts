import { useEffect, useRef } from "react";
import type { Viewer } from "cesium";
import type { AstronomyModule } from "./useAstronomy";
import { usePolledData } from "../hooks/usePolledData";
import { fetchSpace, SPACE_REFRESH_MS } from "../spaceData";
import type { TimeController, TimeState } from "../timeline";
import { now } from "../clock";

type Overlay = InstanceType<AstronomyModule["SolarSystemOverlay"]>;
export type SolarBody = Parameters<AstronomyModule["helio"]>[0];
const sceneTime = (state: TimeState) => (state.live ? now() : state.time);

/**
 * The solar system around the globe. It follows the timeline, or its own
 * fast-forward clock (`lapseTime`) while that runs.
 */
export function useSolarSystem(viewer: Viewer | null, module: AstronomyModule | null, enabled: boolean, lapseTime: number | null, selected: SolarBody | null, timeline: TimeController) {
  const overlayRef = useRef<Overlay | null>(null);
  const active = Boolean(viewer && module && enabled);
  const space = usePolledData(fetchSpace, { enabled, intervalMs: SPACE_REFRESH_MS, refreshOnVisible: true, keepDataOnError: true });
  const lapseRef = useRef(lapseTime);
  lapseRef.current = lapseTime;

  useEffect(() => {
    if (!viewer || !module || !enabled) return;
    const overlay = new module.SolarSystemOverlay(viewer);
    overlayRef.current = overlay;
    const apply = () => overlay.setTime(lapseRef.current ?? sceneTime(timeline.getState()));
    apply();
    const off = timeline.subscribe(() => { if (lapseRef.current === null) apply(); });
    const timer = window.setInterval(() => { if (lapseRef.current === null && timeline.getState().live && document.visibilityState === "visible") apply(); }, 60_000);
    return () => { off(); window.clearInterval(timer); overlay.dispose(); overlayRef.current = null; };
  }, [viewer, module, enabled, timeline]);

  useEffect(() => { overlayRef.current?.setProbes(space.data); overlayRef.current?.setTime(lapseRef.current ?? sceneTime(timeline.getState())); }, [space.data, active, timeline]);
  useEffect(() => { if (lapseTime !== null) overlayRef.current?.setTime(lapseTime); else overlayRef.current?.setTime(sceneTime(timeline.getState())); }, [lapseTime, active, timeline]);
  useEffect(() => { overlayRef.current?.setSelected(selected); }, [selected, active]);
  /** Turn the camera around the Sun or a planet (after a flight out to it). */
  return { setPivot: (key: "sun" | SolarBody | string | null) => overlayRef.current?.setPivot(key) };
}
