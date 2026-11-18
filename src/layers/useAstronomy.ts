import { useEffect, useRef, useState } from "react";
import type { Viewer } from "cesium";
import type { TimeController, TimeState } from "../timeline";
import { now } from "../clock";

export type AstronomyModule = typeof import("../astronomy/index");
type Overlay = InstanceType<AstronomyModule["AstronomyOverlay"]>;
type Shower = AstronomyModule["METEOR_SHOWERS"][number];
type EclipseView = import("../astronomy/index").EclipseView;

let loading: Promise<AstronomyModule> | null = null;
/** The astronomy code (astronomy-engine included) is fetched the first time it is needed. */
export function loadAstronomy(): Promise<AstronomyModule> {
  loading ??= import("../astronomy/index").catch((error) => { loading = null; throw error; });
  return loading;
}

/** The module once loaded (starting the load when `wanted`), else null. */
export function useAstronomyModule(wanted: boolean): { module: AstronomyModule | null; failed: boolean } {
  const [module, setModule] = useState<AstronomyModule | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!wanted || module) return;
    let active = true;
    loadAstronomy().then((m) => { if (active) setModule(() => m); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [wanted, module]);
  return { module, failed };
}

const sceneTime = (state: TimeState) => (state.live ? now() : state.time);

/**
 * The astronomy layers on the globe. The Moon and meteor map follow the
 * timeline; an eclipse being viewed runs on its own clock (`eclipse.time`),
 * since eclipses are months or years away from the timeline's range.
 */
export function useAstronomy(viewer: Viewer | null, module: AstronomyModule | null, layers: { moon: boolean; meteors: boolean },
  shower: Shower | null, eclipse: EclipseView | null, timeline: TimeController) {
  const overlayRef = useRef<Overlay | null>(null);
  const active = Boolean(module) && (layers.moon || layers.meteors || eclipse !== null);

  useEffect(() => {
    if (!viewer || !module || !active) return;
    const overlay = new module.AstronomyOverlay(viewer);
    overlayRef.current = overlay;
    return () => { overlay.dispose(); overlayRef.current = null; };
  }, [viewer, module, active]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const apply = (state: TimeState) => {
      const time = sceneTime(state);
      overlay.setMoon(layers.moon, time);
      overlay.setMeteors(layers.meteors ? shower : null, time);
    };
    apply(timeline.getState());
    const off = timeline.subscribe(apply);
    // Live, the Moon moves a quarter of a degree a minute over the ground.
    const timer = window.setInterval(() => { if (timeline.getState().live && document.visibilityState === "visible") apply(timeline.getState()); }, 60_000);
    return () => { off(); window.clearInterval(timer); };
  }, [layers.moon, layers.meteors, shower, timeline, active, viewer, module]);

  useEffect(() => { overlayRef.current?.setEclipse(eclipse); }, [eclipse, active, viewer, module]);
}
