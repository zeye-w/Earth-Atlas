import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { depthColor, magnitudePixelSize, parseQuakeFeed, DEPTH_CLASSES } from "../src/earthquakeData.ts";
import { densify, MAX_SEGMENT_DEG } from "../src/plateBoundaries.ts";

// Synthetic USGS-shaped features for parser tests only (NOT real events).
const feed = {
  type: "FeatureCollection",
  features: [
    { id: "test1", properties: { mag: 6.1, place: "Synthetic A", time: 1760000000000, url: "https://earthquake.usgs.gov/x", tsunami: 1, magType: "mww" }, geometry: { coordinates: [142.1, 38.2, 24.5] } },
    { id: "test2", properties: { mag: 2.7, place: null, time: 1760000100000, url: "javascript:alert(1)", tsunami: 0 }, geometry: { coordinates: [-117.5, 35.7, 8.1] } },
    { id: "bad", properties: { mag: null, time: 1 }, geometry: { coordinates: [0, 0, 10] } },
    { id: "bad2", properties: { mag: 3, time: 1 }, geometry: { coordinates: [200, 0, 10] } },
  ],
};

test("USGS feed parser keeps valid events, sorted small to large, and rejects unsafe links", () => {
  const quakes = parseQuakeFeed(feed);
  assert.deepEqual(quakes.map((q) => q.id), ["test2", "test1"]);
  assert.equal(quakes[1].depthKm, 24.5);
  assert.equal(quakes[1].tsunami, true);
  assert.equal(quakes[1].magnitudeType, "mww");
  assert.equal(quakes[0].url, null, "non-https links are dropped");
  assert.throws(() => parseQuakeFeed({}));
});

test("depth classes and magnitude sizes follow the legend", () => {
  assert.equal(depthColor(10), DEPTH_CLASSES[0].color);
  assert.equal(depthColor(150), DEPTH_CLASSES[1].color);
  assert.equal(depthColor(600), DEPTH_CLASSES[2].color);
  assert.ok(magnitudePixelSize(7) > magnitudePixelSize(4));
  assert.equal(magnitudePixelSize(1), 3);
  assert.ok(magnitudePixelSize(9.5) <= 22 && magnitudePixelSize(9.5) > magnitudePixelSize(8));
  assert.equal(magnitudePixelSize(12), 22);
});

test("bundled PB2002 boundaries are complete and well formed", () => {
  const data = JSON.parse(readFileSync(new URL("../src/data/plateBoundaries.json", import.meta.url), "utf8"));
  assert.match(data.source, /Bird \(2003\) PB2002/);
  assert.equal(data.boundaries.length, 241);
  assert.equal(data.boundaries.filter((b) => b.subduction).length, 65);
  for (const boundary of data.boundaries) {
    assert.ok(boundary.coordinates.length >= 2);
    for (const [lon, lat] of boundary.coordinates) assert.ok(Math.abs(lon) <= 180 && Math.abs(lat) <= 90);
  }
});

test("densify keeps endpoints and caps segment length", () => {
  const line = densify([[0, 0], [4, 0], [4, 1]]);
  assert.deepEqual(line[0], [0, 0]);
  assert.deepEqual(line[line.length - 1], [4, 1]);
  for (let i = 1; i < line.length; i++) {
    assert.ok(Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]) <= MAX_SEGMENT_DEG + 1e-9);
  }
});
