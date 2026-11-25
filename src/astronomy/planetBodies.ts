/**
 * The planets as bodies for the close views: size, rotation (pole and prime
 * meridian from the IAU formulas, through astronomy-engine), a few facts,
 * and the main moons. Positions are J2000 equatorial km, relative to the
 * planet (add the planet's heliocentric position to place them).
 */
import { Body, JupiterMoons, MakeTime, RotationAxis } from "astronomy-engine";
import { AU_KM, type SolarBodyKey, type Vec3 } from "./solarSystem.ts";

export type SphereKey = Exclude<SolarBodyKey, "Earth">;

export interface PlanetFacts {
  /** Equatorial and polar radius, km. */
  radius: number;
  polarRadius: number;
  /** Sidereal rotation, hours (negative: retrograde). */
  dayHours: number;
  /** Known moons (IAU / JPL count, 2025). */
  moons: number;
  /** Map in public/planets/. */
  texture: string;
  /** A ring system in the equator, km from the centre, with its radial profile in public/planets/<texture>.png. */
  ring?: { inner: number; outer: number; texture: string };
}

export const PLANET_FACTS: Record<SphereKey, PlanetFacts> = {
  Mercury: { radius: 2_439.7, polarRadius: 2_439.7, dayHours: 1_407.5, moons: 0, texture: "mercury" },
  Venus: { radius: 6_051.8, polarRadius: 6_051.8, dayHours: -5_832.5, moons: 0, texture: "venus" },
  Mars: { radius: 3_396.2, polarRadius: 3_376.2, dayHours: 24.62, moons: 2, texture: "mars" },
  Jupiter: { radius: 71_492, polarRadius: 66_854, dayHours: 9.93, moons: 97, texture: "jupiter" },
  Saturn: { radius: 60_268, polarRadius: 54_364, dayHours: 10.66, moons: 274, texture: "saturn", ring: { inner: 74_500, outer: 140_220, texture: "saturn-ring" } },
  // Uranus's 13 narrow rings, from the faint ζ ring to ε (scripts/planets/build-uranus-ring.py).
  Uranus: { radius: 25_559, polarRadius: 24_973, dayHours: -17.24, moons: 29, texture: "uranus", ring: { inner: 37_850, outer: 51_300, texture: "uranus-ring" } },
  Neptune: { radius: 24_764, polarRadius: 24_341, dayHours: 16.11, moons: 16, texture: "neptune" },
  // New Horizons' map; the hemisphere it did not see is filled with the surrounding brightness.
  Pluto: { radius: 1_188.3, polarRadius: 1_188.3, dayHours: -153.29, moons: 5, texture: "pluto" },
};

export const hasSphere = (key: SolarBodyKey): key is SphereKey => key in PLANET_FACTS;

/** The Sun's radius, km (the camera stays outside it). */
export const SUN_RADIUS_KM = 696_000;

/** A 3×3 matrix, row-major. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

const rad = (deg: number) => (deg * Math.PI) / 180;
const mul = (a: Mat3, b: Mat3): Mat3 => {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
};
const rotZ = (a: number): Mat3 => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const rotX = (a: number): Mat3 => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
export const apply = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/**
 * The planet's frame: `equator` turns the planet's equatorial frame (x to
 * the node of its equator on the Earth's, z to its north pole) into J2000;
 * `body` adds the rotation, turning body-fixed coordinates (x to the prime
 * meridian) into J2000. IAU: R = Rz(α + 90°) · Rx(90° − δ) · Rz(W).
 */
export function planetFrame(key: SphereKey, time: number): { equator: Mat3; body: Mat3; north: Vec3 } {
  const axis = RotationAxis(Body[key], MakeTime(new Date(time)));
  const equator = mul(rotZ(rad(axis.ra * 15 + 90)), rotX(rad(90 - axis.dec)));
  return { equator, body: mul(equator, rotZ(rad(axis.spin))), north: [axis.north.x, axis.north.y, axis.north.z] };
}

export interface MoonInfo {
  key: string;
  name: string;
  planet: SphereKey;
  /** Mean distance from the planet, km, and period, days (negative: retrograde). */
  distance: number;
  period: number;
  radius: number;
  /** Computed from a theory (Jupiter's four), locked to the planet's rotation (Charon), or a circular orbit in the planet's equator. */
  approximate: boolean;
  /** Global map in public/planets/ (drawn as a sphere, turning with one face to the planet); none: a point. */
  texture?: string;
}

export const MOONS: readonly MoonInfo[] = [
  { key: "phobos", name: "火卫一", planet: "Mars", distance: 9_376, period: 0.3189, radius: 11, approximate: true },
  { key: "deimos", name: "火卫二", planet: "Mars", distance: 23_463, period: 1.2624, radius: 6, approximate: true },
  { key: "io", name: "木卫一", planet: "Jupiter", distance: 421_700, period: 1.769, radius: 1_822, approximate: false, texture: "io" },
  { key: "europa", name: "木卫二", planet: "Jupiter", distance: 671_034, period: 3.551, radius: 1_561, approximate: false, texture: "europa" },
  { key: "ganymede", name: "木卫三", planet: "Jupiter", distance: 1_070_412, period: 7.155, radius: 2_634, approximate: false, texture: "ganymede" },
  { key: "callisto", name: "木卫四", planet: "Jupiter", distance: 1_882_709, period: 16.689, radius: 2_410, approximate: false, texture: "callisto" },
  { key: "titan", name: "土卫六", planet: "Saturn", distance: 1_221_870, period: 15.945, radius: 2_575, approximate: true, texture: "titan" },
  { key: "charon", name: "冥卫一", planet: "Pluto", distance: 19_591, period: 6.3872, radius: 606, approximate: false, texture: "charon" },
  { key: "triton", name: "海卫一", planet: "Neptune", distance: 354_759, period: -5.877, radius: 1_353, approximate: true, texture: "triton" },
];

export const moonsOf = (key: SolarBodyKey) => MOONS.filter((m) => m.planet === key);

/** Moon positions relative to their planet (J2000 km). */
export function moonPositions(key: SphereKey, time: number): { moon: MoonInfo; position: Vec3 }[] {
  const moons = moonsOf(key);
  if (!moons.length) return [];
  if (key === "Jupiter") {
    const j = JupiterMoons(MakeTime(new Date(time)));
    const at = (s: { x: number; y: number; z: number }): Vec3 => [s.x * AU_KM, s.y * AU_KM, s.z * AU_KM];
    const states = { io: j.io, europa: j.europa, ganymede: j.ganymede, callisto: j.callisto } as const;
    return moons.map((moon) => ({ moon, position: at(states[moon.key as keyof typeof states]) }));
  }
  const { equator, body } = planetFrame(key, time);
  const days = (time - Date.UTC(2000, 0, 1, 12)) / 86_400_000;
  return moons.map((moon) => {
    // Pluto and Charon face each other, and Pluto's prime meridian is defined as the
    // one facing Charon (IAU 2009): Charon is on its body frame's x axis.
    if (moon.key === "charon") return { moon, position: apply(body, [moon.distance, 0, 0]) };
    // The phase is not real (circular orbit, arbitrary start): marked approximate.
    const a = (2 * Math.PI * days) / moon.period;
    return { moon, position: apply(equator, [moon.distance * Math.cos(a), moon.distance * Math.sin(a), 0]) };
  });
}

/**
 * A moon's body frame (J2000), for moons that keep one face to their planet:
 * x (its prime meridian) toward the planet, z along its orbit's pole, so that
 * the planet's own longitudes sit where the IAU puts them for these moons.
 */
export function moonFrame(moon: MoonInfo, time: number): Mat3 {
  const at = (t: number) => moonPositions(moon.planet, t).find((m) => m.moon.key === moon.key)!.position;
  const r = at(time), r2 = at(time + 60_000);
  const v: Vec3 = [r2[0] - r[0], r2[1] - r[1], r2[2] - r[2]];
  const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const x = norm([-r[0], -r[1], -r[2]]);
  const z = norm(cross(r, v));
  const y = cross(z, x);
  // Columns x, y, z: body-fixed coordinates into J2000.
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

/** How far from a moon's centre the camera stops for a close look at it, km. */
export const moonViewDistanceKm = (moon: MoonInfo) => moon.radius * 6.5;

/**
 * Where to put the camera for a close look at a planet: far enough for the
 * whole disc (and the rings), from above its day side.
 */
export function closeViewDistanceKm(key: SphereKey): number {
  const facts = PLANET_FACTS[key];
  return (facts.ring ? facts.ring.outer * 4.2 : facts.radius * 9);
}
