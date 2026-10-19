import assert from "node:assert/strict";
import { test } from "node:test";
import { rectangleFullyDaylit, solarElevation, subsolarPoint } from "../src/solar.ts";

const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} not within ${tolerance} of ${expected}`);

test("subsolar latitude follows the seasons", () => {
  near(subsolarPoint(new Date("2026-06-21T12:00:00Z")).latitude, 23.44, 0.1, "June solstice");
  near(subsolarPoint(new Date("2026-12-21T12:00:00Z")).latitude, -23.44, 0.1, "December solstice");
  near(subsolarPoint(new Date("2026-03-20T15:00:00Z")).latitude, 0, 0.3, "March equinox");
});

test("subsolar longitude tracks UTC time (within the equation of time)", () => {
  // At 12:00 UTC the Sun is near the Greenwich meridian (EoT < 4.5°).
  for (const day of ["2026-02-11", "2026-05-14", "2026-07-26", "2026-11-03"]) {
    near(subsolarPoint(new Date(day + "T12:00:00Z")).longitude, 0, 4.6, day);
  }
  near(subsolarPoint(new Date("2026-06-21T18:00:00Z")).longitude, -90, 1, "18:00 UTC");
  near(subsolarPoint(new Date("2026-11-03T00:00:00Z")).longitude, 180 - 4.1, 1.5, "00:00 UTC (EoT +16 min)");
});

test("solar elevation is 90° at the subsolar point and -90° at the antipode", () => {
  const sun = { latitude: 10, longitude: 30 };
  near(solarElevation(10, 30, sun), 90, 1e-6, "zenith");
  near(solarElevation(-10, -150, sun), -90, 1e-6, "nadir");
  // 90° of arc from the subsolar point, along its meridian.
  near(solarElevation(-80, 30, sun), 0, 1e-6, "terminator");
  near(solarElevation(0, 120, { latitude: 0, longitude: 30 }), 0, 1e-6, "equatorial terminator");
});

test("only tiles well inside daylight are classified as daylit", () => {
  const sun = { latitude: 0, longitude: 0 };
  assert.equal(rectangleFullyDaylit({ west: -10, south: -10, east: 10, north: 10 }, sun, 20), true);
  assert.equal(rectangleFullyDaylit({ west: 170, south: -10, east: 180, north: 0 }, sun, 20), false, "night side");
  assert.equal(rectangleFullyDaylit({ west: 60, south: 0, east: 80, north: 20 }, sun, 20), false, "crosses the 20° margin");
  assert.equal(rectangleFullyDaylit({ west: 40, south: 0, east: 60, north: 20 }, sun, 20), true, "just inside the margin");
});
