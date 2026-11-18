/**
 * Near-Earth asteroids passing close in the coming weeks and where the deep
 * space probes are, from NASA JPL (the Small-Body Database close-approach
 * API and the Horizons ephemeris system). Neither API allows browsers to
 * call it directly (no CORS), so .github/workflows/space-data.yml fetches
 * them (scripts/fetch-space.mjs) and publishes a snapshot that the Worker
 * serves at /api/space.
 *
 * Positions are geocentric, in kilometres, in the ICRF (x to the March
 * equinox, z to the celestial north pole). Pure and Cesium-free.
 */

export const SPACE_URL = "/api/space";
export const SPACE_REFRESH_MS = 60 * 60_000;
export const SPACE_USER_AGENT = "TerraScope/1.0 (+https://github.com/zeye-w/Earth-Atlas)";
/** The mean Earth–Moon distance used by JPL for "LD", km. */
export const LUNAR_DISTANCE_KM = 384_398;
export const AU_KM = 149_597_870.7;
export const LIGHT_KM_S = 299_792.458;

export type Vec3 = [number, number, number];

export interface Asteroid {
  /** Designation, e.g. "2026 WJ". */
  id: string;
  /** Name with designation, e.g. "99942 Apophis (2004 MN4)". */
  name: string;
  /** Closest approach (ms). */
  approach: number;
  /** Nominal closest distance and its 3-sigma range, km. */
  distanceKm: number;
  distanceRangeKm: [number, number];
  /** Speed relative to the Earth at closest approach, km/s. */
  speedKms: number;
  /** Absolute magnitude H. */
  h: number;
  /** Measured diameter (m) when known. */
  diameterM: number | null;
  /** Geocentric positions around the approach: [time ms, x, y, z km]. */
  track: [number, number, number, number][];
}

export interface Probe {
  /** JPL Horizons spacecraft ID, e.g. -170 for JWST. */
  id: number;
  key: string;
  /** Geocentric position and velocity at `time`. */
  time: number;
  position: Vec3;
  velocity: Vec3;
  /** Distance from the Sun, km. */
  sunDistanceKm: number;
}

export interface SpaceSnapshot {
  v: 1;
  fetched: number;
  asteroids: Asteroid[];
  probes: Probe[];
}

/** The probes followed, with Horizons IDs, Chinese names and what they do. */
export const PROBES: readonly { id: number; key: string; name: string; note: string }[] = [
  { id: -170, key: "jwst", name: "詹姆斯·韦布空间望远镜", note: "红外空间望远镜，绕日地 L2 点运行" },
  { id: -21, key: "soho", name: "SOHO 太阳和日球层天文台", note: "在日地 L1 点持续观测太阳" },
  { id: -96, key: "parker", name: "帕克太阳探测器", note: "飞得离太阳最近的人造物体" },
  { id: -159, key: "clipper", name: "欧罗巴快船", note: "前往木卫二，2030 年到达" },
  { id: -28, key: "juice", name: "木星冰卫星探测器（JUICE）", note: "欧洲的木星探测器，2031 年到达" },
  { id: -255, key: "psyche", name: "灵神星探测器", note: "前往金属小行星灵神星，2029 年到达" },
  { id: -49, key: "lucy", name: "露西号", note: "飞掠木星的特洛伊小行星" },
  { id: -61, key: "juno", name: "朱诺号", note: "环绕木星" },
  { id: -98, key: "newhorizons", name: "新视野号", note: "2015 年飞掠冥王星，正在柯伊伯带" },
  { id: -32, key: "voyager2", name: "旅行者 2 号", note: "1977 年发射，已进入星际空间" },
  { id: -31, key: "voyager1", name: "旅行者 1 号", note: "离地球最远的人造物体" },
];

export function probeInfo(key: string) {
  return PROBES.find((p) => p.key === key) ?? null;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(finite);

export function parseSpaceSnapshot(json: unknown): SpaceSnapshot {
  const s = json as Partial<SpaceSnapshot> | null;
  if (!s || s.v !== 1 || !finite(s.fetched) || !Array.isArray(s.asteroids) || !Array.isArray(s.probes)) throw new Error("space: not a snapshot");
  const asteroids: Asteroid[] = [];
  for (const a of s.asteroids as Partial<Asteroid>[]) {
    if (!a || typeof a.id !== "string" || typeof a.name !== "string" || !finite(a.approach) || !finite(a.distanceKm) || !finite(a.speedKms) || !finite(a.h)) continue;
    const range = Array.isArray(a.distanceRangeKm) && a.distanceRangeKm.length === 2 && a.distanceRangeKm.every(finite) ? a.distanceRangeKm as [number, number] : [a.distanceKm, a.distanceKm] as [number, number];
    const track = Array.isArray(a.track) ? a.track.filter((p): p is [number, number, number, number] => Array.isArray(p) && p.length === 4 && p.every(finite)) : [];
    asteroids.push({ id: a.id.slice(0, 40), name: a.name.slice(0, 80), approach: a.approach, distanceKm: a.distanceKm, distanceRangeKm: range, speedKms: a.speedKms, h: a.h,
      diameterM: finite(a.diameterM) ? a.diameterM : null, track: track.sort((x, y) => x[0] - y[0]) });
  }
  const probes: Probe[] = [];
  for (const p of s.probes as Partial<Probe>[]) {
    if (!p || !finite(p.id) || typeof p.key !== "string" || !probeInfo(p.key) || !finite(p.time) || !vec(p.position) || !vec(p.velocity) || !finite(p.sunDistanceKm)) continue;
    probes.push({ id: p.id, key: p.key, time: p.time, position: p.position, velocity: p.velocity, sunDistanceKm: p.sunDistanceKm });
  }
  return { v: 1, fetched: s.fetched, asteroids: asteroids.sort((a, b) => a.approach - b.approach), probes };
}

export async function fetchSpace(signal: AbortSignal): Promise<SpaceSnapshot> {
  const response = await fetch(SPACE_URL, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("space: HTTP " + response.status);
  return parseSpaceSnapshot(await response.json());
}

/**
 * Diameter range (m) from the absolute magnitude, for albedos 0.25 (bright,
 * smaller) to 0.05 (dark, larger): D = 1329 km / √p × 10^(−H/5).
 */
export function diameterRange(h: number): [number, number] {
  const d = (albedo: number) => (1329 / Math.sqrt(albedo)) * 10 ** (-h / 5) * 1000;
  return [d(0.25), d(0.05)];
}

/** A size for people: the measured diameter, else the albedo range, rounded. */
export function sizeLabel(a: Pick<Asteroid, "h" | "diameterM">): string {
  const round = (m: number) => (m >= 1000 ? (m / 1000).toFixed(m >= 10_000 ? 0 : 1) + " km" : m >= 100 ? Math.round(m / 10) * 10 + " m" : Math.max(1, Math.round(m)) + " m");
  if (a.diameterM) return "约 " + round(a.diameterM);
  const [lo, hi] = diameterRange(a.h);
  return "约 " + round(lo) + "–" + round(hi);
}

/** Geocentric position at `time`, interpolated along the track (null outside it). */
export function asteroidAt(a: Asteroid, time: number): Vec3 | null {
  const t = a.track;
  if (t.length < 2 || time < t[0][0] || time > t[t.length - 1][0]) return null;
  let i = 1;
  while (i < t.length - 1 && t[i][0] < time) i++;
  const [t0, x0, y0, z0] = t[i - 1], [t1, x1, y1, z1] = t[i];
  const f = t1 === t0 ? 0 : (time - t0) / (t1 - t0);
  return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z0 + (z1 - z0) * f];
}

/** Probe position at `time`, moved along its velocity (fine for days; probes are fetched daily). */
export function probeAt(p: Probe, time: number): Vec3 {
  const dt = (time - p.time) / 1000;
  return [p.position[0] + p.velocity[0] * dt, p.position[1] + p.velocity[1] * dt, p.position[2] + p.velocity[2] * dt];
}

export const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

/** "1.68 LD" style distance in lunar distances, or AU / km for the far ones. */
export function distanceLabel(km: number): string {
  if (km >= 0.1 * AU_KM) return (km / AU_KM).toFixed(km >= 10 * AU_KM ? 0 : 2) + " 天文单位";
  if (km >= 2_000_000) return Math.round(km / 10_000) + " 万公里";
  return Math.round(km).toLocaleString("en-US") + " 公里";
}

/** One-way light time, e.g. "23 小时 6 分" or "5.1 秒". */
export function lightTimeLabel(km: number): string {
  const s = km / LIGHT_KM_S;
  if (s < 60) return s.toFixed(1) + " 秒";
  const m = Math.round(s / 60);
  if (m < 60) return m + " 分钟";
  return Math.floor(m / 60) + " 小时" + (m % 60 ? " " + (m % 60) + " 分" : "");
}
