import assert from "node:assert/strict";
import { test } from "node:test";
import { json2satrec } from "satellite.js";
import { positionAt } from "../src/satelliteOrbits.ts";
import { bearing, derivationAt, telemetryAt } from "../src/satelliteTelemetry.ts";

// Public satellite.js documentation OMM HELIOS 2A record (historical test fixture).
const omm = {
  OBJECT_NAME: "HELIOS 2A", OBJECT_ID: "2004-049A", EPOCH: "2025-03-26T05:19:34.116960",
  MEAN_MOTION: 15.00555103, ECCENTRICITY: 0.000583, INCLINATION: 98.3164, RA_OF_ASC_NODE: 103.8411,
  ARG_OF_PERICENTER: 20.5667, MEAN_ANOMALY: 339.5789, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U",
  NORAD_CAT_ID: 28492, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 8655, BSTAR: 0.00048021, MEAN_MOTION_DOT: 0.00005995, MEAN_MOTION_DDOT: 0,
};
const record = { choice: { id: "helios", noradId: 28492, title: "HELIOS 2A", category: "earth" }, epoch: new Date("2025-03-26T05:19:34.116Z"), satrec: json2satrec(omm) };
const time = new Date("2025-03-26T08:00:00Z");

test("telemetry matches the orbit: position, altitude, speed and period", () => {
  const t = telemetryAt(record, time);
  const p = positionAt(record, time);
  assert.ok(Math.abs(t.latitude - p.latitudeRad * 180 / Math.PI) < 1e-6);
  assert.ok(Math.abs(t.altitudeKm - p.altitudeKm) < 1e-6);
  assert.ok(t.altitudeKm > 550 && t.altitudeKm < 700);
  assert.ok(t.speedKmS > 7.3 && t.speedKmS < 7.8, "LEO speed " + t.speedKmS);
  // 15.0056 revolutions per day (SGP4's internal mean motion differs from
  // the OMM's Kozai value by a few hundredths of a minute).
  assert.ok(Math.abs(t.periodMin - 1440 / 15.00555103) < 0.1);
  assert.equal(t.look, null);
  assert.equal(typeof t.sunlit, "boolean");
});

test("seen from directly below it is overhead; from far away it is below the horizon", () => {
  const t = telemetryAt(record, time);
  const below = telemetryAt(record, time, { latitude: t.latitude, longitude: t.longitude });
  assert.ok(below.look.elevation > 89);
  assert.ok(Math.abs(below.look.rangeKm - t.altitudeKm) < 1);
  const antipode = telemetryAt(record, time, { latitude: -t.latitude, longitude: t.longitude + 180 });
  assert.ok(antipode.look.elevation < -60);
});

test("ground-track heading of a near-polar orbit is roughly north or south", () => {
  const t = telemetryAt(record, time);
  const fromNorth = Math.min(t.headingDeg, 360 - t.headingDeg);
  const fromSouth = Math.abs(t.headingDeg - 180);
  assert.ok(Math.min(fromNorth, fromSouth) < 45, "heading " + t.headingDeg);
  assert.ok(Math.abs(bearing(0, 0, 0, 10) - 90) < 1e-9);
  assert.ok(Math.abs(bearing(0, 0, 10, 0)) < 1e-9);
});

test("the shown working reproduces every readout", () => {
  const observer = { latitude: 48.8, longitude: 2.3 };
  const t = telemetryAt(record, time, observer);
  const d = derivationAt(record, time, observer);
  // ECI to Earth-fixed is a rotation by the sidereal angle about z.
  const c = Math.cos(d.gmst), s = Math.sin(d.gmst);
  assert.ok(Math.abs(d.eci.x * c + d.eci.y * s - d.ecf.x) < 1e-6);
  assert.ok(Math.abs(-d.eci.x * s + d.eci.y * c - d.ecf.y) < 1e-6);
  assert.equal(d.eci.z, d.ecf.z);
  assert.ok(Math.abs(d.geodetic.latitude - t.latitude) < 1e-9 && Math.abs(d.geodetic.altitudeKm - t.altitudeKm) < 1e-9);
  assert.equal(d.speedKmS, t.speedKmS);
  assert.ok(Math.abs(2 * Math.PI / d.meanMotion - t.periodMin) < 1e-9);
  assert.equal(d.heading.deg, t.headingDeg);
  assert.equal(d.shadow.sunlit, t.sunlit);
  assert.ok(Math.abs(Math.hypot(d.shadow.sun.x, d.shadow.sun.y, d.shadow.sun.z) - 1) < 1e-12);
  // Hand-written east/north/up agrees with satellite.js's look angles.
  assert.ok(Math.abs(d.look.azimuth - t.look.azimuth) < 1e-6, d.look.azimuth + " vs " + t.look.azimuth);
  assert.ok(Math.abs(d.look.elevation - t.look.elevation) < 1e-6);
  assert.ok(Math.abs(d.look.rangeKm - t.look.rangeKm) < 1e-6);
});
