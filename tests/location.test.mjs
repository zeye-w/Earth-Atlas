import { test } from "node:test";
import assert from "node:assert/strict";
import {
  distanceKm,
  nearbyCity,
  parseLocationWeather,
  fetchLocationWeather,
} from "../src/locationData.ts";
const now = Date.now();
const fixture = () => ({
  latitude: 39.9,
  longitude: 116.4,
  elevation: 47,
  timezone: "Asia/Shanghai",
  current_units: {
    time: "unixtime",
    temperature_2m: "°C",
    apparent_temperature: "°C",
    relative_humidity_2m: "%",
    surface_pressure: "hPa",
    cloud_cover: "%",
    weather_code: "wmo code",
  },
  current: {
    time: now / 1000,
    temperature_2m: 14.6,
    apparent_temperature: 11.6,
    relative_humidity_2m: 50,
    surface_pressure: 1016.6,
    cloud_cover: 87,
    weather_code: 3,
  },
});
test("nearby city is a distance reference, not a claim of administrative membership", () => {
  assert.equal(nearbyCity(39.9042, 116.4074).name, "北京");
  assert.equal(nearbyCity(0, -140), null);
  assert.ok(Math.abs(distanceKm(0, 179.9, 0, -179.9) - 22.239) < 0.01);
});
test("point weather validates age and units and preserves missing values", () => {
  const data = parseLocationWeather(fixture(), now);
  assert.equal(data.temperature, 14.6);
  assert.equal(data.condition, "阴");
  const missing = fixture();
  missing.current.temperature_2m = null;
  missing.current.relative_humidity_2m = 101;
  missing.current_units.surface_pressure = "Pa";
  const parsed = parseLocationWeather(missing, now);
  assert.equal(parsed.temperature, null);
  assert.equal(parsed.humidity, null);
  assert.equal(parsed.pressure, null);
  assert.throws(
    () => parseLocationWeather(fixture(), now + 4 * 3600_000),
    /过期/,
  );
  assert.throws(
    () => parseLocationWeather({ ...fixture(), timezone: "invented" }, now),
    /时区/,
  );
});
test("point weather cache, failures and spatial mismatch", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return Response.json(fixture());
    };
    const signal = new AbortController().signal;
    await fetchLocationWeather(39.9, 116.4, signal);
    await fetchLocationWeather(39.9, 116.4, signal);
    assert.equal(calls, 1);
    await assert.rejects(fetchLocationWeather(0, 0, signal), /距离过远/);
    globalThis.fetch = async () => new Response("rate limit", { status: 429 });
    await assert.rejects(fetchLocationWeather(20, 20, signal), /暂时不可用/);
  } finally {
    globalThis.fetch = original;
  }
});
