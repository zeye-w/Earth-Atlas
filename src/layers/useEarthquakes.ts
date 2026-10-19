import { useEffect, useMemo, useRef } from "react";
import type { Viewer } from "cesium";
import { QUAKE_REFRESH_MS, fetchQuakes, type Earthquake, type QuakeRange } from "../earthquakeData";
import { EarthquakeOverlay } from "../earthquakes";
import { usePolledData } from "../hooks/usePolledData";

export type QuakeStatus = { state: "idle" | "loading" | "ready" | "error"; count?: number; largest?: Earthquake };

/** USGS real-time earthquakes, refreshed while visible. */
export function useEarthquakes(viewer: Viewer | null, visible: boolean, range: QuakeRange) {
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
    if (poll.status === "error") console.warn("USGS earthquake feed unavailable; no events drawn.", poll.error);
    if (poll.status === "ready" || poll.status === "error") overlayRef.current?.setQuakes(poll.data ?? []);
  }, [viewer, poll.status, poll.data, poll.error]);

  const quakes = poll.data ?? [];
  const status: QuakeStatus = poll.status === "ready"
    ? { state: "ready", count: quakes.length, largest: quakes[quakes.length - 1] }
    : { state: poll.status };
  return { status, byId };
}
