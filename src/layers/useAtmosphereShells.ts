import { useEffect, useRef } from "react";
import type { Viewer } from "cesium";
import type { AtmosphereShellOverlay } from "../atmosphereShells";

/** Layered atmosphere shells at true (or labelled, exaggerated) heights; lazy chunk. */
export function useAtmosphereShells(viewer: Viewer | null, visible: boolean, scale: number) {
  const overlayRef = useRef<AtmosphereShellOverlay | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    if (!viewer) return;
    if (overlayRef.current) {
      overlayRef.current.setVisible(visible);
      return;
    }
    if (!visible) return;
    let active = true;
    void import("../atmosphereShells").then((module) => {
      if (!active || viewer.isDestroyed() || overlayRef.current) return;
      overlayRef.current = new module.AtmosphereShellOverlay(viewer, scaleRef.current);
    }).catch((error: unknown) => console.warn("Atmosphere shells failed to load.", error));
    return () => { active = false; };
  }, [viewer, visible]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.setScale(scale);
    if (!visible) overlay.setVisible(false);
    // Visibility changes are handled above; only rebuild on scale change.
  }, [scale]);

  useEffect(() => () => {
    overlayRef.current?.dispose();
    overlayRef.current = null;
  }, [viewer]);
}
