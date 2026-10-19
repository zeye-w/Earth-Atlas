/**
 * Smithsonian Global Volcanism Program, Volcanoes of the World (Holocene
 * list), bundled as a lazily imported chunk. Refresh with the
 * "Refresh Volcano Data" workflow (scripts/fetch-volcanoes.mjs).
 */
export interface Volcano {
  id: number | null;
  name: string;
  country: string;
  type: string;
  /** Year of the most recent eruption in the GVP catalogue; negative = BCE. */
  lastEruption: number | null;
  elevation: number | null;
  lon: number;
  lat: number;
}

export interface VolcanoCatalog {
  source: string;
  retrieved: string;
  volcanoes: Volcano[];
}

export const VOLCANO_ID_PREFIX = "volcano:";
// "Recently active" here means an eruption year in the catalogue within
// this many years; it is not a real-time alert level.
export const RECENT_ERUPTION_YEARS = 5;

export async function loadVolcanoCatalog(): Promise<VolcanoCatalog> {
  const module = await import("./data/volcanoes.json");
  return module.default as unknown as VolcanoCatalog;
}

export function isRecentlyActive(volcano: Volcano, now = new Date()): boolean {
  return volcano.lastEruption !== null && volcano.lastEruption >= now.getUTCFullYear() - RECENT_ERUPTION_YEARS;
}

export function formatEruptionYear(year: number | null): string {
  if (year === null) return "未知";
  return year < 0 ? "公元前 " + Math.abs(year) + " 年" : year + " 年";
}

export function gvpUrl(volcano: Volcano): string {
  return volcano.id ? "https://volcano.si.edu/volcano.cfm?vn=" + volcano.id : "https://volcano.si.edu/";
}
