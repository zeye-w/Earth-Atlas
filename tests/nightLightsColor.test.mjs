import assert from "node:assert/strict";
import { test } from "node:test";
import { extractLights, lightPixel } from "../src/nightLightsColor.ts";

test("navy background and moonlit snow become transparent", () => {
  assert.equal(lightPixel(10, 10, 30)[3], 0, "navy background");
  assert.equal(lightPixel(0, 0, 0)[3], 0, "black");
  assert.ok(lightPixel(60, 65, 90)[3] < 40, "moonlit snow stays faint");
});

test("city lights keep high alpha, dim ones amber and bright cores near white", () => {
  const dim = lightPixel(140, 110, 60);
  const bright = lightPixel(255, 250, 230);
  assert.ok(dim[3] > 150 && bright[3] === 255);
  assert.ok(dim[2] < bright[2], "bright cores are whiter (more blue) than dim amber lights");
  assert.equal(bright[0], 255);
});

test("extractLights rewrites RGBA data in place", () => {
  const data = new Uint8ClampedArray([10, 10, 30, 255, 255, 250, 230, 255]);
  extractLights(data);
  assert.equal(data[3], 0);
  assert.equal(data[7], 255);
});
