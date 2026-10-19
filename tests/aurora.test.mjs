import assert from "node:assert/strict";
import { test } from "node:test";
import { GEOMAGNETIC_POLE, auroralRing, destination } from "../src/aurora.ts";

function angularDistanceDeg(a, b) {
  const r = Math.PI / 180;
  const cos = Math.sin(a.latitude * r) * Math.sin(b.latitude * r) +
    Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.cos((a.longitude - b.longitude) * r);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / r;
}

test("destination keeps the requested angular distance from the origin", () => {
  const origin = { latitude: GEOMAGNETIC_POLE.latitude, longitude: GEOMAGNETIC_POLE.longitude };
  for (const bearing of [0, 90, 180, 270]) {
    const point = destination(origin.latitude, origin.longitude, 20, bearing);
    assert.ok(Math.abs(angularDistanceDeg(origin, point) - 20) < 1e-6);
    assert.ok(point.longitude >= -180 && point.longitude < 180);
  }
});

test("auroral ring is closed and stays at auroral-oval latitudes", () => {
  const coords = auroralRing(20.5, 90);
  assert.equal(coords.length, 91 * 2);
  assert.deepEqual(coords.slice(0, 2).map((v) => v.toFixed(6)), coords.slice(-2).map((v) => v.toFixed(6)));
  for (let i = 1; i < coords.length; i += 2) {
    assert.ok(coords[i] > 55 && coords[i] < 85, "latitude " + coords[i]);
  }
});
