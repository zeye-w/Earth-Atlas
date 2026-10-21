/**
 * Real-time solar wind at the L1 point (DSCOVR / ACE, NOAA SWPC RTSW) and the
 * magnetopause it implies. Cesium-free so it can be unit tested.
 * https://www.swpc.noaa.gov/products/real-time-solar-wind
 */
export const WIND_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json";
export const MAG_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json";
/** The feeds cover about the last 24 hours (~4 MB together), so refresh sparingly. */
export const SOLAR_WIND_REFRESH_MS = 10 * 60 * 1000;
/** A timeline moment uses the nearest sample within this window. */
export const SOLAR_WIND_TOLERANCE_MS = 30 * 60 * 1000;
export const EARTH_RADIUS_KM = 6371;

export interface SolarWindSample {
  time: number;
  /** Proton density, cm^-3. */
  density: number;
  /** Bulk speed, km/s. */
  speed: number;
  /** IMF Bz (GSM), nT; negative = southward. */
  bz: number | null;
  bt: number | null;
  /** Spacecraft that measured it (e.g. DSCOVR, ACE, IMAP). */
  source: string;
}

type Row = Record<string, unknown>;

function parseTime(value: unknown): number {
  if (typeof value !== "string") return Number.NaN;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
}

const num = (value: unknown) => (value === null || value === undefined || value === "" ? Number.NaN : Number(value));

/**
 * Per minute, the row from the spacecraft SWPC marks active (operational);
 * otherwise any row with usable values. The feeds list several spacecraft.
 */
function byMinute(rows: unknown, usable: (row: Row) => boolean): Map<number, Row> {
  const best = new Map<number, Row>();
  if (!Array.isArray(rows)) return best;
  for (const row of rows as Row[]) {
    if (!row || typeof row !== "object" || !usable(row)) continue;
    const time = parseTime(row.time_tag);
    if (!Number.isFinite(time)) continue;
    const minute = Math.round(time / 60_000);
    const current = best.get(minute);
    if (!current || (row.active === true && current.active !== true)) best.set(minute, row);
  }
  return best;
}

/**
 * Joins the RTSW wind feed (proton speed and density) with the magnetometer
 * feed (Bz, Bt) by minute. Rows with missing or unphysical plasma values are
 * dropped; Bz is optional.
 */
export function parseSolarWind(wind: unknown, mag: unknown): SolarWindSample[] {
  if (!Array.isArray(wind)) throw new Error("SWPC wind feed is not an array");
  const plasma = byMinute(wind, (row) => {
    const density = num(row.proton_density);
    const speed = num(row.proton_speed);
    return density > 0 && density < 200 && speed > 150 && speed < 3000;
  });
  const field = byMinute(mag, (row) => Number.isFinite(num(row.bz_gsm)) && Math.abs(num(row.bz_gsm)) < 200);
  const samples: SolarWindSample[] = [];
  for (const [minute, row] of plasma) {
    const b = field.get(minute);
    const bt = b ? num(b.bt) : Number.NaN;
    samples.push({
      time: minute * 60_000,
      density: num(row.proton_density),
      speed: num(row.proton_speed),
      bz: b ? num(b.bz_gsm) : null,
      bt: Number.isFinite(bt) ? bt : null,
      source: typeof row.source === "string" ? row.source : "",
    });
  }
  if (samples.length === 0) throw new Error("SWPC solar wind has no valid samples");
  return samples.sort((a, b) => a.time - b.time);
}

/** Nearest sample to `time` within the tolerance, or null. */
export function sampleAt(samples: readonly SolarWindSample[], time: number, tolerance = SOLAR_WIND_TOLERANCE_MS): SolarWindSample | null {
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].time < time) lo = mid + 1; else hi = mid;
  }
  const candidates = [samples[lo - 1], samples[lo]].filter(Boolean);
  const best = candidates.reduce<SolarWindSample | null>((a, b) => (!a || Math.abs(b.time - time) < Math.abs(a.time - time) ? b : a), null);
  return best && Math.abs(best.time - time) <= tolerance ? best : null;
}

/** Solar wind dynamic pressure in nPa (protons only). */
export function dynamicPressure(density: number, speed: number): number {
  return 1.6726e-6 * density * speed * speed;
}

export interface Magnetopause {
  /** Subsolar standoff distance, Earth radii. */
  r0: number;
  /** Flaring exponent. */
  alpha: number;
}

/**
 * Shue et al. (1998) magnetopause: r(θ) = r0 · (2 / (1 + cos θ))^α, with θ
 * the angle from the Sun–Earth line. J. Geophys. Res. 103(A8), 17691.
 */
export function shueMagnetopause(pressure: number, bz: number): Magnetopause {
  const dp = Math.min(Math.max(pressure, 0.1), 100);
  const b = Math.min(Math.max(bz, -50), 50);
  const r0 = (10.22 + 1.29 * Math.tanh(0.184 * (b + 8.14))) * dp ** (-1 / 6.6);
  const alpha = (0.58 - 0.007 * b) * (1 + 0.024 * Math.log(dp));
  return { r0, alpha };
}

export function boundaryRadius(shape: Magnetopause, theta: number): number {
  return shape.r0 * (2 / (1 + Math.cos(theta))) ** shape.alpha;
}

/**
 * Bow shock, approximated as the magnetopause shape scaled to a standoff
 * about 1.3 times further out (typical magnetosheath thickness), and less
 * flared. A schematic, not a fitted shock model.
 */
export function bowShock(magnetopause: Magnetopause): Magnetopause {
  return { r0: magnetopause.r0 * 1.3, alpha: Math.max(0.45, magnetopause.alpha * 0.9) };
}

/** Qualitative state for the panel. */
export function solarWindLevel(sample: SolarWindSample): { label: string; stormy: boolean } {
  const south = sample.bz !== null && sample.bz <= -10;
  if (sample.speed >= 700 || (south && sample.speed >= 500)) return { label: "强扰动", stormy: true };
  if (sample.speed >= 500 || south) return { label: "偏强", stormy: true };
  return { label: "平静", stormy: false };
}

export async function fetchSolarWind(signal?: AbortSignal): Promise<SolarWindSample[]> {
  const [wind, mag] = await Promise.all([
    fetch(WIND_URL, { signal, headers: { Accept: "application/json" } }),
    fetch(MAG_URL, { signal, headers: { Accept: "application/json" } }).catch(() => null),
  ]);
  if (!wind.ok) throw new Error("SWPC wind HTTP " + wind.status);
  return parseSolarWind(await wind.json(), mag?.ok ? await mag.json().catch(() => null) : null);
}
