import { useCallback, useEffect, useRef, useState } from "react";
import type { Viewer } from "cesium";
import { FireworksOverlay, type FireworkSite } from "./FireworksOverlay";
import type { FireworkStyle } from "./physics";
import { getExperience } from "./experience";
import { SpaceShow } from "./SpaceShow";

export function useFireworks(viewer: Viewer | null) {
  const overlay = useRef<FireworksOverlay | null>(null);
  const space = useRef<SpaceShow | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!viewer) return;
    const instance = new FireworksOverlay(viewer, setRunning);
    overlay.current = instance;
    const spaceInstance = new SpaceShow(viewer, setRunning);
    space.current = spaceInstance;
    return () => {
      overlay.current = null;
      instance.dispose();
      space.current = null;
      spaceInstance.dispose();
    };
  }, [viewer]);

  const launch = useCallback((site: FireworkSite, style: FireworkStyle) => {
    if (getExperience().mode === "space") {
      overlay.current?.stop(); overlay.current?.clearBackdrop();
      return space.current?.launch() ?? false;
    }
    space.current?.stop();
    return overlay.current?.launch(site, style, getExperience().mode) ?? false;
  }, []);
  const stop = useCallback(() => { overlay.current?.stop(); space.current?.stop(); }, []);
  return { running, launch, stop };
}
