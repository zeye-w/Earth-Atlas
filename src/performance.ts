/**
 * Deliberately small render budgets for a full-viewport Cesium globe.
 * Cesium resolutionScale >1 on a high-DPI screen can multiply pixel work.
 * These settings preserve interaction while favoring GPU/battery headroom.
 */
export type RenderQuality = "eco" | "balanced" | "high";
export interface RenderProfile {
  resolutionScale: number;
  targetFrameRate: number;
  maximumScreenSpaceError: number;
  fxaa: boolean;
}
export const RENDER_PROFILES: Readonly<Record<RenderQuality, Readonly<RenderProfile>>> = {
  eco: { resolutionScale: 0.75, targetFrameRate: 30, maximumScreenSpaceError: 4, fxaa: false },
  balanced: { resolutionScale: 1, targetFrameRate: 45, maximumScreenSpaceError: 2.5, fxaa: true },
  high: { resolutionScale: 1.25, targetFrameRate: 60, maximumScreenSpaceError: 1.6, fxaa: true },
};
export const RENDER_QUALITY_LABELS: Readonly<Record<RenderQuality, string>> = {
  eco: "省电",
  balanced: "均衡",
  high: "高清",
};
export const RENDER_QUALITY_ORDER: readonly RenderQuality[] = ["eco", "balanced", "high"];

export function initialRenderQuality(viewportWidth: number, reducedMotion: boolean, hardwareConcurrency?: number): RenderQuality {
  return reducedMotion || viewportWidth < 900 || (hardwareConcurrency !== undefined && hardwareConcurrency <= 4)
    ? "eco"
    : "balanced";
}
export function initialSpaceMotion(viewportWidth: number, reducedMotion: boolean): boolean {
  return !reducedMotion && viewportWidth >= 900;
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
