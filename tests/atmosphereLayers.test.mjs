import assert from "node:assert/strict";
import { test } from "node:test";
import { ATMOSPHERE_LAYERS, ATMOSPHERE_SCALES, formatHeight, shellRadii } from "../src/atmosphereLayers.ts";

test("layer boundaries are ordered from the ground up", () => {
  const heights = ATMOSPHERE_LAYERS.map((layer) => layer.equatorHeightM);
  assert.deepEqual([...heights].sort((a, b) => a - b), heights);
  assert.equal(ATMOSPHERE_LAYERS.find((l) => l.key === "karman").equatorHeightM, 100_000);
});

test("tropopause is higher over the equator than the poles", () => {
  const tropo = ATMOSPHERE_LAYERS.find((l) => l.key === "troposphere");
  const [x, , z] = shellRadii(tropo, 1);
  assert.equal(x - 6_378_137, 17_000);
  assert.ok(Math.abs(z - 6_356_752.314245 - 9_000) < 1e-6);
  assert.equal(formatHeight(tropo), "9–17 km");
});

test("exaggeration only scales heights, not the Earth", () => {
  const thermo = ATMOSPHERE_LAYERS.find((l) => l.key === "thermosphere");
  assert.equal(shellRadii(thermo, 5)[0] - 6_378_137, 3_000_000);
  assert.deepEqual([...ATMOSPHERE_SCALES], [1, 5, 20]);
});
