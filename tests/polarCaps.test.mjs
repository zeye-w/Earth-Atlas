import assert from "node:assert/strict";
import { test } from "node:test";
import { POLAR_CAP_EDGE, polarCapProbeUrl } from "../src/polarCapData.ts";

test("polar caps start inside the Web Mercator edge and request Blue Marble in lon/lat order", () => {
  assert.ok(POLAR_CAP_EDGE < 85.05 && POLAR_CAP_EDGE > 80);
  const url = new URL(polarCapProbeUrl(-90, POLAR_CAP_EDGE, 0, 90));
  assert.equal(url.hostname, "gibs.earthdata.nasa.gov");
  assert.equal(url.searchParams.get("srs"), "EPSG:4326");
  assert.equal(url.searchParams.get("layers"), "BlueMarble_ShadedRelief_Bathymetry");
  assert.equal(url.searchParams.get("bbox"), `-90,${POLAR_CAP_EDGE},0,90`);
});
