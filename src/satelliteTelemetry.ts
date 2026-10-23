/**
 * Live readouts for a tracked satellite: sub-satellite point, altitude,
 * speed, ground-track heading, sunlight and orbital period, plus where it is
 * in the sky from an observer. SGP4 from CelesTrak elements; Cesium-free.
 */
import { degreesToRadians, ecfToLookAngles, eciToEcf, eciToGeodetic, geodeticToEcf, gstime, propagate } from "satellite.js";
import type { OrbitRecord } from "./satelliteOrbits.ts";
import { subsolarPoint } from "./solar.ts";

export interface Observer {
  latitude: number;
  longitude: number;
  heightKm?: number;
}

export interface LookAngles {
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Degrees above the horizon (negative: below it). */
  elevation: number;
  rangeKm: number;
}

export interface Telemetry {
  time: Date;
  latitude: number;
  longitude: number;
  altitudeKm: number;
  /** Inertial speed. */
  speedKmS: number;
  /** Direction of the ground track, degrees clockwise from north. */
  headingDeg: number;
  sunlit: boolean;
  periodMin: number;
  look: LookAngles | null;
}

const EARTH_RADIUS_KM = 6371;
const RAD = 180 / Math.PI;
type Vec3 = { x: number; y: number; z: number };

/** Cylindrical Earth-shadow test in Earth-fixed coordinates (km). */
export function inSunlight(ecf: Vec3, time: Date): boolean {
  const sun = subsolarPoint(time);
  const lat = sun.latitude / RAD;
  const lon = sun.longitude / RAD;
  const s = { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) };
  const along = ecf.x * s.x + ecf.y * s.y + ecf.z * s.z;
  if (along > 0) return true;
  return Math.hypot(ecf.x - along * s.x, ecf.y - along * s.y, ecf.z - along * s.z) > EARTH_RADIUS_KM;
}

export function lookAngles(observer: Observer, ecf: Vec3): LookAngles {
  const look = ecfToLookAngles({
    latitude: degreesToRadians(observer.latitude),
    longitude: degreesToRadians(observer.longitude),
    height: observer.heightKm ?? 0,
  }, ecf);
  return { azimuth: ((look.azimuth * RAD) % 360 + 360) % 360, elevation: look.elevation * RAD, rangeKm: look.rangeSat };
}

/** Earth-fixed position (km) at `time`, or null if SGP4 fails. */
export function ecfAt(record: OrbitRecord, time: Date): { ecf: Vec3; eci: Vec3; velocity: Vec3 | null } | null {
  const result = propagate(record.satrec, time);
  const eci = result?.position;
  if (!eci || typeof eci !== "object" || ![eci.x, eci.y, eci.z].every(Number.isFinite)) return null;
  const velocity = result.velocity && typeof result.velocity === "object" ? result.velocity : null;
  return { ecf: eciToEcf(eci, gstime(time)), eci, velocity };
}

/** Initial great-circle bearing from one point to another, degrees. */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 / RAD;
  const φ2 = lat2 / RAD;
  const Δλ = (lon2 - lon1) / RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * RAD) % 360 + 360) % 360;
}

export function telemetryAt(record: OrbitRecord, time: Date, observer: Observer | null = null): Telemetry | null {
  const now = ecfAt(record, time);
  if (!now) return null;
  const here = eciToGeodetic(now.eci, gstime(time));
  const later = new Date(time.getTime() + 10_000);
  const next = ecfAt(record, later);
  const there = next ? eciToGeodetic(next.eci, gstime(later)) : null;
  const latitude = here.latitude * RAD;
  const longitude = here.longitude * RAD;
  const v = now.velocity;
  return {
    time,
    latitude,
    longitude,
    altitudeKm: here.height,
    speedKmS: v ? Math.hypot(v.x, v.y, v.z) : Number.NaN,
    headingDeg: there ? bearing(latitude, longitude, there.latitude * RAD, there.longitude * RAD) : Number.NaN,
    sunlit: inSunlight(now.ecf, time),
    // satrec.no: mean motion in radians per minute.
    periodMin: (2 * Math.PI) / record.satrec.no,
    look: observer ? lookAngles(observer, now.ecf) : null,
  };
}

/**
 * Every intermediate value behind the readouts, for showing the working:
 * the same SGP4 state, frames and formulas as telemetryAt, step by step.
 */
export interface Derivation {
  time: Date;
  /** SGP4 state in the inertial (TEME) frame, km and km/s. */
  eci: Vec3;
  velocity: Vec3;
  /** Greenwich sidereal angle (radians) and the Earth-fixed position, km. */
  gmst: number;
  ecf: Vec3;
  geodetic: { latitude: number; longitude: number; altitudeKm: number };
  speedKmS: number;
  /** Mean motion, radians per minute, and the period it gives. */
  meanMotion: number;
  periodMin: number;
  /** Sub-satellite points now and 10 s later (degrees), and the bearing between them. */
  heading: { lat1: number; lon1: number; lat2: number; lon2: number; deg: number };
  /** Cylindrical shadow test: Sun unit vector, distance along it, distance off its axis (km). */
  shadow: { sun: Vec3; along: number; offAxis: number; sunlit: boolean };
  /** From the observer: station position, east/north/up components (km), and the angles. */
  look: { station: Vec3; east: number; north: number; up: number; rangeKm: number; azimuth: number; elevation: number } | null;
}

export function derivationAt(record: OrbitRecord, time: Date, observer: Observer | null = null): Derivation | null {
  const now = ecfAt(record, time);
  if (!now || !now.velocity) return null;
  const gmst = gstime(time);
  const here = eciToGeodetic(now.eci, gmst);
  const later = new Date(time.getTime() + 10_000);
  const next = ecfAt(record, later);
  const there = next ? eciToGeodetic(next.eci, gstime(later)) : null;
  const lat1 = here.latitude * RAD, lon1 = here.longitude * RAD;
  const lat2 = there ? there.latitude * RAD : Number.NaN, lon2 = there ? there.longitude * RAD : Number.NaN;
  const sun = subsolarPoint(time);
  const sLat = sun.latitude / RAD, sLon = sun.longitude / RAD;
  const s = { x: Math.cos(sLat) * Math.cos(sLon), y: Math.cos(sLat) * Math.sin(sLon), z: Math.sin(sLat) };
  const r = now.ecf;
  const along = r.x * s.x + r.y * s.y + r.z * s.z;
  const offAxis = Math.hypot(r.x - along * s.x, r.y - along * s.y, r.z - along * s.z);
  let look: Derivation["look"] = null;
  if (observer) {
    const φ = degreesToRadians(observer.latitude), λ = degreesToRadians(observer.longitude);
    const station = geodeticToEcf({ latitude: φ, longitude: λ, height: observer.heightKm ?? 0 });
    const d = { x: r.x - station.x, y: r.y - station.y, z: r.z - station.z };
    const east = -Math.sin(λ) * d.x + Math.cos(λ) * d.y;
    const north = -Math.sin(φ) * Math.cos(λ) * d.x - Math.sin(φ) * Math.sin(λ) * d.y + Math.cos(φ) * d.z;
    const up = Math.cos(φ) * Math.cos(λ) * d.x + Math.cos(φ) * Math.sin(λ) * d.y + Math.sin(φ) * d.z;
    const rangeKm = Math.hypot(east, north, up);
    look = { station, east, north, up, rangeKm, azimuth: ((Math.atan2(east, north) * RAD) % 360 + 360) % 360, elevation: Math.asin(up / rangeKm) * RAD };
  }
  const v = now.velocity;
  return {
    time, eci: now.eci, velocity: v, gmst, ecf: r,
    geodetic: { latitude: lat1, longitude: lon1, altitudeKm: here.height },
    speedKmS: Math.hypot(v.x, v.y, v.z),
    meanMotion: record.satrec.no,
    periodMin: (2 * Math.PI) / record.satrec.no,
    heading: { lat1, lon1, lat2, lon2, deg: there ? bearing(lat1, lon1, lat2, lon2) : Number.NaN },
    shadow: { sun: s, along, offAxis, sunlit: along > 0 || offAxis > EARTH_RADIUS_KM },
    look,
  };
}
