/**
 * NOAA SWPC OVATION aurora nowcast: a 1-degree global grid of the
 * probability (0-100 %) of visible aurora, refreshed roughly every 5 minutes.
 * https://www.swpc.noaa.gov/products/aurora-30-minute-forecast
 */
export const OVATION_URL = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
export const OVATION_REFRESH_MS = 10 * 60 * 1000;
// Probabilities below this are treated as no visible aurora.
export const AURORA_THRESHOLD = 3;
// Probability at which the curtain reaches full brightness.
const FULL_BRIGHTNESS_PROBABILITY = 60;
const LATITUDES = 181; // -90..90

export interface OvationGrid {
  observationTime: Date | null;
  forecastTime: Date | null;
  /** Index: longitude (0..359) * 181 + (latitude + 90). */
  values: Float32Array;
  maxProbability: number;
}

function parseTime(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value.endsWith("Z") ? value : value + "Z");
  return Number.isFinite(date.getTime()) ? date : null;
}

export function parseOvation(json: unknown): OvationGrid {
  const root = json as Record<string, unknown> | null;
  const coordinates = root?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 10_000) {
    throw new Error("OVATION payload has no coordinate grid");
  }
  const values = new Float32Array(360 * LATITUDES);
  let maxProbability = 0;
  let accepted = 0;
  for (const entry of coordinates) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const lon = Math.round(Number(entry[0]));
    const lat = Math.round(Number(entry[1]));
    const value = Number(entry[2]);
    if (!Number.isFinite(value) || lon < 0 || lon > 359 || lat < -90 || lat > 90) continue;
    values[lon * LATITUDES + lat + 90] = value;
    if (value > maxProbability) maxProbability = value;
    accepted++;
  }
  if (accepted < 10_000) throw new Error("OVATION grid is incomplete");
  return {
    observationTime: parseTime(root?.["Observation Time"]),
    forecastTime: parseTime(root?.["Forecast Time"]),
    values,
    maxProbability,
  };
}

export type Hemisphere = "north" | "south";

export interface AuroraProfile {
  hemisphere: Hemisphere;
  /** Per longitude 0..359: probability-weighted latitude of the oval. */
  latitudes: number[];
  /** Per longitude 0..359: brightness 0..1 from the peak probability. */
  intensities: number[];
  /** Peak probability (%) in this hemisphere. */
  maxProbability: number;
}

function circularSmooth(values: number[], radius: number): number[] {
  const n = values.length;
  return values.map((_, i) => {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += values[(i + k + n) % n];
    return sum / (2 * radius + 1);
  });
}

/** Highest probability (%) between 40° and 89° in one hemisphere. */
export function hemisphereMax(grid: OvationGrid, hemisphere: Hemisphere): number {
  const sign = hemisphere === "north" ? 1 : -1;
  let max = 0;
  for (let lon = 0; lon < 360; lon++) {
    for (let abs = 40; abs <= 89; abs++) max = Math.max(max, grid.values[lon * LATITUDES + sign * abs + 90]);
  }
  return max;
}

/**
 * Auroral oval of one hemisphere (40°–89° north or south), or null when no
 * longitude exceeds the threshold there.
 */
export function ovalProfile(grid: OvationGrid, hemisphere: Hemisphere, threshold = AURORA_THRESHOLD): AuroraProfile | null {
  const sign = hemisphere === "north" ? 1 : -1;
  const latitudes: number[] = new Array(360).fill(Number.NaN);
  const peaks: number[] = new Array(360).fill(0);
  for (let lon = 0; lon < 360; lon++) {
    let weight = 0;
    let weightedLat = 0;
    let peak = 0;
    for (let abs = 40; abs <= 89; abs++) {
      const lat = sign * abs;
      const value = grid.values[lon * LATITUDES + lat + 90];
      if (value > peak) peak = value;
      const w = value - threshold;
      if (w > 0) { weight += w; weightedLat += w * lat; }
    }
    if (weight > 0) latitudes[lon] = weightedLat / weight;
    peaks[lon] = peak >= threshold ? peak : 0;
  }
  const valid = latitudes.map((lat, lon) => (Number.isFinite(lat) ? lon : -1)).filter((lon) => lon >= 0);
  if (valid.length === 0) return null;
  // Longitudes without aurora borrow a latitude interpolated between their
  // nearest valid neighbours so the (invisible) curtain stays continuous.
  for (let lon = 0; lon < 360; lon++) {
    if (Number.isFinite(latitudes[lon])) continue;
    const before = [...valid].reverse().find((v) => v < lon) ?? valid[valid.length - 1];
    const after = valid.find((v) => v > lon) ?? valid[0];
    const span = (after - before + 360) % 360 || 360;
    const t = ((lon - before + 360) % 360) / span;
    latitudes[lon] = latitudes[before] + (latitudes[after] - latitudes[before]) * t;
  }
  const smoothedPeaks = circularSmooth(peaks, 2);
  return {
    hemisphere,
    latitudes: circularSmooth(latitudes, 4),
    intensities: smoothedPeaks.map((p) => Math.min(1, Math.sqrt(Math.max(0, p) / FULL_BRIGHTNESS_PROBABILITY))),
    maxProbability: hemisphereMax(grid, hemisphere),
  };
}

export function northernProfile(grid: OvationGrid, threshold = AURORA_THRESHOLD): AuroraProfile | null {
  return ovalProfile(grid, "north", threshold);
}

export function southernProfile(grid: OvationGrid, threshold = AURORA_THRESHOLD): AuroraProfile | null {
  return ovalProfile(grid, "south", threshold);
}

let cache: { at: number; grid: OvationGrid } | null = null;

export async function fetchOvation(signal?: AbortSignal): Promise<OvationGrid> {
  if (cache && Date.now() - cache.at < OVATION_REFRESH_MS) return cache.grid;
  const response = await fetch(OVATION_URL, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("NOAA OVATION HTTP " + response.status);
  const grid = parseOvation(await response.json());
  cache = { at: Date.now(), grid };
  return grid;
}
