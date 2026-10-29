import { useCallback, useEffect, useRef, useState } from "react";
import type { Viewer } from "cesium";
import { FireworksOverlay, type FireworkSite } from "./FireworksOverlay";
import type { FireworkStyle } from "./physics";
import { getExperience } from "./experience";
import { SpaceShow } from "./SpaceShow";
import { onShowWarmup, ShowShaderWarmup } from "./shaderWarmup";
import { track } from "../analytics";

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
    // Compile the shows' shaders while the user is still reading the panel.
    const warmup = new ShowShaderWarmup(viewer);
    // Safari has no requestIdleCallback.
    const idleApi = window as { requestIdleCallback?: typeof requestIdleCallback; cancelIdleCallback?: typeof cancelIdleCallback };
    let idle = 0;
    const removeWarmup = onShowWarmup(() => {
      idle = idleApi.requestIdleCallback ? idleApi.requestIdleCallback(() => warmup.run(), { timeout: 500 }) : window.setTimeout(() => warmup.run(), 50);
    });
    return () => {
      removeWarmup();
      if (idleApi.cancelIdleCallback) idleApi.cancelIdleCallback(idle); else window.clearTimeout(idle);
      warmup.dispose();
      overlay.current = null;
      instance.dispose();
      space.current = null;
      spaceInstance.dispose();
    };
  }, [viewer]);

  const launch = useCallback((site: FireworkSite, style: FireworkStyle) => {
    track("show", getExperience().mode);
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
