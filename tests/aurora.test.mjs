import assert from "node:assert/strict";
import { test } from "node:test";
import { Cartesian3 } from "cesium";
import { AURORA_THRESHOLD, northernProfile, parseOvation } from "../src/auroraData.ts";
import { intensityAlongRing, profileRing } from "../src/aurora.ts";

// Synthetic OVATION-shaped payload for parser/geometry tests only (NOT NOAA
// data): an oval peaking at 67 deg N, strong on the night side (lon 180-359).
function syntheticPayload({ quiet = false } = {}) {
  const coordinates = [];
  for (let lon = 0; lon < 360; lon++) {
    for (let lat = -90; lat <= 90; lat++) {
      const peak = quiet ? 1 : (lon >= 180 ? 40 : 8);
      coordinates.push([lon, lat, Math.max(0, peak - 12 * Math.abs(lat - 67))]);
    }
  }
  return { "Observation Time": "2026-10-19T04:00:00Z", "Forecast Time": "2026-10-19T04:35:00Z", "Data Format": "[Longitude, Latitude, Aurora]", coordinates };
}

test("OVATION parser reads the grid, times and maximum probability", () => {
  const grid = parseOvation(syntheticPayload());
  assert.equal(grid.values.length, 360 * 181);
  assert.equal(grid.maxProbability, 40);
  assert.equal(grid.forecastTime?.toISOString(), "2026-10-19T04:35:00.000Z");
  assert.throws(() => parseOvation({ coordinates: [] }));
  assert.throws(() => parseOvation(null));
});

test("northern profile follows the oval latitude and scales brightness by probability", () => {
  const profile = northernProfile(parseOvation(syntheticPayload()));
  assert.ok(profile);
  assert.equal(profile.latitudes.length, 360);
  assert.ok(profile.latitudes.every((lat) => Math.abs(lat - 67) < 0.5));
  assert.ok(profile.intensities[270] > profile.intensities[90], "night-side oval brighter");
  assert.ok(profile.intensities.every((v) => v >= 0 && v <= 1));
});

test("no aurora is drawn when nothing exceeds the threshold", () => {
  assert.ok(AURORA_THRESHOLD > 1);
  assert.equal(northernProfile(parseOvation(syntheticPayload({ quiet: true }))), null);
});

test("ring is closed and brightness texture follows the ring", () => {
  const profile = northernProfile(parseOvation(syntheticPayload()));
  const coords = profileRing(profile);
  assert.equal(coords.length, 361 * 2);
  assert.equal(coords[1], coords[coords.length - 1]);
  const positions = Cartesian3.fromDegreesArray(coords);
  const texture = intensityAlongRing(positions, profile, 360);
  assert.ok(texture[270] > texture[90]);
});
