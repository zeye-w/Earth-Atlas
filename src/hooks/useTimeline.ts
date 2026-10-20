import { useEffect, useState, useSyncExternalStore } from "react";
import { JulianDate, type Viewer } from "cesium";
import { TimeController, type TimeSpan, type TimeState } from "../timeline";

/** One TimeController for the app, started for the component's lifetime. */
export function useTimeline(initial: { time?: number; span?: TimeSpan }) {
  const [controller] = useState(() => new TimeController(initial));
  useEffect(() => controller.start(), [controller]);
  return controller;
}

/**
 * Subscribes to one derived value. Return primitives so components only
 * re-render when that value changes, not on every replay tick.
 */
export function useTimeSelector<T>(controller: TimeController, select: (state: TimeState) => T): T {
  return useSyncExternalStore(controller.subscribe, () => select(controller.getState()));
}

/** Cesium's clock (and so the SunLight) follows the timeline. */
export function useSceneClock(viewer: Viewer | null, controller: TimeController) {
  useEffect(() => {
    if (!viewer) return;
    const apply = (state: TimeState) => {
      if (viewer.isDestroyed()) return;
      viewer.clock.currentTime = JulianDate.fromDate(new Date(state.time));
      viewer.scene.requestRender();
    };
    apply(controller.getState());
    return controller.subscribe(apply);
  }, [viewer, controller]);
}
