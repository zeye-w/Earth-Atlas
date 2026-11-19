import { useEffect, useRef } from "react";
import type { Viewer } from "cesium";
import { NearEarthOverlay, type NearEarthLayers } from "../nearEarthOverlay";
import type { TimeController, TimeState } from "../timeline";
import { now } from "../clock";
import { useLocale } from "../i18n";

const sceneTime = (state: TimeState) => (state.live ? now() : state.time);

/** Orbit bands, the Van Allen belts and the Earth–Moon Lagrange points (the latter follow the timeline). */
export function useNearEarth(viewer: Viewer | null, layers: NearEarthLayers, timeline: TimeController) {
  const active = layers.orbitBands || layers.radiationBelts || layers.lagrange;
  const locale = useLocale();
  const overlayRef = useRef<NearEarthOverlay | null>(null);

  useEffect(() => {
    if (!viewer || !active) return;
    const overlay = new NearEarthOverlay(viewer);
    overlayRef.current = overlay;
    return () => { overlay.dispose(); overlayRef.current = null; };
  }, [viewer, active]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.set({ orbitBands: layers.orbitBands, radiationBelts: layers.radiationBelts, lagrange: layers.lagrange }, sceneTime(timeline.getState()));
    if (!layers.lagrange) return;
    const off = timeline.subscribe((state) => overlay.setTime(sceneTime(state)));
    const timer = window.setInterval(() => { if (timeline.getState().live && document.visibilityState === "visible") overlay.setTime(now()); }, 60_000);
    return () => { off(); window.clearInterval(timer); };
  }, [layers.orbitBands, layers.radiationBelts, layers.lagrange, timeline, active, viewer, locale]);
}
