import { useEffect, useMemo, useRef } from "react";
import { Cartesian3, type Viewer } from "cesium";
import { SOLAR_WIND_REFRESH_MS, dynamicPressure, fetchSolarWind, sampleAt, shueMagnetopause, type Magnetopause, type SolarWindSample } from "../solarWindData";
import { SolarWindOverlay } from "../solarWindOverlay";
import { usePolledData } from "../hooks/usePolledData";
import { useTimeSelector } from "../hooks/useTimeline";
import { subsolarPoint } from "../solar";
import type { TimeController } from "../timeline";
import { now } from "../clock";

export interface SolarWindState {
  status: "idle" | "loading" | "ready" | "error" | "nodata";
  sample: SolarWindSample | null;
  pressure: number | null;
  magnetopause: Magnetopause | null;
}

const MINUTE = 60_000;

/** Sun direction (unit vector, Earth-fixed) at a moment. */
function sunDirection(time: number): Cartesian3 {
  const sun = subsolarPoint(new Date(time));
  return Cartesian3.fromRadians(sun.longitude * Math.PI / 180, sun.latitude * Math.PI / 180, 0, undefined, new Cartesian3());
}

/**
 * Measured solar wind (7 days, so it follows the timeline) driving the
 * magnetopause model and the particle animation. Nothing is drawn without a
 * measurement for the moment.
 */
export function useSolarWind(viewer: Viewer | null, visible: boolean, timeline: TimeController): SolarWindState {
  const overlayRef = useRef<SolarWindOverlay | null>(null);
  const poll = usePolledData(fetchSolarWind, { enabled: visible, intervalMs: SOLAR_WIND_REFRESH_MS, keepDataOnError: true });
  const live = useTimeSelector(timeline, (s) => s.live);
  const minute = useTimeSelector(timeline, (s) => Math.floor(s.time / MINUTE));

  const sample = useMemo(() => {
    const samples = poll.data;
    if (!samples || samples.length === 0) return null;
    // Live shows the latest measurement (normally a few minutes old).
    return live ? samples[samples.length - 1] : sampleAt(samples, minute * MINUTE);
  }, [poll.data, live, minute]);
  const pressure = sample ? dynamicPressure(sample.density, sample.speed) : null;
  const magnetopause = useMemo(() => (sample && pressure !== null ? shueMagnetopause(pressure, sample.bz ?? 0) : null), [sample, pressure]);

  useEffect(() => {
    if (!viewer || !visible) return;
    const overlay = new SolarWindOverlay(viewer);
    overlayRef.current = overlay;
    // Earth turns under the Sun: re-aim on every timeline change and each minute live.
    const aim = () => overlay.setSunDirection(sunDirection(timeline.getState().live ? now() : timeline.getState().time));
    aim();
    const unsubscribe = timeline.subscribe(aim);
    const timer = window.setInterval(aim, MINUTE);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      overlay.dispose();
      overlayRef.current = null;
    };
  }, [viewer, visible, timeline]);

  useEffect(() => {
    overlayRef.current?.setSolarWind(sample && magnetopause ? { shape: magnetopause, speed: sample.speed, density: sample.density, bz: sample.bz } : null);
  }, [sample, magnetopause, visible, viewer]);

  const status: SolarWindState["status"] = !visible ? "idle" : poll.status === "ready" && !sample ? "nodata" : poll.status === "idle" ? "loading" : poll.status;
  return { status, sample, pressure, magnetopause };
}
