import { useCallback, useEffect, useRef, useState } from "react";
import type { Viewer } from "cesium";
import { FireworksOverlay, type FireworkSite } from "./FireworksOverlay";
import type { FireworkStyle } from "./physics";
import { getExperience } from "./experience";

export function useFireworks(viewer: Viewer | null) {
  const overlay = useRef<FireworksOverlay | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!viewer) return;
    const instance = new FireworksOverlay(viewer, setRunning);
    overlay.current = instance;
    return () => {
      overlay.current = null;
      instance.dispose();
    };
  }, [viewer]);

  const launch = useCallback((site: FireworkSite, style: FireworkStyle) => overlay.current?.launch(site, style, getExperience().mode) ?? false, []);
  const stop = useCallback(() => overlay.current?.stop(), []);
  return { running, launch, stop };
}
