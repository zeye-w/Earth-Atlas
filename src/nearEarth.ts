/**
 * The structure of the space around the Earth, for drawing and for the
 * altitude ruler: the orbit bands and some reference orbits, the Van Allen
 * radiation belts along the geomagnetic dipole's field lines, and the
 * Earth–Moon Lagrange points. Pure geometry in kilometres, Earth-centred,
 * Cesium-free.
 */

export const EARTH_RADIUS_KM = 6371;
export const GEO_ALTITUDE_KM = 35_786;

export type Vec3 = [number, number, number];
const RAD = Math.PI / 180;

export interface ReferenceOrbit {
  key: string;
  name: string;
  /** Perigee and apogee altitude, km (equal for a circular orbit). */
  perigeeKm: number;
  apogeeKm: number;
  inclination: number;
  /** Argument of perigee (degrees), for the eccentric ones. */
  argPerigee?: number;
  color: string;
}

/** Orbits drawn as examples; orientation around the axis is illustrative, inclination and size are real. */
export const REFERENCE_ORBITS: readonly ReferenceOrbit[] = [
  { key: "iss", name: "国际空间站", perigeeKm: 420, apogeeKm: 420, inclination: 51.6, color: "#8fe3ff" },
  { key: "starlink", name: "星链", perigeeKm: 550, apogeeKm: 550, inclination: 53, color: "#b8c4ff" },
  { key: "glonass", name: "格洛纳斯", perigeeKm: 19_100, apogeeKm: 19_100, inclination: 64.8, color: "#ff9a8b" },
  { key: "gps", name: "GPS", perigeeKm: 20_200, apogeeKm: 20_200, inclination: 55, color: "#9be38f" },
  { key: "beidou", name: "北斗（中圆轨道）", perigeeKm: 21_528, apogeeKm: 21_528, inclination: 55, color: "#ff6b6b" },
  { key: "galileo", name: "伽利略", perigeeKm: 23_222, apogeeKm: 23_222, inclination: 56, color: "#7fb3ff" },
  { key: "molniya", name: "闪电轨道", perigeeKm: 500, apogeeKm: 39_700, inclination: 63.4, argPerigee: 270, color: "#e0a8ff" },
];

/**
 * Points of an orbit (Earth-centred, km): the perifocal ellipse turned by the
 * argument of perigee, inclination and the given ascending node longitude.
 */
export function orbitPoints(o: Pick<ReferenceOrbit, "perigeeKm" | "apogeeKm" | "inclination" | "argPerigee">, node: number, steps = 180): Vec3[] {
  const rp = EARTH_RADIUS_KM + o.perigeeKm, ra = EARTH_RADIUS_KM + o.apogeeKm;
  const a = (rp + ra) / 2, e = (ra - rp) / (ra + rp);
  const w = (o.argPerigee ?? 0) * RAD, i = o.inclination * RAD, W = node * RAD;
  const points: Vec3[] = [];
  for (let k = 0; k <= steps; k++) {
    const nu = (2 * Math.PI * k) / steps;
    const r = (a * (1 - e * e)) / (1 + e * Math.cos(nu));
    const u = w + nu;
    // Standard perifocal → equatorial rotation.
    points.push([
      r * (Math.cos(W) * Math.cos(u) - Math.sin(W) * Math.sin(u) * Math.cos(i)),
      r * (Math.sin(W) * Math.cos(u) + Math.cos(W) * Math.sin(u) * Math.cos(i)),
      r * Math.sin(u) * Math.sin(i),
    ]);
  }
  return points;
}

/** A circle in the equatorial plane at an altitude (GEO, the graveyard orbit). */
export const equatorialRing = (altitudeKm: number, steps = 240): Vec3[] =>
  orbitPoints({ perigeeKm: altitudeKm, apogeeKm: altitudeKm, inclination: 0 }, 0, steps);

/**
 * The geomagnetic dipole's north pole (IGRF-14, epoch 2025): the axis the
 * radiation belts are wrapped around, tilted about 9° from the spin axis.
 */
export const GEOMAGNETIC_NORTH = { latitude: 80.8, longitude: -72.7 };

/** Unit vectors of the dipole frame in Earth-fixed coordinates: e1, e2 across the axis, e3 along it. */
export function dipoleFrame(): [Vec3, Vec3, Vec3] {
  const lat = GEOMAGNETIC_NORTH.latitude * RAD, lon = GEOMAGNETIC_NORTH.longitude * RAD;
  const e3: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  // e1: perpendicular to the axis, in the plane of the axis and the spin axis.
  const z: Vec3 = [0, 0, 1];
  const d = e3[2];
  const raw: Vec3 = [z[0] - d * e3[0], z[1] - d * e3[1], z[2] - d * e3[2]];
  const n = Math.hypot(...raw);
  const e1: Vec3 = [raw[0] / n, raw[1] / n, raw[2] / n];
  const e2: Vec3 = [e3[1] * e1[2] - e3[2] * e1[1], e3[2] * e1[0] - e3[0] * e1[2], e3[0] * e1[1] - e3[1] * e1[0]];
  return [e1, e2, e3];
}

/**
 * A dipole field line: r = L·cos²λ Earth radii at magnetic latitude λ, in the
 * magnetic meridian at magnetic longitude φ (degrees), from footpoint to
 * footpoint (where it is `floorRe` Earth radii from the centre).
 */
export function fieldLine(L: number, phi: number, steps = 60, floorRe = 1.02): Vec3[] {
  const [e1, e2, e3] = dipoleFrame();
  const lmax = Math.acos(Math.sqrt(Math.min(1, floorRe / L)));
  const p = phi * RAD;
  const out: Vec3[] = [];
  for (let k = 0; k <= steps; k++) {
    const lam = -lmax + (2 * lmax * k) / steps;
    const r = L * Math.cos(lam) ** 2 * EARTH_RADIUS_KM;
    const c = r * Math.cos(lam), s = r * Math.sin(lam);
    out.push([0, 1, 2].map((j) => c * (Math.cos(p) * e1[j] + Math.sin(p) * e2[j]) + s * e3[j]) as Vec3);
  }
  return out;
}

/** A surface of revolution of one field line around the dipole axis, as a grid: rows of points along the line, one row per meridian. */
export function fieldShell(L: number, meridians = 48, steps = 40): Vec3[][] {
  return Array.from({ length: meridians + 1 }, (_, m) => fieldLine(L, (360 * m) / meridians, steps));
}

export interface Belt { key: "inner" | "outer"; name: string; /** L-shell range and the shell drawn at its heart. */ lRange: [number, number]; lPeak: number; particles: string; color: string }
export const BELTS: readonly Belt[] = [
  { key: "inner", name: "内辐射带", lRange: [1.2, 2.5], lPeak: 1.6, particles: "以高能质子为主，较稳定", color: "#ffb347" },
  { key: "outer", name: "外辐射带", lRange: [3, 7], lPeak: 4.5, particles: "以高能电子为主，随太阳活动剧烈变化", color: "#9b8cff" },
];

/** Equatorial altitude (km) of an L-shell: where its field line crosses the magnetic equator. */
export const lShellAltitudeKm = (L: number) => (L - 1) * EARTH_RADIUS_KM;

/** The South Atlantic Anomaly: where the inner belt comes lowest, centred off southern Brazil. */
export const SAA = { latitude: -26, longitude: -50, semiMajorKm: 4_800, semiMinorKm: 2_600, rotation: 15 };

/**
 * Earth–Moon Lagrange points from the Moon's position and velocity (any
 * Earth-centred frame, km and km/s): L1/L2 on the Earth–Moon line, L3 opposite
 * the Moon, L4/L5 60° ahead of and behind it in its orbital plane. Distances
 * from the circular restricted three-body solution for μ = 0.01215.
 */
export function earthMoonLagrange(moon: Vec3, moonVelocity: Vec3): Record<"L1" | "L2" | "L3" | "L4" | "L5", Vec3> {
  const d = Math.hypot(...moon);
  const u: Vec3 = [moon[0] / d, moon[1] / d, moon[2] / d];
  // Normal to the orbit, then the in-plane direction the Moon is heading.
  const n0: Vec3 = [moon[1] * moonVelocity[2] - moon[2] * moonVelocity[1], moon[2] * moonVelocity[0] - moon[0] * moonVelocity[2], moon[0] * moonVelocity[1] - moon[1] * moonVelocity[0]];
  const nn = Math.hypot(...n0);
  const n: Vec3 = [n0[0] / nn, n0[1] / nn, n0[2] / nn];
  const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const at = (along: number, ahead: number): Vec3 => [0, 1, 2].map((j) => d * (along * u[j] + ahead * v[j])) as Vec3;
  const c = Math.cos(60 * RAD), s = Math.sin(60 * RAD);
  return { L1: at(0.849, 0), L2: at(1.168, 0), L3: at(-1.005, 0), L4: at(c, s), L5: at(c, -s) };
}

export interface RulerItem { key: string; name: string; altitudeKm: number; /** Optional upper end, for ranges. */ toKm?: number; group: "orbit" | "belt" | "moon" | "far"; note: string }

/** What sits how high, for the altitude ruler (altitude above the surface, km). */
export const RULER: readonly RulerItem[] = [
  { key: "iss", name: "国际空间站", altitudeKm: 420, group: "orbit", note: "约 90 分钟绕地球一圈" },
  { key: "hubble", name: "哈勃望远镜", altitudeKm: 540, group: "orbit", note: "近地轨道" },
  { key: "inner", name: "内辐射带", altitudeKm: (1.2 - 1) * EARTH_RADIUS_KM, toKm: (2.5 - 1) * EARTH_RADIUS_KM, group: "belt", note: "高能质子" },
  { key: "glonass", name: "格洛纳斯", altitudeKm: 19_100, group: "orbit", note: "导航卫星 · 中圆轨道" },
  { key: "gps", name: "GPS", altitudeKm: 20_200, group: "orbit", note: "导航卫星 · 中圆轨道" },
  { key: "beidou", name: "北斗", altitudeKm: 21_528, group: "orbit", note: "导航卫星 · 中圆轨道" },
  { key: "outer", name: "外辐射带", altitudeKm: (3 - 1) * EARTH_RADIUS_KM, toKm: (7 - 1) * EARTH_RADIUS_KM, group: "belt", note: "高能电子" },
  { key: "geo", name: "地球同步轨道", altitudeKm: GEO_ALTITUDE_KM, group: "orbit", note: "与地球自转同步，看上去静止" },
  { key: "eml1", name: "地月 L1", altitudeKm: 326_000, group: "moon", note: "地球和月球引力平衡的点之一" },
  { key: "moon", name: "月球", altitudeKm: 384_400, group: "moon", note: "约 1.3 光秒" },
  { key: "eml2", name: "地月 L2", altitudeKm: 448_900, group: "moon", note: "鹊桥中继星在附近" },
  { key: "sel1", name: "日地 L1 · SOHO", altitudeKm: 1_500_000, group: "far", note: "持续看向太阳" },
  { key: "sel2", name: "日地 L2 · 韦布", altitudeKm: 1_500_000, group: "far", note: "背向太阳的冷暗处" },
];

/** Position (0–1) of an altitude on the ruler's log scale from 100 km to 2 million km. */
export function rulerPosition(altitudeKm: number): number {
  const lo = Math.log10(100), hi = Math.log10(2_000_000);
  return Math.min(1, Math.max(0, (Math.log10(Math.max(1, altitudeKm)) - lo) / (hi - lo)));
}

/** "420 km", "3.6 万 km", "38.4 万 km", "150 万 km". */
export function altitudeLabel(km: number, lang: "zh" | "en" = "zh"): string {
  if (lang === "en") return km >= 1_000_000 ? (km / 1e6).toFixed(1) + " million km" : Math.round(km).toLocaleString("en-US") + " km";
  if (km < 10_000) return Math.round(km).toLocaleString("en-US") + " km";
  return (km / 10_000).toFixed(km < 100_000 ? 1 : 0) + " 万 km";
}
