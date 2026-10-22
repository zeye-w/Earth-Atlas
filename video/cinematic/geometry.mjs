/**
 * Geometry shared by the plan, the camera paths and the tests: vectors,
 * WGS84 (the same ellipsoid Cesium uses), the Sun's direction, SGP4 positions
 * of a satellite from CelesTrak elements, and smooth interpolation.
 */
import { json2satrec, propagate } from "satellite.js";
import { positionAt } from "../../src/satelliteOrbits.ts";
import { solarElevation, subsolarPoint } from "../../src/solar.ts";
import { inSunlight } from "../../src/satelliteTelemetry.ts";

export const RE = 6_371_000;
const A = 6_378_137, E2 = 0.00669437999014;
export const rad = (d) => (d * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => mul(a, 1 / norm(a));
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp01 = (t) => Math.max(0, Math.min(1, t));
export const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
/** Smoother start and end than smoothstep (zero acceleration at both ends). */
export const smootherstep = (t) => { t = clamp01(t); return t * t * t * (t * (6 * t - 15) + 10); };

/** WGS84 geodetic (degrees, metres) to Earth-fixed metres, as Cesium.Cartesian3.fromDegrees. */
export function geo(lon, lat, h = 0) {
  const φ = rad(lat), λ = rad(lon);
  const n = A / Math.sqrt(1 - E2 * Math.sin(φ) ** 2);
  return [(n + h) * Math.cos(φ) * Math.cos(λ), (n + h) * Math.cos(φ) * Math.sin(λ), (n * (1 - E2) + h) * Math.sin(φ)];
}

/** Approximate geodetic coordinates of an Earth-fixed point (for HUD read-outs). */
export function toGeo(p) {
  const r = norm(p);
  const lon = deg(Math.atan2(p[1], p[0]));
  // Bowring's single iteration is ample for display.
  const ρ = Math.hypot(p[0], p[1]);
  const b = A * Math.sqrt(1 - E2);
  const ep2 = E2 / (1 - E2);
  const θ = Math.atan2(p[2] * A, ρ * b);
  const φ = Math.atan2(p[2] + ep2 * b * Math.sin(θ) ** 3, ρ - E2 * A * Math.cos(θ) ** 3);
  const n = A / Math.sqrt(1 - E2 * Math.sin(φ) ** 2);
  const h = Math.abs(φ) < rad(89) ? ρ / Math.cos(φ) - n : r - b;
  return { lon, lat: deg(φ), h };
}

/** Unit vector from the Earth's centre toward the Sun at a moment. */
export function sunDirection(time) {
  const s = subsolarPoint(new Date(time));
  return unit(geo(s.longitude, s.latitude, 0));
}

export function sunElevationAt(lon, lat, time) {
  return solarElevation(lat, lon, subsolarPoint(new Date(time)));
}

/** A satellite from one CelesTrak OMM record. */
export function satelliteFromOmm(omm) {
  const satrec = json2satrec(omm);
  const record = { satrec, epoch: new Date(omm.EPOCH + (/Z$/.test(omm.EPOCH) ? "" : "Z")), choice: { id: String(omm.NORAD_CAT_ID) } };
  const at = (time) => {
    const p = positionAt(record, new Date(time));
    return p ? geo(deg(p.longitudeRad), deg(p.latitudeRad), p.altitudeKm * 1000) : null;
  };
  return {
    name: omm.OBJECT_NAME,
    at,
    /** Inertial speed (m/s), the figure usually quoted for an orbit. */
    inertialSpeed: (time) => {
      const v = propagate(satrec, new Date(time))?.velocity;
      return v && typeof v === "object" ? Math.hypot(v.x, v.y, v.z) * 1000 : null;
    },
    sunlit: (time) => { const p = at(time); return p ? inSunlight({ x: p[0] / 1000, y: p[1] / 1000, z: p[2] / 1000 }, new Date(time)) : false; },
    /** Orbit frame at a moment: x along the velocity, z away from the Earth, y = z × x. */
    frame: (time) => {
      const here = at(time), ahead = at(time + 1000);
      if (!here || !ahead) return null;
      const z = unit(here);
      const v = sub(ahead, here);
      const x = unit(sub(v, mul(z, dot(v, z))));
      return { origin: here, x, y: cross(z, x), z, speed: norm(v) };
    },
  };
}

export const inFrame = (f, o) => add(f.origin, add(add(mul(f.x, o[0]), mul(f.y, o[1])), mul(f.z, o[2])));

/** Great-circle surface distance (m) between two Earth-fixed points. */
export const surfaceDistance = (a, b) => RE * Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b)))));

/** Spherical interpolation between two directions. */
export function slerp(a, b, t) {
  const ua = unit(a), ub = unit(b);
  const d = Math.max(-1, Math.min(1, dot(ua, ub)));
  if (d > 0.99999) return unit(lerp3(ua, ub, t));
  const θ = Math.acos(d), s = Math.sin(θ);
  return add(mul(ua, Math.sin((1 - t) * θ) / s), mul(ub, Math.sin(t * θ) / s));
}

/**
 * Monotone cubic (Fritsch–Carlson) through keyframes: smooth velocity across
 * keys, no overshoot, so the camera never stops at an intermediate key.
 * keys: [{t, v}] with increasing t. Returns v(t), clamped at the ends.
 */
export function monotone(keys) {
  const n = keys.length;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((keys[i + 1].v - keys[i].v) / (keys[i + 1].t - keys[i].t));
  const m = keys.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  // Start and end at rest so a take eases in and out.
  m[0] = 0; m[n - 1] = 0;
  return (t) => {
    if (t <= keys[0].t) return keys[0].v;
    if (t >= keys[n - 1].t) return keys[n - 1].v;
    let i = 0;
    while (t > keys[i + 1].t) i++;
    const h = keys[i + 1].t - keys[i].t, s = (t - keys[i].t) / h;
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
    return h00 * keys[i].v + h10 * h * m[i] + h01 * keys[i + 1].v + h11 * h * m[i + 1];
  };
}

/** Monotone interpolation of each component of a vector-valued key list. */
export function monotone3(keys) {
  const f = [0, 1, 2].map((c) => monotone(keys.map((k) => ({ t: k.t, v: k.v[c] }))));
  return (t) => [f[0](t), f[1](t), f[2](t)];
}

/** Camera orientation looking from `position` toward `target`, level with the local horizon. */
export function lookAt(position, target, upHint = unit(position)) {
  const direction = unit(sub(target, position));
  let up = sub(upHint, mul(direction, dot(upHint, direction)));
  if (norm(up) < 1e-6) up = sub([0, 0, 1], mul(direction, direction[2]));
  return { position, direction, up: unit(up) };
}
