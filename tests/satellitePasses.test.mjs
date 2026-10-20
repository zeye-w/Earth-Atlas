import assert from "node:assert/strict";
import { test } from "node:test";
import { json2satrec } from "satellite.js";
import { positionAt } from "../src/satelliteOrbits.ts";
import { predictPasses } from "../src/satellitePasses.ts";
import { inSunlight } from "../src/satelliteTelemetry.ts";
import { compassName } from "../src/compass.ts";
import { subsolarPoint } from "../src/solar.ts";

// Public satellite.js documentation OMM HELIOS 2A record (historical test
// fixture, NOT a current position).
const omm = {
  OBJECT_NAME: "HELIOS 2A", OBJECT_ID: "2004-049A", EPOCH: "2025-03-26T05:19:34.116960",
  MEAN_MOTION: 15.00555103, ECCENTRICITY: 0.000583, INCLINATION: 98.3164, RA_OF_ASC_NODE: 103.8411,
  ARG_OF_PERICENTER: 20.5667, MEAN_ANOMALY: 339.5789, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U",
  NORAD_CAT_ID: 28492, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 8655, BSTAR: 0.00048021, MEAN_MOTION_DOT: 0.00005995, MEAN_MOTION_DDOT: 0,
};
const record = { choice: { id: "helios", noradId: 28492, title: "HELIOS 2A", category: "earth" }, epoch: new Date("2025-03-26T05:19:34.116Z"), satrec: json2satrec(omm) };
const overhead = new Date("2025-03-26T08:00:00Z");

test("an observer under the ground track sees a high pass around that moment", () => {
  const sub = positionAt(record, overhead);
  const observer = { latitude: sub.latitudeRad * 180 / Math.PI, longitude: sub.longitudeRad * 180 / Math.PI };
  const passes = predictPasses([record], observer, new Date(overhead.getTime() - 20 * 60_000), 1, 10, 10);
  assert.equal(passes.length, 1);
  const [pass] = passes;
  assert.ok(pass.maxElevation > 80, "nearly overhead: " + pass.maxElevation);
  assert.ok(Math.abs(pass.peak.getTime() - overhead.getTime()) < 30_000);
  assert.ok(pass.rise < pass.peak && pass.peak < pass.set);
  // A ~800 km orbit is above the horizon for at most ~15 minutes.
  assert.ok(pass.set.getTime() - pass.rise.getTime() < 16 * 60_000);
  assert.equal(pass.inProgress, false);
  // Sun-synchronous polar orbit: rises and sets on roughly opposite sides.
  const turn = Math.abs(((pass.setAzimuth - pass.riseAzimuth + 360) % 360) - 180);
  assert.ok(turn < 30, "rise and set roughly opposite");
});

test("passes are sorted, at least the minimum elevation, and skip stale elements", () => {
  const observer = { latitude: 48.1, longitude: 11.6 };
  const passes = predictPasses([record], observer, overhead, 24, 10);
  assert.ok(passes.length >= 2);
  for (let i = 1; i < passes.length; i++) assert.ok(passes[i - 1].rise <= passes[i].rise);
  assert.ok(passes.every((p) => p.maxElevation >= 10));
  assert.deepEqual(predictPasses([record], observer, new Date("2025-05-01T00:00:00Z"), 24), [], "elements 36 days old are not used");
});

test("earth shadow and compass names", () => {
  const time = new Date("2025-03-20T12:00:00Z");
  const sun = subsolarPoint(time);
  const lat = sun.latitude * Math.PI / 180;
  const lon = sun.longitude * Math.PI / 180;
  const dir = { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) };
  const at = (k) => ({ x: dir.x * k, y: dir.y * k, z: dir.z * k });
  assert.equal(inSunlight(at(6800), time), true, "day side");
  assert.equal(inSunlight(at(-6800), time), false, "directly behind the Earth");
  assert.equal(inSunlight({ x: -dir.y * 7000, y: dir.x * 7000, z: 0 }, time), true, "beside the Earth, outside the shadow");
  assert.equal(compassName(0), "北");
  assert.equal(compassName(359), "北");
  assert.equal(compassName(135), "东南");
  assert.equal(compassName(300), "西北");
  assert.equal(compassName(292), "西");
});
