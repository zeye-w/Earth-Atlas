/**
 * Render budgets for a full-viewport Cesium globe.
 * Cesium renders at CSS-pixel resolution by default, so on a 2x screen a
 * resolutionScale of 1 draws half the physical pixels and looks soft. Each
 * profile instead caps how much of the device pixel ratio is used.
 */
export type RenderQuality = "eco" | "balanced" | "high";
export interface RenderProfile {
  /** Upper bound on rendered pixels per CSS pixel. */
  maxPixelRatio: number;
  targetFrameRate: number;
  maximumScreenSpaceError: number;
  /**
   * Imagery/terrain tiles kept after they leave the view (Cesium's default is
   * 100), so turning back to a region shows it at once instead of fetching
   * and decoding it again.
   */
  tileCacheSize: number;
}
export const RENDER_PROFILES: Readonly<Record<RenderQuality, Readonly<RenderProfile>>> = {
  eco: { maxPixelRatio: 1, targetFrameRate: 30, maximumScreenSpaceError: 3, tileCacheSize: 300 },
  balanced: { maxPixelRatio: 1.25, targetFrameRate: 45, maximumScreenSpaceError: 2, tileCacheSize: 1000 },
  high: { maxPixelRatio: 2, targetFrameRate: 60, maximumScreenSpaceError: 1.5, tileCacheSize: 1500 },
};
/**
 * Once the globe has been still for a moment, finer tiles are requested
 * (screen-space error × this), since nothing competes for the frame budget.
 */
export const SETTLED_DETAIL = 0.7;
/** Below this pixel ratio FXAA is worth its slight texture softening. */
export const FXAA_MAX_PIXEL_RATIO = 1.25;

export interface RenderSettings {
  resolutionScale: number;
  targetFrameRate: number;
  maximumScreenSpaceError: number;
  fxaa: boolean;
  tileCacheSize: number;
}
/**
 * `settled`: the camera has been still for a while (not just stopped).
 * `far`: the far view (src/farView.ts), where the globe costs almost
 * nothing, so the sky is drawn at the screen's own resolution (up to 2×).
 */
export function renderSettings(quality: RenderQuality, devicePixelRatio: number, moving = false, settled = false, far = false): RenderSettings {
  const profile = RENDER_PROFILES[quality];
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  // Reduce fill-rate only during interaction; restore the selected profile at rest.
  const motionCap = quality === "high" ? 1.25 : 1;
  const resolutionScale = far && quality !== "eco" ? Math.min(dpr, 2) : Math.min(dpr, profile.maxPixelRatio, moving ? motionCap : Infinity);
  return {
    resolutionScale,
    targetFrameRate: profile.targetFrameRate,
    maximumScreenSpaceError: profile.maximumScreenSpaceError * (moving ? 1.5 : settled && quality !== "eco" ? SETTLED_DETAIL : 1),
    fxaa: resolutionScale < FXAA_MAX_PIXEL_RATIO,
    tileCacheSize: profile.tileCacheSize,
  };
}
export const RENDER_QUALITY_LABELS: Readonly<Record<RenderQuality, string>> = {
  eco: "省电",
  balanced: "均衡",
  high: "高清",
};
export const RENDER_QUALITY_ORDER: readonly RenderQuality[] = ["eco", "balanced", "high"];

/**
 * The starting quality. A high-density screen on a capable computer (8+
 * cores, 8+ GB where the browser says) starts at "high", drawing at the
 * screen's own resolution; the automatic downgrade still steps it down if
 * the frame rate cannot keep up.
 */
export function initialRenderQuality(viewportWidth: number, reducedMotion: boolean, hardwareConcurrency?: number, devicePixelRatio = 1, deviceMemoryGb?: number): RenderQuality {
  if (reducedMotion || viewportWidth < 900 || (hardwareConcurrency !== undefined && hardwareConcurrency <= 2)) return "eco";
  const capable = hardwareConcurrency !== undefined && hardwareConcurrency >= 8 && (deviceMemoryGb === undefined || deviceMemoryGb >= 8);
  return capable && devicePixelRatio >= 1.5 ? "high" : "balanced";
}
export function nextRenderQuality(current: RenderQuality): RenderQuality {
  const index = RENDER_QUALITY_ORDER.indexOf(current);
  return RENDER_QUALITY_ORDER[(index + 1) % RENDER_QUALITY_ORDER.length];
}

/** Below this sustained frame rate while the globe moves, step quality down. */
export const AUTO_QUALITY_MIN_FPS = 24;
// Evaluate after this much continuous rendering (time-based, so very slow
// devices are measured as quickly as fast ones).
const AUTO_QUALITY_WINDOW_MS = 2_000;
const AUTO_QUALITY_MIN_FRAMES = 15;
// Frames further apart than this are not part of one continuous run.
const AUTO_QUALITY_MAX_GAP_MS = 1_000;

export function lowerRenderQuality(current: RenderQuality): RenderQuality | null {
  const index = RENDER_QUALITY_ORDER.indexOf(current);
  return index > 0 ? RENDER_QUALITY_ORDER[index - 1] : null;
}

/**
 * Measures frame rate over continuous runs of rendered frames (the app only
 * renders on demand, so idle gaps are ignored). Feed it frames only while the
 * camera is moving, when Cesium renders every frame up to its target rate.
 */
export class FrameRateMonitor {
  private frames = 0;
  private elapsedMs = 0;
  private lastFrameMs = 0;

  /** Returns the average fps once a full window has been collected. */
  addFrame(timeMs: number): number | null {
    const gap = timeMs - this.lastFrameMs;
    this.lastFrameMs = timeMs;
    if (gap <= 0 || gap > AUTO_QUALITY_MAX_GAP_MS) return null;
    this.frames++;
    this.elapsedMs += gap;
    if (this.elapsedMs < AUTO_QUALITY_WINDOW_MS || this.frames < AUTO_QUALITY_MIN_FRAMES) return null;
    const fps = (this.frames * 1000) / this.elapsedMs;
    this.frames = 0;
    this.elapsedMs = 0;
    return fps;
  }

  reset(): void {
    this.frames = 0;
    this.elapsedMs = 0;
    this.lastFrameMs = 0;
  }
}

/**
 * Keep global MVT hierarchy small. Levels 0..5 allocate 1,365 nodes,
 * versus 5,461 nodes at levels 0..6 (75% fewer nodes).
 */
export const GLOBAL_VECTOR_MAX_ZOOM = 5;
export const GLOBAL_VECTOR_TILE_NODES = (4 ** (GLOBAL_VECTOR_MAX_ZOOM + 1) - 1) / 3;

export type SkySize = 1024 | 2048 | 4096;

/** Sky pixels a degree at the middle of a 2048 px face (it covers 90°: 1024 px per unit of tan). */
const SKY_2048_PX_PER_DEG = 1024 * Math.PI / 180;

/**
 * Screen pixels a degree at the middle of the view, for a drawing buffer
 * `bufferWidth` px wide and Cesium's horizontal field of view (60° by default).
 */
export function screenPxPerDegree(bufferWidth: number, fovDeg = 60): number {
  return bufferWidth / 2 / Math.tan((fovDeg * Math.PI) / 360) * Math.PI / 180;
}

export interface SkyScreen {
  /** The graphics card's largest cube map face (0 when unknown). */
  maxCubeMap: number;
  /** The drawing buffer's width in device pixels. */
  bufferWidth: number;
}

/**
 * Face size: 2048 px in "high" quality or any far view (except eco), 1024
 * otherwise; 4096 px (about 22 MB, built from NASA's 16K Milky Way and
 * bright-star layers by scripts/sky/build-sky-hd.py) in the far view, except
 * in eco, where the card takes it and the screen shows more than a third
 * more pixels a degree than a 2048 px face holds (a 2048 px face is then
 * stretched). The far view is where the sky fills the screen and the scene is
 * drawn at the screen's own resolution (renderSettings).
 */
export function skySize(quality: RenderQuality, far: boolean, screen: SkyScreen = { maxCubeMap: 0, bufferWidth: 0 }): SkySize {
  if (far && quality !== "eco" && screen.maxCubeMap >= 4096 && screenPxPerDegree(screen.bufferWidth) > SKY_2048_PX_PER_DEG * 1.35) return 4096;
  return quality === "high" || (far && quality !== "eco") ? 2048 : 1024;
}

