import { useEffect } from "react";
import { SkyBox, type Viewer } from "cesium";
import type { RenderQuality } from "../performance";

/**
 * The real sky behind the globe: NASA's Deep Star Maps 2020 (stars and the
 * Milky Way in their true places; optionally the constellation figures) as
 * the sky box, in place of Cesium's built-in one. The faces are fetched a few
 * seconds after start, so they never compete with the globe's first tiles,
 * and swapped in only once all six have loaded. 1024 px faces except in the
 * "high" quality (2048 px).
 */
const SIDES = { positiveX: "px", negativeX: "mx", positiveY: "py", negativeY: "my", positiveZ: "pz", negativeZ: "mz" } as const;
/** Delay after the globe is created before the sky's faces are fetched. */
const START_DELAY_MS = 3_000;

export function skyFaces(variant: "sky" | "lines", size: 1024 | 2048): Record<keyof typeof SIDES, string> {
  return Object.fromEntries(Object.entries(SIDES).map(([side, face]) => [side, `/sky/${variant}-${size}-${face}.jpg`])) as Record<keyof typeof SIDES, string>;
}

function preload(urls: readonly string[]): Promise<void> {
  return Promise.all(urls.map((url) => new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("sky face " + url));
    image.src = url;
  }))).then(() => undefined);
}

let defaultSky: SkyBox | null = null;

export function useSky(viewer: Viewer | null, layers: { realSky: boolean; constellations: boolean; sun: boolean }, quality: RenderQuality) {
  const size = quality === "high" ? 2048 : 1024;
  useEffect(() => {
    if (!viewer) return;
    const scene = viewer.scene;
    defaultSky ??= scene.skyBox instanceof SkyBox ? scene.skyBox : null;
    let cancelled = false;
    let timer = 0;
    if (!layers.realSky) {
      if (defaultSky && scene.skyBox !== defaultSky) { scene.skyBox = defaultSky; scene.requestRender(); }
      return;
    }
    const faces = skyFaces(layers.constellations ? "lines" : "sky", size);
    const swap = () => preload(Object.values(faces)).then(() => {
      if (cancelled || viewer.isDestroyed()) return;
      const previous = scene.skyBox;
      scene.skyBox = new SkyBox({ sources: faces });
      // Cesium's own sky box is kept for when the real sky is turned off.
      if (previous && previous !== defaultSky && !previous.isDestroyed()) previous.destroy();
      scene.requestRender();
    }, (error) => console.warn("Real sky unavailable; keeping the built-in one.", String(error)));
    // The first swap waits for the globe; later ones (constellations, quality) happen at once.
    timer = window.setTimeout(swap, scene.skyBox === defaultSky ? START_DELAY_MS : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [viewer, layers.realSky, layers.constellations, size]);

  // Cesium's Sun: a disc with a glow where the Sun really is (the scene light already follows it).
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !viewer.scene.sun) return;
    viewer.scene.sun.show = layers.sun;
    viewer.scene.requestRender();
  }, [viewer, layers.sun]);
}
