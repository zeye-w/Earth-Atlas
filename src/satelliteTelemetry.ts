/**
 * Live readouts for a tracked satellite: sub-satellite point, altitude,
 * speed, ground-track heading, sunlight and orbital period, plus where it is
 * in the sky from an observer. SGP4 from CelesTrak elements; Cesium-free.
 */
import { degreesToRadians, ecfToLookAngles, eciToEcf, eciToGeodetic, gstime, propagate } from "satellite.js";
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
