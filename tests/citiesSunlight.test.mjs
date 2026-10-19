import assert from "node:assert/strict";
import { test } from "node:test";
import { JulianDate, SunLight } from "cesium";
import { WORLD_CITIES, validWorldCities } from "../src/worldCities.ts";

test("city dataset is compact, geographically valid and has stable unique IDs", () => {
  assert.equal(validWorldCities(), true);
  assert.ok(WORLD_CITIES.length >= 35 && WORLD_CITIES.length <= 65);
  const ids = WORLD_CITIES.map((city) => city.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(validWorldCities([...WORLD_CITIES, WORLD_CITIES[0]]), false);
});

test("major city labels remain a manageable subset; secondary labels are regional", () => {
  const global = WORLD_CITIES.filter((city) => city.tier === 1);
  const regional = WORLD_CITIES.filter((city) => city.tier === 2);
  assert.ok(global.length >= 15 && global.length <= 35);
  assert.ok(regional.length >= 15);
  assert.ok(WORLD_CITIES.some((city) => city.longitude < -100));
  assert.ok(WORLD_CITIES.some((city) => city.longitude > 100));
  assert.ok(WORLD_CITIES.some((city) => city.latitude < -30));
  assert.ok(WORLD_CITIES.some((city) => city.latitude > 50));
});

test("known cities have geographic orientation and stable labeled coordinates", () => {
  const tokyo = WORLD_CITIES.find((x) => x.id === "tokyo");
  assert.ok(tokyo && tokyo.latitude > 35 && tokyo.longitude > 139);
  const london = WORLD_CITIES.find((x) => x.id === "london");
  assert.ok(london && london.latitude > 51 && Math.abs(london.longitude) < 1);
  const newYork = WORLD_CITIES.find((x) => x.id === "new-york");
  assert.ok(newYork && newYork.longitude < -70);
  const sydney = WORLD_CITIES.find((x) => x.id === "sydney");
  assert.ok(sydney && sydney.latitude < 0 && sydney.longitude > 150);
});

test("Cesium SunLight uses a solar source and JulianDate maintains absolute UTC instants", () => {
  const sunlight = new SunLight({ intensity: 2 });
  assert.ok(sunlight instanceof SunLight);
  const testDate = new Date("2026-10-19T01:00:00Z");
  assert.equal(JulianDate.toDate(JulianDate.fromDate(testDate)).toISOString(), testDate.toISOString());
});
