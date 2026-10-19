import { useEffect, useMemo, useRef } from "react";
import type { Viewer } from "cesium";
import { AuroraOverlay } from "../aurora";
import { OVATION_REFRESH_MS, fetchOvation, northernProfile } from "../auroraData";
import { KP_REFRESH_MS, fetchGeomagnetic } from "../geomagnetic";
import { usePolledData } from "../hooks/usePolledData";

export type AuroraStatus = { state: "idle" | "loading" | "ready" | "quiet" | "error"; forecast?: string; max?: number };

/** NOAA OVATION aurora curtains plus the Kp index; nothing is drawn without data. */
export function useAurora(viewer: Viewer | null, visible: boolean) {
  const overlayRef = useRef<AuroraOverlay | null>(null);
  const ovation = usePolledData(fetchOvation, { enabled: visible, intervalMs: OVATION_REFRESH_MS });
  const geomagnetic = usePolledData(fetchGeomagnetic, { enabled: visible, intervalMs: KP_REFRESH_MS });
  const profile = useMemo(() => (ovation.data ? northernProfile(ovation.data) : null), [ovation.data]);

  useEffect(() => {
    if (!viewer) return;
    const overlay = new AuroraOverlay(viewer);
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
    if (ovation.status === "error") console.warn("NOAA OVATION unavailable; no aurora drawn.", ovation.error);
    if (ovation.status === "ready" || ovation.status === "error") overlayRef.current?.setProfile(ovation.status === "ready" ? profile : null);
  }, [viewer, ovation.status, ovation.error, profile]);

  useEffect(() => {
    if (geomagnetic.status === "error") console.warn("NOAA Kp index unavailable.", geomagnetic.error);
  }, [geomagnetic.status, geomagnetic.error]);

  const status: AuroraStatus = ovation.status === "ready" && ovation.data
    ? { state: profile ? "ready" : "quiet", forecast: ovation.data.forecastTime ? ovation.data.forecastTime.toISOString().slice(11, 16) + " UTC" : undefined, max: Math.round(ovation.data.maxProbability) }
    : { state: ovation.status };
  return { status, geomagnetic };
}
