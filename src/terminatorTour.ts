import { subsolarPoint } from "./solar.ts";

export type TerminatorSide = "sunrise" | "sunset";
/** Geographic horizon, Sun centre at 0°; excludes refraction, relief and solar disc radius. */
export function terminatorPosition(
  time: number,
  phase: number,
  side: TerminatorSide,
) {
  const sun = subsolarPoint(new Date(time)),
    d = Math.PI / 180;
  const lat = sun.latitude * d,
    lon = sun.longitude * d;
  // Both orthonormal vectors lie in the plane perpendicular to the Sun.
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [
    -Math.sin(lat) * Math.cos(lon),
    -Math.sin(lat) * Math.sin(lon),
    Math.cos(lat),
  ];
  // Each side is a semicircle. Ease back and forth without jumping across the poles.
  const angle = (Math.PI / 2 - 0.035) * Math.sin(phase);
  const e = (side === "sunrise" ? -1 : 1) * Math.cos(angle),
    n = Math.sin(angle);
  const p = east.map((v, i) => v * e + north[i] * n);
  return {
    latitude: Math.asin(Math.max(-1, Math.min(1, p[2]))) / d,
    longitude: Math.atan2(p[1], p[0]) / d,
  };
}
export function localSolarTime(time: number, longitude: number) {
  return new Date(time + longitude * 240_000).toISOString().slice(11, 16);
}
