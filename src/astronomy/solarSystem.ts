/**
 * The solar system around the globe: where the planets and Pluto are and
 * their orbits, computed with astronomy-engine (heliocentric vectors in the
 * J2000 equatorial frame, which is the ICRF to well within what can be drawn).
 * Positions are returned Earth-centred in km, the frame the globe lives in.
 */
import { Body, Elongation, HelioVector, Illumination, MakeTime } from "astronomy-engine";

export const AU_KM = 149_597_870.7;
/** Obliquity of the ecliptic (J2000), for drawing belts in the ecliptic plane. */
const OBLIQUITY = (23.4392911 * Math.PI) / 180;

export type SolarBodyKey = "Mercury" | "Venus" | "Earth" | "Mars" | "Jupiter" | "Saturn" | "Uranus" | "Neptune" | "Pluto";
export type Vec3 = [number, number, number];

export interface PlanetInfo { key: SolarBodyKey; name: string; color: string; /** Orbital period, days. */ period: number; size: number }
export const SOLAR_PLANETS: readonly PlanetInfo[] = [
  { key: "Mercury", name: "水星", color: "#b9b2a6", period: 87.97, size: 6 },
  { key: "Venus", name: "金星", color: "#f4d8a0", period: 224.7, size: 7 },
  { key: "Earth", name: "地球", color: "#6fb6ff", period: 365.256, size: 7 },
  { key: "Mars", name: "火星", color: "#ff7a50", period: 686.98, size: 6 },
  { key: "Jupiter", name: "木星", color: "#e8c39a", period: 4_332.6, size: 10 },
  { key: "Saturn", name: "土星", color: "#f2dc9b", period: 10_759, size: 9 },
  { key: "Uranus", name: "天王星", color: "#9fe6ee", period: 30_687, size: 8 },
  { key: "Neptune", name: "海王星", color: "#6b8cff", period: 60_190, size: 8 },
  { key: "Pluto", name: "冥王星（矮行星）", color: "#c8b6a6", period: 90_560, size: 5 },
];

const km = (v: { x: number; y: number; z: number }): Vec3 => [v.x * AU_KM, v.y * AU_KM, v.z * AU_KM];

/** Heliocentric position of a body, km (J2000 equatorial). */
export function helio(key: SolarBodyKey, time: number): Vec3 {
  return km(HelioVector(Body[key], MakeTime(new Date(time))));
}

/** The Sun's position seen from the Earth's centre, km. */
export function sunFromEarth(time: number): Vec3 {
  const e = helio("Earth", time);
  return [-e[0], -e[1], -e[2]];
}

/** Earth-centred position of a planet at `time`, km. */
export function fromEarth(key: SolarBodyKey, time: number): Vec3 {
  const p = helio(key, time), e = helio("Earth", time);
  return [p[0] - e[0], p[1] - e[1], p[2] - e[2]];
}

/**
 * One full orbit, heliocentric (km), sampled from `time` over a period. The
 * ellipse is fixed relative to the Sun; shift it by the Sun's Earth-centred
 * position to draw it around the globe.
 */
export function orbit(key: SolarBodyKey, time: number, steps = 360): Vec3[] {
  const period = SOLAR_PLANETS.find((p) => p.key === key)!.period * 86_400_000;
  return Array.from({ length: steps + 1 }, (_, i) => helio(key, time + (period * i) / steps));
}

/** A circle of `radiusAu` around the Sun in the ecliptic plane (heliocentric km). */
export function eclipticRing(radiusAu: number, steps = 240): Vec3[] {
  const r = radiusAu * AU_KM;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (2 * Math.PI * i) / steps;
    return [r * Math.cos(a), r * Math.sin(a) * Math.cos(OBLIQUITY), r * Math.sin(a) * Math.sin(OBLIQUITY)] as Vec3;
  });
}

/** The ecliptic's north pole as a unit vector (J2000 equatorial). */
export const ECLIPTIC_NORTH: Vec3 = [0, -Math.sin(OBLIQUITY), Math.cos(OBLIQUITY)];

export const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

export interface PlanetNow {
  key: SolarBodyKey;
  sunKm: number;
  earthKm: number;
  /** Angle from the Sun as seen from the Earth (degrees) and when it is seen. */
  elongation: number;
  visibility: "morning" | "evening" | "night" | "hidden";
  magnitude: number;
}

/** Where each planet is relative to the Sun and the Earth, and when it can be seen. */
export function planetsNow(time: number): PlanetNow[] {
  const t = MakeTime(new Date(time));
  return SOLAR_PLANETS.filter((p) => p.key !== "Earth").map(({ key }) => {
    const e = Elongation(Body[key], t);
    // Too close to the Sun to see; near opposition it is up all night.
    const visibility = e.elongation < 15 ? "hidden" : e.elongation > 135 ? "night" : (e.visibility as "morning" | "evening");
    return { key, sunKm: length(helio(key, time)), earthKm: length(fromEarth(key, time)), elongation: e.elongation, visibility, magnitude: Illumination(Body[key], t).mag };
  });
}

/** Belts drawn as faint rings: the main asteroid belt and the Kuiper belt (AU). */
export const BELT_RINGS = [
  { key: "asteroids", name: "小行星带", from: 2.2, to: 3.2, color: "#b8a88a" },
  { key: "kuiper", name: "柯伊伯带", from: 30, to: 50, color: "#8fa7c9" },
] as const;
