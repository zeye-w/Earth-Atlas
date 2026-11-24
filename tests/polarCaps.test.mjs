import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GIBS_500M_MAX_MATRIX, POLAR_CAP_EDGE, POLAR_CAP_LAYER, POLAR_CAP_LEVEL_ZERO_TILES, POLAR_CAP_MATRIX_OFFSET,
  POLAR_CAP_MAX_MATRIX, polarCapTileBounds, polarCapTileMatrixLabels, polarCapTileUrl,
} from "../src/polarCapData.ts";

test("polar caps start inside the Web Mercator edge", () => {
  assert.ok(POLAR_CAP_EDGE < 85.05 && POLAR_CAP_EDGE > 80);
});

test("polar caps request Blue Marble WMTS tiles in GIBS's geographic 500m set", () => {
  const url = new URL(polarCapTileUrl(6, 0, 7));
  assert.equal(url.hostname, "gibs.earthdata.nasa.gov");
  assert.equal(url.pathname, `/wmts/epsg4326/best/${POLAR_CAP_LAYER}/default/500m/6/0/7.jpeg`);
  assert.equal(POLAR_CAP_LAYER, "BlueMarble_ShadedRelief_Bathymetry");
});

test("the scheme's levels map onto GIBS matrices from the first unpadded one", () => {
  // GIBS matrix 3 is 10×5 tiles of 36°; the scheme's level 0 must match it.
  assert.equal(POLAR_CAP_MATRIX_OFFSET, 3);
  assert.deepEqual(POLAR_CAP_LEVEL_ZERO_TILES, { x: 10, y: 5 });
  assert.equal(360 / POLAR_CAP_LEVEL_ZERO_TILES.x, 180 / POLAR_CAP_LEVEL_ZERO_TILES.y);
  const labels = polarCapTileMatrixLabels();
  assert.equal(labels[0], "3");
  assert.equal(labels.at(-1), String(POLAR_CAP_MAX_MATRIX));
  assert.ok(POLAR_CAP_MAX_MATRIX <= GIBS_500M_MAX_MATRIX);
});

test("tile bounds cover the globe from 180°W, 90°N and reach both caps", () => {
  assert.deepEqual(polarCapTileBounds(3, 0, 0), { west: -180, east: -144, north: 90, south: 54 });
  const rows = POLAR_CAP_LEVEL_ZERO_TILES.y * 2 ** (POLAR_CAP_MAX_MATRIX - POLAR_CAP_MATRIX_OFFSET);
  const cols = POLAR_CAP_LEVEL_ZERO_TILES.x * 2 ** (POLAR_CAP_MAX_MATRIX - POLAR_CAP_MATRIX_OFFSET);
  const last = polarCapTileBounds(POLAR_CAP_MAX_MATRIX, rows - 1, cols - 1);
  assert.equal(last.south, -90);
  assert.equal(last.east, 180);
  // The deepest tiles at each pole sit wholly inside the caps.
  assert.ok(polarCapTileBounds(POLAR_CAP_MAX_MATRIX, 0, 0).south >= POLAR_CAP_EDGE);
  assert.ok(polarCapTileBounds(POLAR_CAP_MAX_MATRIX, rows - 1, 0).north <= -POLAR_CAP_EDGE);
});
