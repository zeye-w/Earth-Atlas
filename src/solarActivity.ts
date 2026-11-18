/**
 * The Sun now: solar flares and the X-ray level from the GOES satellites
 * (NOAA SWPC, public, CORS-enabled), and the latest images from NASA's Solar
 * Dynamics Observatory. Parsers are pure and Cesium-free.
 *
 * Flare classes follow the peak 0.1–0.8 nm X-ray flux in W/m²: A < 1e-7,
 * B < 1e-6, C < 1e-5, M < 1e-4, X above; the number is the multiple
 * (M2.3 = 2.3e-5 W/m²).
 */

export const FLARES_URL = "https://services.swpc.noaa.gov/json/goes/primary/xray-flares-7-day.json";
export const XRAYS_URL = "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json";
export const SOLAR_REFRESH_MS = 5 * 60_000;

export interface Flare {
  begin: number;
  peak: number;
  /** Null while the flare is still in progress. */
  end: number | null;
  /** Peak class, e.g. "M2.3". */
  peakClass: string;
  peakFlux: number;
}

export interface SolarActivity {
  flares: Flare[];
  /** The latest long-wavelength (0.1–0.8 nm) X-ray flux and its time. */
  xray: { time: number; flux: number } | null;
}

const LETTERS = [["X", 1e-4], ["M", 1e-5], ["C", 1e-6], ["B", 1e-7], ["A", 1e-8]] as const;

/** "M2.3" for 2.3e-5 W/m². */
export function flareClass(flux: number): string {
  if (!(flux > 0)) return "A0.0";
  for (const [letter, base] of LETTERS) {
    if (flux >= base) return letter + (Math.floor((flux / base) * 10) / 10).toFixed(1);
  }
  return "A" + (Math.floor((flux / 1e-8) * 10) / 10).toFixed(1);
}

/** Flux of a class string ("M2.3" → 2.3e-5), or null. */
export function classFlux(value: string): number | null {
  const m = /^([ABCMX])(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!m) return null;
  const base = LETTERS.find(([letter]) => letter === m[1])![1];
  return base * Number(m[2]);
}

const time = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

export function parseFlares(json: unknown): Flare[] {
  if (!Array.isArray(json)) throw new Error("flares: not a list");
  const flares: Flare[] = [];
  for (const row of json) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const begin = time(r.begin_time), peak = time(r.max_time);
    const peakFlux = typeof r.max_xrlong === "number" ? r.max_xrlong : classFlux(String(r.max_class ?? ""));
    if (begin === null || peak === null || !peakFlux) continue;
    flares.push({ begin, peak, end: time(r.end_time), peakClass: typeof r.max_class === "string" ? r.max_class : flareClass(peakFlux), peakFlux });
  }
  // One row per flare; the feed can repeat a flare that is being updated.
  const unique = new Map(flares.map((f) => [f.begin, f]));
  return [...unique.values()].sort((a, b) => b.peak - a.peak);
}

export function parseXrays(json: unknown): SolarActivity["xray"] {
  if (!Array.isArray(json)) throw new Error("xrays: not a list");
  for (let i = json.length - 1; i >= 0; i--) {
    const r = json[i] as Record<string, unknown> | null;
    if (r && r.energy === "0.1-0.8nm" && typeof r.flux === "number" && r.flux > 0) {
      const t = time(r.time_tag);
      if (t !== null) return { time: t, flux: r.flux };
    }
  }
  return null;
}

export async function fetchSolarActivity(signal: AbortSignal): Promise<SolarActivity> {
  const get = async (url: string) => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(url + ": HTTP " + response.status);
    return response.json();
  };
  const [flares, xrays] = await Promise.allSettled([get(FLARES_URL), get(XRAYS_URL)]);
  if (flares.status === "rejected" && xrays.status === "rejected") throw flares.reason;
  return {
    flares: flares.status === "fulfilled" ? parseFlares(flares.value) : [],
    xray: xrays.status === "fulfilled" ? parseXrays(xrays.value) : null,
  };
}

/** The strongest flare peaking in [from, to], or null. */
export function strongestFlare(flares: readonly Flare[], from: number, to: number): Flare | null {
  let best: Flare | null = null;
  for (const f of flares) if (f.peak >= from && f.peak <= to && (!best || f.peakFlux > best.peakFlux)) best = f;
  return best;
}

/** What an M or X flare can mean on Earth (NOAA's radio blackout scale R1–R5). */
export function radioBlackout(flux: number): string | null {
  if (flux >= 2e-3) return "R5";
  if (flux >= 1e-3) return "R4";
  if (flux >= 1e-4) return "R3";
  if (flux >= 5e-5) return "R2";
  if (flux >= 1e-5) return "R1";
  return null;
}

/** NASA SDO's latest images; each refreshes every few minutes. */
export const SDO_VIEWS = [
  { id: "0171", label: "日冕 · 171 Å", note: "约 60 万度的日冕，可以看到磁力线组成的冕环" },
  { id: "0304", label: "色球 · 304 Å", note: "约 5 万度的色球层和日珥" },
  { id: "0193", label: "日冕 · 193 Å", note: "日冕和日冕洞（暗区，高速太阳风从这里吹出）" },
  { id: "HMIIC", label: "可见光", note: "肉眼波段的太阳表面，黑子清晰可见" },
  { id: "HMIBC", label: "磁场", note: "表面磁场：白色和黑色是相反的磁极" },
] as const;
export type SdoView = (typeof SDO_VIEWS)[number]["id"];

/** The image, with a cache key that changes every 15 minutes (the files are overwritten in place). */
export function sdoImageUrl(view: SdoView, now: number, size: 512 | 1024 = 1024): string {
  return `https://sdo.gsfc.nasa.gov/assets/img/latest/latest_${size}_${view}.jpg?t=${Math.floor(now / 900_000)}`;
}
