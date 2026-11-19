import { useEffect, useState } from "react";
import type { Viewer } from "cesium";
import { farViewFor, isFarView, onFarView, setFarView } from "../farView";

/** Follows the camera height after each rendered frame and switches the far view (src/farView.ts). */
export function useFarView(viewer: Viewer | null): boolean {
  const [far, setFar] = useState(isFarView);
  useEffect(() => onFarView(setFar), []);
  useEffect(() => {
    if (!viewer) return;
    const check = () => {
      if (viewer.isDestroyed()) return;
      setFarView(farViewFor(viewer.camera.positionCartographic.height, isFarView()));
    };
    check();
    const off = viewer.scene.postRender.addEventListener(check);
    return () => { off(); setFarView(false); };
  }, [viewer]);
  return far;
}
