/**
 * Solar and lunar eclipses, computed in the browser with astronomy-engine
 * (MIT): the list of eclipses in a range, and for a solar eclipse the Moon's
 * shadow on the Earth at any moment — the umbra (total) or antumbra
 * (annular) footprint, the penumbra (partial) footprint, and the track of the
 * central path with its northern and southern limits.
 *
 * The geometry: the shadow axis runs from the Sun through the Moon. Points on
 * the shadow cone's edge, taken in the plane through the Moon perpendicular
 * to the axis, are carried along the cone onto the WGS84 ellipsoid. Vectors
 * are in the equator-of-date frame, where the Earth's axis is z, and
 * astronomy-engine turns surface points into latitude and longitude
 * (VectorObserver), handling Earth rotation, precession and ΔT.
 *
 * Accuracy is a few kilometres on the central line — the limb profile of the
 * Moon is ignored — which is far below what the globe can show.
 */
import {
  AstroTime, Body, GeoVector, MakeTime, NextGlobalSolarEclipse, NextLunarEclipse, RotateVector, Rotation_EQJ_EQD,
  SearchGlobalSolarEclipse, SearchLunarEclipse, SiderealTime, Vector, VectorObserver,
} from "astronomy-engine";

export const KM_PER_AU = 149_597_870.7;
/** Equatorial and polar radii of the WGS84 ellipsoid, km. */
const EARTH_A = 6378.137, EARTH_B = 6356.752;
/** Mean lunar radius for eclipse shadows (IAU k = 0.2725076 × 6378.137 km). */
const MOON_RADIUS = 1738.09;
const SUN_RADIUS = 696_000;

export type SolarKind = "total" | "annular" | "hybrid" | "partial";
export type LunarKind = "total" | "partial" | "penumbral";

export interface SolarEclipse {
  type: "solar";
  id: string;
  kind: SolarKind;
  /** Moment of greatest eclipse. */
  peak: number;
  /** Where the eclipse is greatest (on the central line for central eclipses). */
  latitude: number | null;
  longitude: number | null;
  /** Fraction of the Sun's disc covered at greatest eclipse (central eclipses). */
  obscuration: number | null;
}

export interface LunarEclipse {
  type: "lunar";
  id: string;
  kind: LunarKind;
  peak: number;
  /** Half-durations of the penumbral, partial and total phases, in minutes (0 when absent). */
  semiDuration: { penumbral: number; partial: number; total: number };
}

export type Eclipse = SolarEclipse | LunarEclipse;

const date = (time: AstroTime) => time.date.getTime();

/** Every solar and lunar eclipse whose greatest moment is in [from, to), in order. */
export function listEclipses(from: number, to: number): Eclipse[] {
  const found: Eclipse[] = [];
  for (let e = SearchGlobalSolarEclipse(MakeTime(new Date(from))); date(e.peak) < to; e = NextGlobalSolarEclipse(e.peak)) {
    found.push({
      type: "solar", id: "solar:" + new Date(date(e.peak)).toISOString().slice(0, 10), kind: e.kind as SolarKind, peak: date(e.peak),
      latitude: e.kind === "partial" ? null : e.latitude ?? null, longitude: e.kind === "partial" ? null : e.longitude ?? null,
      obscuration: e.obscuration ?? null,
    });
  }
  for (let e = SearchLunarEclipse(MakeTime(new Date(from))); date(e.peak) < to; e = NextLunarEclipse(e.peak)) {
    found.push({
      type: "lunar", id: "lunar:" + new Date(date(e.peak)).toISOString().slice(0, 10), kind: e.kind as LunarKind, peak: date(e.peak),
      semiDuration: { penumbral: e.sd_penum, partial: e.sd_partial, total: e.sd_total },
    });
  }
  return found.sort((a, b) => a.peak - b.peak);
}

export interface GeoPoint { latitude: number; longitude: number }

type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec) => Math.sqrt(dot(a, a));
const unit = (a: Vec) => scale(a, 1 / norm(a));

/** Geocentric Sun and Moon, km, equator of date. */
function bodies(time: AstroTime): { sun: Vec; moon: Vec } {
  const rotation = Rotation_EQJ_EQD(time);
  const toKm = (body: Body): Vec => {
    const v = RotateVector(rotation, GeoVector(body, time, true));
    return [v.x * KM_PER_AU, v.y * KM_PER_AU, v.z * KM_PER_AU];
  };
  return { sun: toKm(Body.Sun), moon: toKm(Body.Moon) };
}

/** First intersection of the ray origin + s·direction (s > 0) with the ellipsoid, or null. */
function hitEarth(origin: Vec, direction: Vec): Vec | null {
  // Scale z so the ellipsoid becomes a sphere of radius EARTH_A.
  const k = EARTH_A / EARTH_B;
  const o: Vec = [origin[0], origin[1], origin[2] * k], d: Vec = [direction[0], direction[1], direction[2] * k];
  const a = dot(d, d), b = 2 * dot(o, d), c = dot(o, o) - EARTH_A * EARTH_A;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = (-b - Math.sqrt(disc)) / (2 * a);
  if (s <= 0) return null;
  return add(origin, scale(direction, s));
}

function geographic(point: Vec, time: AstroTime): GeoPoint {
  const observer = VectorObserver(new Vector(point[0] / KM_PER_AU, point[1] / KM_PER_AU, point[2] / KM_PER_AU, time), true);
  return { latitude: observer.latitude, longitude: ((observer.longitude + 540) % 360) - 180 };
}

export interface ShadowAt {
  /** Where the shadow axis meets the Earth (the central line), if it does. */
  center: GeoPoint | null;
  /**
   * The umbra (total) or antumbra (annular) footprint on the ground; empty
   * when it misses the Earth. Points are in order around the outline.
   */
  umbra: GeoPoint[];
  /** "total" when the umbral cone reaches the ground there, else "annular". */
  centralKind: "total" | "annular" | null;
  /** Outline of the penumbra (partial eclipse), clipped to where it falls on the Earth. */
  penumbra: GeoPoint[];
}

const OUTLINE_POINTS = 48;

/** The Moon's shadow on the Earth at `time` (ms). */
export function shadowAt(time: number): ShadowAt {
  const t = MakeTime(new Date(time));
  const { sun, moon } = bodies(t);
  const axis = unit(sub(moon, sun));
  const sunMoon = norm(sub(moon, sun));
  // Two directions spanning the plane perpendicular to the axis.
  const u = unit(cross(axis, Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const v = cross(axis, u);
  // Cone half-angles: the umbral cone narrows behind the Moon, the penumbral one widens.
  const umbraTan = (SUN_RADIUS - MOON_RADIUS) / sunMoon;
  const penumbraTan = (SUN_RADIUS + MOON_RADIUS) / sunMoon;

  const centerHit = hitEarth(moon, axis);
  // Along the axis from the Moon to the ground (or to the closest approach to the Earth's centre).
  const along = centerHit ? norm(sub(centerHit, moon)) : -dot(moon, axis);
  const umbraRadius = MOON_RADIUS - along * umbraTan;
  const centralKind = centerHit ? (umbraRadius > 0 ? "total" : "annular") : null;

  // A point on a cone's edge leaves the Moon's limb at angle θ and runs at the cone's slope.
  const coneOutline = (tanAngle: number, sign: 1 | -1, limbRadius: number): GeoPoint[] => {
    const points: GeoPoint[] = [];
    for (let i = 0; i < OUTLINE_POINTS; i++) {
      const theta = (2 * Math.PI * i) / OUTLINE_POINTS;
      const radial = add(scale(u, Math.cos(theta)), scale(v, Math.sin(theta)));
      const start = add(moon, scale(radial, limbRadius));
      const direction = unit(add(axis, scale(radial, sign * tanAngle)));
      const hit = hitEarth(start, direction);
      if (hit) points.push(geographic(hit, t));
    }
    return points;
  };

  // The umbral cone converges (sign -1); past its apex it becomes the antumbra, which diverges.
  const umbra = centerHit ? coneOutline(umbraTan, -1, MOON_RADIUS) : [];
  const penumbra = coneOutline(penumbraTan, 1, MOON_RADIUS);
  return { center: centerHit ? geographic(centerHit, t) : null, umbra, centralKind, penumbra };
}

const wrap = (degrees: number) => ((degrees + 540) % 360) - 180;

/** Great-circle distance, km. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const r = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * r / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin((b.longitude - a.longitude) * r / 2) ** 2;
  return 2 * 6371.0 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface EclipseTrack {
  /** First and last moments the penumbra touches the Earth. */
  partialStart: number;
  partialEnd: number;
  /** First and last moments the shadow axis meets the Earth (central eclipses). */
  centralStart: number | null;
  centralEnd: number | null;
  /** Central line, and the northern and southern limits of the total/annular path. */
  center: GeoPoint[];
  northLimit: GeoPoint[];
  southLimit: GeoPoint[];
}

const MINUTE = 60_000;

/** The whole eclipse, sampled every `stepMinutes` (2 by default). */
export function solarEclipseTrack(eclipse: SolarEclipse, stepMinutes = 2): EclipseTrack {
  // An eclipse lasts at most about six hours from first to last penumbral contact.
  const from = eclipse.peak - 4 * 60 * MINUTE, to = eclipse.peak + 4 * 60 * MINUTE;
  let partialStart = Number.NaN, partialEnd = Number.NaN;
  let centralStart: number | null = null, centralEnd: number | null = null;
  const samples: { center: GeoPoint; umbra: GeoPoint[] }[] = [];
  for (let time = from; time <= to; time += stepMinutes * MINUTE) {
    const shadow = shadowAt(time);
    if (shadow.penumbra.length) {
      if (Number.isNaN(partialStart)) partialStart = time;
      partialEnd = time;
    }
    if (!shadow.center) continue;
    centralStart ??= time;
    centralEnd = time;
    samples.push({ center: shadow.center, umbra: shadow.umbra });
  }
  const center = samples.map((s) => s.center);
  const northLimit: GeoPoint[] = [], southLimit: GeoPoint[] = [];
  samples.forEach((sample, i) => {
    if (sample.umbra.length < 3 || samples.length < 2) return;
    // The footprint's points furthest to the left and right of the direction of travel bound the path.
    const before = samples[Math.max(0, i - 1)].center, after = samples[Math.min(samples.length - 1, i + 1)].center;
    const east = Math.cos(sample.center.latitude * Math.PI / 180);
    const travel = [wrap(after.longitude - before.longitude) * east, after.latitude - before.latitude];
    const side = (p: GeoPoint) => travel[0] * (p.latitude - sample.center.latitude) - travel[1] * wrap(p.longitude - sample.center.longitude) * east;
    let left = sample.umbra[0], right = sample.umbra[0];
    for (const p of sample.umbra) {
      if (side(p) > side(left)) left = p;
      if (side(p) < side(right)) right = p;
    }
    // "Left" of eastward travel is north.
    const leftIsNorth = travel[0] >= 0;
    northLimit.push(leftIsNorth ? left : right);
    southLimit.push(leftIsNorth ? right : left);
  });
  return { partialStart, partialEnd, centralStart, centralEnd, center, northLimit, southLimit };
}

/** Where the Moon is overhead at a moment (for lunar eclipses: the centre of the side that sees it). */
export function sublunarPoint(time: number): GeoPoint {
  const t = MakeTime(new Date(time));
  const { moon } = bodies(t);
  // The point on the surface straight below the Moon (direction from the centre).
  return geographic(scale(unit(moon), EARTH_A), t);
}

/** Geodetic latitude/longitude (degrees) to a surface point in the equator-of-date frame, km. */
function surfacePoint(latitude: number, longitude: number, siderealDegrees: number): Vec {
  const r = Math.PI / 180, e2 = 1 - (EARTH_B * EARTH_B) / (EARTH_A * EARTH_A);
  const lat = latitude * r, lon = (longitude + siderealDegrees) * r;
  const n = EARTH_A / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [n * Math.cos(lat) * Math.cos(lon), n * Math.cos(lat) * Math.sin(lon), n * (1 - e2) * Math.sin(lat)];
}

/** Fraction of a disc of angular radius `a` covered by one of radius `b` whose centre is `d` away (radians). */
export function discOverlap(a: number, b: number, d: number): number {
  if (d >= a + b) return 0;
  if (d <= Math.abs(a - b)) return b >= a ? 1 : (b * b) / (a * a);
  const a2 = a * a, b2 = b * b;
  const alpha = Math.acos((d * d + a2 - b2) / (2 * d * a)), beta = Math.acos((d * d + b2 - a2) / (2 * d * b));
  const area = a2 * (alpha - Math.sin(2 * alpha) / 2) + b2 * (beta - Math.sin(2 * beta) / 2);
  return area / (Math.PI * a2);
}

export interface ObscurationGrid { width: number; height: number; values: Float32Array; max: number }

/**
 * Fraction of the Sun's disc hidden by the Moon, seen from each cell of a
 * latitude/longitude grid (row 0 at 90°N, column 0 at 180°W, cell centres),
 * 0 where the Sun is below the horizon.
 */
export function obscurationGrid(time: number, width = 180, height = 90): ObscurationGrid {
  const t = MakeTime(new Date(time));
  const { sun, moon } = bodies(t);
  const sidereal = SiderealTime(t) * 15;
  const values = new Float32Array(width * height);
  let max = 0;
  for (let y = 0; y < height; y++) {
    const latitude = 90 - (y + 0.5) * (180 / height);
    for (let x = 0; x < width; x++) {
      const longitude = -180 + (x + 0.5) * (360 / width);
      const here = surfacePoint(latitude, longitude, sidereal);
      const toSun = sub(sun, here), toMoon = sub(moon, here);
      // Sun above the (spherical) horizon.
      if (dot(toSun, here) <= 0) continue;
      const ds = norm(toSun), dm = norm(toMoon);
      const separation = Math.acos(Math.min(1, Math.max(-1, dot(toSun, toMoon) / (ds * dm))));
      const value = discOverlap(Math.asin(SUN_RADIUS / ds), Math.asin(MOON_RADIUS / dm), separation);
      values[y * width + x] = value;
      if (value > max) max = value;
    }
  }
  return { width, height, values, max };
}

/** Fraction of the Sun hidden at one place and moment (0 when the Sun is down). */
export function obscurationAt(time: number, latitude: number, longitude: number): number {
  const t = MakeTime(new Date(time));
  const { sun, moon } = bodies(t);
  const here = surfacePoint(latitude, longitude, SiderealTime(t) * 15);
  const toSun = sub(sun, here), toMoon = sub(moon, here);
  if (dot(toSun, here) <= 0) return 0;
  const ds = norm(toSun), dm = norm(toMoon);
  return discOverlap(Math.asin(SUN_RADIUS / ds), Math.asin(MOON_RADIUS / dm), Math.acos(Math.min(1, dot(toSun, toMoon) / (ds * dm))));
}
