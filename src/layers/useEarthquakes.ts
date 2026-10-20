import { useEffect, useMemo, useRef } from "react";
import type { Viewer } from "cesium";
import { QUAKE_REFRESH_MS, fetchQuakes, type Earthquake, type QuakeRange } from "../earthquakeData";
import { EarthquakeOverlay } from "../earthquakes";
import { usePolledData } from "../hooks/usePolledData";
import type { TimeController, TimeState } from "../timeline";

export type QuakeStatus = { state: "idle" | "loading" | "ready" | "error"; count?: number; largest?: Earthquake };

// Live shows everything fetched so far; otherwise what had happened by the timeline moment.
const sceneTime = (state: TimeState) => (state.live ? Date.now() : state.time);

/** USGS real-time earthquakes, refreshed while visible, replayable along the timeline. */
export function useEarthquakes(viewer: Viewer | null, visible: boolean, range: QuakeRange, timeline: TimeController) {
  const overlayRef = useRef<EarthquakeOverlay | null>(null);
  const poll = usePolledData((signal) => fetchQuakes(range, signal), { enabled: visible, intervalMs: QUAKE_REFRESH_MS, key: range });
  const byId = useMemo(() => new Map((poll.data ?? []).map((quake) => [quake.id, quake])), [poll.data]);

  useEffect(() => {
    if (!viewer) return;
    const overlay = new EarthquakeOverlay(viewer);
    overlayRef.current = overlay;
    return () => {
      overlay.dispose();
      overlayRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    overlayRef.current?.setVisible(visible);
  }, [viewer, visible]);

  useEffect(() => {
    if (!viewer) return;
    return timeline.subscribe((state) => overlayRef.current?.setTime(sceneTime(state)));
  }, [viewer, timeline]);

  useEffect(() => {
    if (poll.status === "error") console.warn("USGS earthquake feed unavailable; no events drawn.", poll.error);
    if (poll.status === "ready" || poll.status === "error") {
      overlayRef.current?.setQuakes(poll.data ?? []);
      overlayRef.current?.setTime(sceneTime(timeline.getState()));
    }
  }, [viewer, poll.status, poll.data, poll.error, timeline]);

  const quakes = poll.data ?? [];
  const status: QuakeStatus = poll.status === "ready"
    ? { state: "ready", count: quakes.length, largest: quakes[quakes.length - 1] }
    : { state: poll.status };
  return { status, byId, list: quakes };
}
