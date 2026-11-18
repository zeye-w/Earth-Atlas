import assert from "node:assert/strict";
import { test } from "node:test";
import { classFlux, flareClass, parseFlares, parseXrays, radioBlackout, sdoImageUrl, strongestFlare } from "../src/solarActivity.ts";

test("flare classes and fluxes round-trip", () => {
  assert.equal(flareClass(2.3e-5), "M2.3");
  assert.equal(flareClass(1.04e-4), "X1.0");
  assert.equal(flareClass(6.66e-6), "C6.6");
  assert.equal(flareClass(8.5e-7), "B8.5");
  assert.equal(classFlux("M2.3"), 2.3e-5);
  assert.equal(classFlux("X10"), 1e-3);
  assert.equal(classFlux("nonsense"), null);
  assert.equal(radioBlackout(2.3e-5), "R1");
  assert.equal(radioBlackout(1.2e-4), "R3");
  assert.equal(radioBlackout(6e-6), null);
});

test("NOAA flare and X-ray feeds parse, newest first, without duplicates", () => {
  // Shapes as served by services.swpc.noaa.gov (values made up).
  const flares = parseFlares([
    { time_tag: "2026-11-11T10:06:00Z", begin_time: "2026-11-11T10:06:00Z", begin_class: "B6.3", max_time: "2026-11-11T10:13:00Z", max_class: "B8.5", max_xrlong: 8.5e-7, end_time: "2026-11-11T10:21:00Z", satellite: 18 },
    { time_tag: "2026-11-18T06:12:00Z", begin_time: "2026-11-18T06:12:00Z", max_time: "2026-11-18T06:20:00Z", max_class: "M6.6", max_xrlong: 6.6e-5, end_time: "Unk" },
    { time_tag: "2026-11-18T06:12:00Z", begin_time: "2026-11-18T06:12:00Z", max_time: "2026-11-18T06:20:00Z", max_class: "M6.6", max_xrlong: 6.6e-5, end_time: "2026-11-18T06:28:00Z" },
    { broken: true },
  ]);
  assert.equal(flares.length, 2);
  assert.equal(flares[0].peakClass, "M6.6");
  assert.equal(flares[0].end, Date.parse("2026-11-18T06:28:00Z"));
  assert.equal(strongestFlare(flares, Date.parse("2026-11-17T00:00:00Z"), Date.parse("2026-11-19T00:00:00Z")).peakClass, "M6.6");
  assert.equal(strongestFlare(flares, 0, 1), null);
  const xray = parseXrays([
    { time_tag: "2026-11-18T08:00:00Z", flux: 2.5e-8, energy: "0.05-0.4nm" },
    { time_tag: "2026-11-18T08:00:00Z", flux: 1.5e-6, energy: "0.1-0.8nm" },
    { time_tag: "2026-11-18T08:01:00Z", flux: 2.4e-8, energy: "0.05-0.4nm" },
  ]);
  assert.deepEqual(xray, { time: Date.parse("2026-11-18T08:00:00Z"), flux: 1.5e-6 });
  assert.throws(() => parseFlares({}));
});

test("SDO image URLs change every 15 minutes", () => {
  const a = sdoImageUrl("0171", 0), b = sdoImageUrl("0171", 14 * 60_000), c = sdoImageUrl("0171", 15 * 60_000);
  assert.match(a, /^https:\/\/sdo\.gsfc\.nasa\.gov\/assets\/img\/latest\/latest_1024_0171\.jpg\?t=0$/);
  assert.equal(a, b);
  assert.notEqual(b, c);
});
