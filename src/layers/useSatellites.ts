import { useEffect, useRef, useState } from "react";
import type { Viewer } from "cesium";
// satellite.js and the overlay are imported on demand when the layer is enabled.
import type { OrbitRecord, SatelliteChoice } from "../satelliteOrbits";
import type { SatelliteOverlay, SatelliteSpeed } from "../satelliteOverlay";
import type { TimeController } from "../timeline";

export type SatelliteStatus = "idle" | "loading" | "ready" | "error";

// Away from "live" the satellites sit where SGP4 puts them at the timeline
// moment (moving only while it replays); live uses the overlay's own clock
// with the 1×/60×/300× preview speeds.
function followTimeline(overlay: SatelliteOverlay, timeline: TimeController) {
  const { live } = timeline.getState();
  if (live) { if (overlay.followsTimeline) overlay.setClock(null); }
  else if (overlay.followsTimeline) overlay.update();
  else overlay.setClock(() => new Date(timeline.getState().time));
}

/** Curated satellites from public GP elements (two-hour cache); no network when off. */
export function useSatellites(viewer: Viewer | null, options: { visible: boolean; paths: boolean; speed: SatelliteSpeed; selectedId: string | null; timeline: TimeController }) {
  const { visible, paths, speed, selectedId, timeline } = options;
  const overlayRef = useRef<SatelliteOverlay | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const [status, setStatus] = useState<SatelliteStatus>("idle");
  const [catalog, setCatalog] = useState<Array<{ choice: SatelliteChoice; epochLabel: string }>>([]);
  const [records, setRecords] = useState<OrbitRecord[]>([]);

  useEffect(() => {
    if (!viewer) return;
    if (!visible) {
      setStatus("idle");
      return;
    }
    let active = true;
    setStatus("loading");
    void Promise.all([import("../satelliteOrbits"), import("../satelliteOverlay")]).then(async ([orbits, overlayModule]) => {
      const { satellites } = await orbits.fetchSatelliteCatalog();
      if (!active || viewer.isDestroyed()) return;
      overlayRef.current?.dispose();
      const overlay = new overlayModule.SatelliteOverlay(viewer, satellites, latest.current.paths);
      overlayRef.current = overlay;
      overlay.setSelected(latest.current.selectedId);
      overlay.setSpeed(latest.current.speed);
      followTimeline(overlay, timeline);
      setCatalog(satellites.map(({ choice, epoch }) => ({ choice, epochLabel: orbits.formatEpoch(epoch) })));
      setRecords(satellites);
      setStatus(overlay.count > 0 ? "ready" : "error");
    }).catch((error: unknown) => {
      if (!active) return;
      console.warn("Satellite elements unavailable; no fabricated orbit rendered.", error);
      setStatus("error");
      setCatalog([]);
      setRecords([]);
    });
    return () => {
      active = false;
      overlayRef.current?.dispose();
      overlayRef.current = null;
    };
  }, [viewer, visible]);

  useEffect(() => { overlayRef.current?.setSpeed(speed); }, [speed]);
  useEffect(() => timeline.subscribe(() => { if (overlayRef.current) followTimeline(overlayRef.current, timeline); }), [timeline]);
  useEffect(() => { overlayRef.current?.setSelected(selectedId); }, [selectedId]);
  useEffect(() => { overlayRef.current?.togglePaths(paths); }, [paths]);

  // Resynchronize positions when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") overlayRef.current?.update(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return { status, catalog, records };
}
