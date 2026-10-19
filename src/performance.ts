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
}
export const RENDER_PROFILES: Readonly<Record<RenderQuality, Readonly<RenderProfile>>> = {
  eco: { maxPixelRatio: 1, targetFrameRate: 30, maximumScreenSpaceError: 3 },
  balanced: { maxPixelRatio: 1.5, targetFrameRate: 45, maximumScreenSpaceError: 2 },
  high: { maxPixelRatio: 2, targetFrameRate: 60, maximumScreenSpaceError: 1.5 },
};
/** Below this pixel ratio FXAA is worth its slight texture softening. */
export const FXAA_MAX_PIXEL_RATIO = 1.25;

export interface RenderSettings {
  resolutionScale: number;
  targetFrameRate: number;
  maximumScreenSpaceError: number;
  fxaa: boolean;
}
export function renderSettings(quality: RenderQuality, devicePixelRatio: number): RenderSettings {
  const profile = RENDER_PROFILES[quality];
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const resolutionScale = Math.min(dpr, profile.maxPixelRatio);
  return {
    resolutionScale,
    targetFrameRate: profile.targetFrameRate,
    maximumScreenSpaceError: profile.maximumScreenSpaceError,
    fxaa: resolutionScale < FXAA_MAX_PIXEL_RATIO,
  };
}
export const RENDER_QUALITY_LABELS: Readonly<Record<RenderQuality, string>> = {
  eco: "省电",
  balanced: "均衡",
  high: "高清",
};
export const RENDER_QUALITY_ORDER: readonly RenderQuality[] = ["eco", "balanced", "high"];

export function initialRenderQuality(viewportWidth: number, reducedMotion: boolean, hardwareConcurrency?: number): RenderQuality {
  return reducedMotion || viewportWidth < 900 || (hardwareConcurrency !== undefined && hardwareConcurrency <= 2)
    ? "eco"
    : "balanced";
}
export function nextRenderQuality(current: RenderQuality): RenderQuality {
  const index = RENDER_QUALITY_ORDER.indexOf(current);
  return RENDER_QUALITY_ORDER[(index + 1) % RENDER_QUALITY_ORDER.length];
}

/**
 * Keep global MVT hierarchy small. Levels 0..5 allocate 1,365 nodes,
 * versus 5,461 nodes at levels 0..6 (75% fewer nodes).
 */
export const GLOBAL_VECTOR_MAX_ZOOM = 5;
export const GLOBAL_VECTOR_TILE_NODES = (4 ** (GLOBAL_VECTOR_MAX_ZOOM + 1) - 1) / 3;
