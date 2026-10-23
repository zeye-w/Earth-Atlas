import assert from "node:assert/strict";
import { test } from "node:test";
import { json2satrec } from "satellite.js";
import {
  GP_CACHE_MS,
  MAX_ELEMENT_AGE_DAYS,
  SATELLITE_CHOICES,
  parseGPRecords,
  parseGPEpoch,
  convertGPRecords,
  positionAt,
  orbitPath,
  refinePath,
  formatEpoch,
} from "../src/satelliteOrbits.ts";
import { SATELLITE_MAX_DISPLAY, SATELLITE_PATH_UPDATE_MS, SATELLITE_MIN_FPS, SATELLITE_MAX_FPS, satelliteFrameRate } from "../src/satelliteOverlay.ts";

// Public satellite.js documentation OMM HELIOS 2A record (historical test
// fixture, NOT presented as a current position or a live CelesTrak response).
const sample = {
  OBJECT_NAME: "HELIOS 2A",
  OBJECT_ID: "2004-049A",
  EPOCH: "2025-03-26T05:19:34.116960",
  MEAN_MOTION: 15.00555103,
  ECCENTRICITY: 0.000583,
  INCLINATION: 98.3164,
  RA_OF_ASC_NODE: 103.8411,
  ARG_OF_PERICENTER: 20.5667,
  MEAN_ANOMALY: 339.5789,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: "U",
  NORAD_CAT_ID: 28492,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 8655,
  BSTAR: 0.00048021,
  MEAN_MOTION_DOT: 0.00005995,
  MEAN_MOTION_DDOT: 0,
};
const atEpoch = new Date("2025-03-26T05:19:34.116Z");

test("curated source remains bounded and cache respects CelesTrak update interval", () => {
  assert.ok(SATELLITE_CHOICES.length >= 4);
  assert.ok(SATELLITE_CHOICES.length <= SATELLITE_MAX_DISPLAY);
  assert.equal(new Set(SATELLITE_CHOICES.map((x) => x.noradId)).size, SATELLITE_CHOICES.length);
  assert.ok(GP_CACHE_MS >= 2 * 60 * 60 * 1000);
  assert.ok(MAX_ELEMENT_AGE_DAYS <= 14);
  assert.ok(SATELLITE_PATH_UPDATE_MS >= 60_000);
});

test("satellite motion re-renders only as fast as it moves on screen", () => {
  // Real-time LEO at a whole-globe view barely moves: minimum rate.
  assert.equal(satelliteFrameRate(1, 17_000_000, 900), SATELLITE_MIN_FPS);
  // Zoomed in or accelerated: capped at the maximum rate.
  assert.equal(satelliteFrameRate(1, 300_000, 900), SATELLITE_MAX_FPS);
  assert.equal(satelliteFrameRate(300, 17_000_000, 900), SATELLITE_MAX_FPS);
  assert.ok(SATELLITE_MAX_FPS <= 30);
});

test("CelesTrak offset-free OMM epochs must be UTC, not local browser time", () => {
  assert.equal(parseGPEpoch("2026-10-19T01:00:00").toISOString(), "2026-10-19T01:00:00.000Z");
  assert.equal(parseGPEpoch("2026-10-19T01:00:00Z").toISOString(), "2026-10-19T01:00:00.000Z");
  assert.equal(parseGPEpoch("2026-10-19T09:00:00+08:00").toISOString(), "2026-10-19T01:00:00.000Z");
});

test("CelesTrak JSON structure validation rejects non-JSON, wrappers, and missing epoch", () => {
  assert.throws(() => parseGPRecords("<!doctype html>"), /not an array/);
  assert.throws(() => parseGPRecords({ data: [] }), /not an array/);
  const parsed = parseGPRecords([{ NORAD_CAT_ID: 25544, EPOCH: "2026-10-19T00:00:00" }, { NORAD_CAT_ID: 25544 }, null]);
  assert.equal(parsed.length, 1);
});

test("documented OMM data propagates to real geodetic positions using SGP4", () => {
  const rec = { choice: SATELLITE_CHOICES[0], epoch: atEpoch, satrec: json2satrec(sample) };
  const pos = positionAt(rec, atEpoch);
  assert.ok(pos);
  assert.ok(pos.latitudeRad >= -Math.PI / 2 && pos.latitudeRad <= Math.PI / 2);
  assert.ok(pos.longitudeRad >= -Math.PI && pos.longitudeRad <= Math.PI);
  assert.ok(pos.altitudeKm > 200);
  assert.ok(pos.altitudeKm < 1500);
  const after = positionAt(rec, new Date(atEpoch.getTime() + 10 * 60_000));
  assert.ok(after);
  assert.notEqual(pos.longitudeRad, after.longitudeRad);
});

test("orbit paths have bounded samples and genuine time evolution", () => {
  const rec = { choice: SATELLITE_CHOICES[0], epoch: atEpoch, satrec: json2satrec(sample) };
  const points = orbitPath(rec, atEpoch);
  assert.equal(points.length, 181);
  assert.equal(orbitPath(rec, atEpoch, 90, 3).length, 31);
  assert.ok(points.every((p) => p.altitudeKm > 200));
  assert.deepEqual(orbitPath(rec, atEpoch, 0), []);
  assert.deepEqual(orbitPath(rec, atEpoch, 150), []);
});

test("close up, the refined path passes through the satellite between coarse samples", () => {
  const rec = { choice: SATELLITE_CHOICES[0], epoch: atEpoch, satrec: json2satrec(sample) };
  // Spherical Earth is enough to compare points metres apart.
  const xyz = (p) => { const r = 6_371_000 + p.altitudeKm * 1000; return [r * Math.cos(p.latitudeRad) * Math.cos(p.longitudeRad), r * Math.cos(p.latitudeRad) * Math.sin(p.longitudeRad), r * Math.sin(p.latitudeRad)]; };
  const offLine = (point, line) => {
    const p = xyz(point);
    let best = Infinity;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = xyz(line[i]), b = xyz(line[i + 1]);
      const ab = b.map((v, k) => v - a[k]), ap = p.map((v, k) => v - a[k]);
      const t = Math.max(0, Math.min(1, ap.reduce((s, v, k) => s + v * ab[k], 0) / ab.reduce((s, v) => s + v * v, 0)));
      best = Math.min(best, Math.hypot(...ap.map((v, k) => v - t * ab[k])));
    }
    return best;
  };
  const coarse = orbitPath(rec, atEpoch);
  const start = new Date(atEpoch.getTime() - 45 * 60_000);
  const between = new Date(atEpoch.getTime() + 15_000); // mid-way between 30 s samples
  const here = positionAt(rec, between);
  assert.ok(offLine(here, coarse) > 300, "straight 30 s chords miss the satellite by hundreds of metres");
  const refined = refinePath(rec, coarse, start, 0.5, between);
  assert.ok(offLine(here, refined) < 1, "refined path within a metre");
  assert.equal(refined.length, coarse.length - 4 + 121);
});

test("stale data never displays as current orbit, and API IDs are not invented", () => {
  const stale = { ...sample, NORAD_CAT_ID: 25544 };
  assert.equal(convertGPRecords([stale], new Date("2026-10-19T00:00:00Z")).length, 0);
  assert.equal(convertGPRecords([{ ...sample, NORAD_CAT_ID: 999999 }], atEpoch).length, 0);
  assert.match(formatEpoch(atEpoch), /UTC$/);
});

test("recent structurally valid OMM records are selected using real published numeric data", () => {
  // A controlled propagation test: only the epoch and catalog identity are
  // shifted from the public HELIOS fixture to exercise freshness and filtering.
  // Never use this synthetic fixture in production or call it a real ISS orbit.
  const fixture = { ...sample, NORAD_CAT_ID: 25544, EPOCH: atEpoch.toISOString() };
  const result = convertGPRecords([fixture], atEpoch);
  assert.equal(result.length, 1);
  assert.equal(result[0].choice.id, "iss");
  assert.ok(positionAt(result[0], atEpoch));
});
