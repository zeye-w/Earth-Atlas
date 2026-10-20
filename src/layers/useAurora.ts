import { useEffect, useMemo, useRef } from "react";
import type { Viewer } from "cesium";
import { AuroraOverlay } from "../aurora";
import { OVATION_REFRESH_MS, fetchOvation, hemisphereMax, ovalProfile, type AuroraProfile } from "../auroraData";
import { KP_REFRESH_MS, fetchGeomagnetic } from "../geomagnetic";
import { usePolledData } from "../hooks/usePolledData";

export type AuroraStatus = { state: "idle" | "loading" | "ready" | "quiet" | "error"; forecast?: string; max?: number; north?: number; south?: number };

/** NOAA OVATION aurora curtains around both poles plus the Kp index; nothing is drawn without data. */
export function useAurora(viewer: Viewer | null, visible: boolean) {
  const overlayRef = useRef<AuroraOverlay | null>(null);
  const ovation = usePolledData(fetchOvation, { enabled: visible, intervalMs: OVATION_REFRESH_MS });
  const geomagnetic = usePolledData(fetchGeomagnetic, { enabled: visible, intervalMs: KP_REFRESH_MS });
  const profiles = useMemo(() => (ovation.data ? [ovalProfile(ovation.data, "north"), ovalProfile(ovation.data, "south")].filter((p): p is AuroraProfile => p !== null) : []), [ovation.data]);

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
    if (ovation.status === "ready" || ovation.status === "error") overlayRef.current?.setProfiles(ovation.status === "ready" ? profiles : []);
  }, [viewer, ovation.status, ovation.error, profiles]);

  useEffect(() => {
    if (geomagnetic.status === "error") console.warn("NOAA Kp index unavailable.", geomagnetic.error);
  }, [geomagnetic.status, geomagnetic.error]);

  const status: AuroraStatus = ovation.status === "ready" && ovation.data
    ? {
      state: profiles.length > 0 ? "ready" : "quiet",
      forecast: ovation.data.forecastTime ? ovation.data.forecastTime.toISOString().slice(11, 16) + " UTC" : undefined,
      max: Math.round(ovation.data.maxProbability),
      north: Math.round(hemisphereMax(ovation.data, "north")),
      south: Math.round(hemisphereMax(ovation.data, "south")),
    }
    : { state: ovation.status };
  return { status, geomagnetic };
}
