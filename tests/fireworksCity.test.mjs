import assert from "node:assert/strict";
import { test } from "node:test";
import { Cartesian3, Matrix4 } from "cesium";
import { canLoadCity, retainCity, terrainShift } from "../src/fireworks/cityContext.ts";

test("city requests are gated by an explicitly configured token", () => {
  for (const token of [undefined, "", " \t\n"]) assert.equal(canLoadCity(token), false);
  assert.equal(canLoadCity("local-test-placeholder"), true);
});

test("keep the city during a show and below the post-show 15 km boundary", () => {
  for (const height of [0, 700, 14_999, 15_000]) assert.equal(retainCity(height, false), true);
  for (const height of [15_000.01, 20_000, 1_000_000]) assert.equal(retainCity(height, false), false);
  assert.equal(retainCity(20_000, true), true);
  assert.equal(retainCity(NaN, false), true);
});

test("terrain alignment translates down the geodetic normal without rotation", () => {
  for (const site of [{ longitude: 0, latitude: 0 }, { longitude: 116.4074, latitude: 39.9042 }, { longitude: 139.6503, latitude: 35.6762 }, { longitude: -74, latitude: -30 }]) {
    for (const height of [0, 50, -20, 1000]) {
      const shift = terrainShift(site, height);
      const original = Cartesian3.fromDegrees(site.longitude, site.latitude, height);
      const transformed = Matrix4.multiplyByPoint(shift, original, new Cartesian3());
      const ground = Cartesian3.fromDegrees(site.longitude, site.latitude, 0);
      assert.ok(Cartesian3.distance(transformed, ground) < 1e-7);
      assert.deepEqual(Array.from(shift).slice(0, 12), Array.from(Matrix4.IDENTITY).slice(0, 12));
    }
  }
  assert.ok(Matrix4.equals(terrainShift({ longitude: 0, latitude: 0 }, NaN), Matrix4.IDENTITY));
});
