import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseWeather,
  sampleWeather,
  temperatureColor,
  windRotation,
  WEATHER_MAX_AGE,
} from "../src/weatherData.ts";
const snapshot = JSON.parse(
  readFileSync(new URL("../public/data/weather/latest.json", import.meta.url)),
);
const time = Date.parse(snapshot.validTime);
test("NOAA snapshot has coherent global fields and is rejected when expired", () => {
  const data = parseWeather(snapshot, time + 3600_000);
  assert.ok(sampleWeather(data, 0, 0).temperature > -50);
  assert.throws(() => parseWeather(data, time + WEATHER_MAX_AGE + 1), /过期/);
  assert.throws(() => parseWeather({ ...data, u: [1] }, time), /完整/);
  assert.throws(
    () =>
      parseWeather(
        { ...data, v: data.v.map((v, i) => (i === 0 ? NaN : v)) },
        time,
      ),
    /完整/,
  );
});
test("longitude wraps continuously at Greenwich and the date line; poles clamp", () => {
  for (const lat of [-90, -45, 0, 45, 90]) {
    assert.deepEqual(
      sampleWeather(snapshot, lat, -180),
      sampleWeather(snapshot, lat, 180),
    );
    assert.deepEqual(
      sampleWeather(snapshot, lat, -1),
      sampleWeather(snapshot, lat, 359),
    );
  }
  assert.deepEqual(
    sampleWeather(snapshot, 100, 10),
    sampleWeather(snapshot, 90, 10),
  );
});
test("wind billboard rotation follows screen-projected direction", () => {
  assert.equal(windRotation(0, -1), 0);
  assert.equal(windRotation(1, 0), -Math.PI / 2);
  assert.equal(Math.abs(windRotation(0, 1)), Math.PI);
  assert.equal(windRotation(-1, 0), Math.PI / 2);
});
test("temperature palette clamps extreme temperatures", () => {
  assert.deepEqual(temperatureColor(-100), temperatureColor(-60));
  assert.deepEqual(temperatureColor(100), temperatureColor(50));
});
test("weather worker uses release, cache, bundled fallback and refuses expired data", async () => {
  const original = globalThis.fetch;
  const fresh = { ...snapshot, validTime: new Date().toISOString() };
  const request = new Request("https://example.org/data/weather/latest.json");
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return Response.json(fresh);
    };
    const { weatherResponse } = await import("../worker/weather.ts?release");
    const assets = {
      fetch: async () => {
        throw Error("must use release");
      },
    };
    assert.equal((await weatherResponse(request, assets)).status, 200);
    assert.equal((await weatherResponse(request, assets)).status, 200);
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response("offline", { status: 503 });
    const fallback = await import("../worker/weather.ts?fallback");
    assert.equal(
      (
        await fallback.weatherResponse(request, {
          fetch: async () => Response.json(fresh),
        })
      ).status,
      200,
    );
    const expired = await import("../worker/weather.ts?expired");
    const result = await expired.weatherResponse(request, {
      fetch: async () =>
        Response.json({ ...snapshot, validTime: "2000-01-01T00:00:00Z" }),
    });
    assert.equal(result.status, 503);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(
      (
        await expired.weatherResponse(
          new Request(request, { method: "POST" }),
          assets,
        )
      ).status,
      405,
    );
  } finally {
    globalThis.fetch = original;
  }
});
