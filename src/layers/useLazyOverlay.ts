import { useEffect, useRef, useState } from "react";
import type { Viewer } from "cesium";

export interface ToggleableOverlay {
  setVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * For overlays built from a bundled dataset: load the chunk and build the
 * overlay the first time the layer is shown, then only toggle visibility.
 */
export function useLazyOverlay<O extends ToggleableOverlay, R>(
  viewer: Viewer | null,
  visible: boolean,
  build: (viewer: Viewer) => Promise<{ overlay: O; result: R }>,
  label: string,
) {
  const overlayRef = useRef<O | null>(null);
  const buildRef = useRef(build);
  buildRef.current = build;
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; result?: R }>({ status: "idle" });

  useEffect(() => {
    if (!viewer) return;
    if (overlayRef.current) {
      overlayRef.current.setVisible(visible);
      return;
    }
    if (!visible) return;
    let active = true;
    setState({ status: "loading" });
    buildRef.current(viewer).then(({ overlay, result }) => {
      if (!active || viewer.isDestroyed() || overlayRef.current) {
        overlay.dispose();
        return;
      }
      overlayRef.current = overlay;
      setState({ status: "ready", result });
    }).catch((error: unknown) => {
      console.warn(label + " failed to load.", error);
      if (active) setState({ status: "error" });
    });
    return () => { active = false; };
  }, [viewer, visible, label]);

  useEffect(() => () => {
    overlayRef.current?.dispose();
    overlayRef.current = null;
  }, [viewer]);

  return state;
}
