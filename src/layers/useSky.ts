import { useEffect } from "react";
import { SkyBox, type Viewer } from "cesium";
import { skySize, type RenderQuality, type SkySize } from "../performance";

/**
 * The real sky behind the globe: NASA's Deep Star Maps 2020 (stars and the
 * Milky Way in their true places; optionally the constellation figures) as
 * the sky box, in place of Cesium's built-in one. The faces are fetched a few
 * seconds after start, so they never compete with the globe's first tiles,
 * and swapped in only once all six have loaded. Face sizes: skySize in
 * src/performance.ts (1024, 2048 or, far out on a large screen, 4096 px).
 */
const SIDES = { positiveX: "px", negativeX: "mx", positiveY: "py", negativeY: "my", positiveZ: "pz", negativeZ: "mz" } as const;
/** Delay after the globe is created before the sky's faces are fetched. */
const START_DELAY_MS = 3_000;

export function skyFaces(variant: "sky" | "lines", size: SkySize): Record<keyof typeof SIDES, string> {
  return Object.fromEntries(Object.entries(SIDES).map(([side, face]) => [side, `/sky/${variant}-${size}-${face}.jpg`])) as Record<keyof typeof SIDES, string>;
}

/** Loads the six faces; Cesium's sky box takes the images themselves, so each face is fetched once. */
function preload(faces: Record<keyof typeof SIDES, string>): Promise<Record<keyof typeof SIDES, HTMLImageElement>> {
  return Promise.all(Object.entries(faces).map(([side, url]) => new Promise<[string, HTMLImageElement]>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve([side, image]);
    image.onerror = () => reject(new Error("sky face " + url));
    image.src = url;
  }))).then((entries) => Object.fromEntries(entries) as Record<keyof typeof SIDES, HTMLImageElement>);
}

/** The graphics card's largest cube map, from the globe's own WebGL context (asking again returns the same one). */
function maxCubeMapSize(viewer: Viewer): number {
  const canvas = viewer.canvas;
  const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
  return gl ? Number(gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE)) || 0 : 0;
}

let defaultSky: SkyBox | null = null;

export function useSky(viewer: Viewer | null, layers: { realSky: boolean; constellations: boolean; sun: boolean }, quality: RenderQuality, far = false) {
  // In the far view the globe costs almost nothing, so the sky gets the sharper faces (except in eco).
  // The far view draws at the screen's own resolution (up to 2x), so that is the width the sky fills.
  const bufferWidth = viewer && !viewer.isDestroyed() ? viewer.canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2) : 0;
  const size = skySize(quality, far, { maxCubeMap: viewer && !viewer.isDestroyed() ? maxCubeMapSize(viewer) : 0, bufferWidth });
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
    // The constellation figures come at up to 2048 px.
    const faces = skyFaces(layers.constellations ? "lines" : "sky", layers.constellations && size > 2048 ? 2048 : size);
    const swap = () => preload(faces).then((images) => {
      if (cancelled || viewer.isDestroyed()) return;
      const previous = scene.skyBox;
      scene.skyBox = new SkyBox({ sources: images });
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
