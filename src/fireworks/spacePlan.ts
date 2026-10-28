export interface SpaceSite { longitude: number; latitude: number; label: string; kind: "fireworks" | "rocket" }
export const MAX_SPACE_SITES = 6;
export const MAX_REGION_METRES = 4_000_000;
export const SPACE_DURATION = 48;
export const GIANT_SCALE = 900;
/** Stars drawn per site (up to six sites play at once); halved at eco quality. */
export const SPACE_STAR_BUDGET = 252;
export function starStride(count: number, eco: boolean): number {
  return Math.max(1, Math.ceil(count / (eco ? SPACE_STAR_BUDGET / 2 : SPACE_STAR_BUDGET)));
}
const radius = 6_371_000;
const rad = Math.PI / 180;
export function siteDistance(a: SpaceSite, b: SpaceSite): number {
  const dlat = (b.latitude - a.latitude) * rad, dlon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dlon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
export function siteKey(site: Pick<SpaceSite, "longitude" | "latitude">): string {
  return `${site.longitude.toFixed(4)},${site.latitude.toFixed(4)}`;
}
export function planError(sites: readonly SpaceSite[]): string | null {
  if (!sites.length) return "请至少添加一个表演地点";
  if (sites.length > MAX_SPACE_SITES) return "最多同时选择 6 个地点";
  if (sites.some(s => !Number.isFinite(s.longitude) || Math.abs(s.longitude) > 180 || !Number.isFinite(s.latitude) || Math.abs(s.latitude) > 90)) return "地点坐标无效";
  if (new Set(sites.map(siteKey)).size !== sites.length) return "这个地点已经加入表演";
  for (const a of sites) for (const b of sites) if (siteDistance(a, b) > MAX_REGION_METRES) return "请选择同一区域的地点（相距不超过 4000 km），以便同屏观看";
  return null;
}
/** Spherical mean handles sites on either side of the date line. */
export function planCenter(sites: readonly SpaceSite[]) {
  let x = 0, y = 0, z = 0;
  for (const s of sites) {
    x += Math.cos(s.latitude * rad) * Math.cos(s.longitude * rad);
    y += Math.cos(s.latitude * rad) * Math.sin(s.longitude * rad);
    z += Math.sin(s.latitude * rad);
  }
  return { longitude: Math.atan2(y, x) / rad, latitude: Math.atan2(z, Math.hypot(x, y)) / rad };
}
export function siteDelay(index: number, relay: boolean): number { return relay ? index * 3 : 0; }
export function planDuration(count: number, relay: boolean): number { return SPACE_DURATION + siteDelay(Math.max(0, count - 1), relay); }
export function cameraRange(span: number, verticalFov: number, aspect: number, zoom: number): number {
  const half = Math.atan(Math.tan(verticalFov / 2) * Math.min(1, Math.max(0.1, aspect)));
  return Math.max(900_000, (span + 220_000) / Math.sin(half) * 1.1) / Math.max(0.75, Math.min(1.8, zoom));
}
