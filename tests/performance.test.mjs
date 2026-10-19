import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RENDER_PROFILES, RENDER_QUALITY_ORDER, GLOBAL_VECTOR_MAX_ZOOM,
  GLOBAL_VECTOR_TILE_NODES, initialRenderQuality, initialSpaceMotion,
  nextRenderQuality,
} from "../src/performance.ts";
import { THEMATIC_MAX_ZOOM } from "../src/mapThematic.ts";

test("default desktop quality is balanced rather than upscaling by devicePixelRatio", () => {
  assert.equal(initialRenderQuality(1920, false, 8), "balanced");
  assert.equal(RENDER_PROFILES.balanced.resolutionScale, 1);
  assert.equal(RENDER_PROFILES.high.resolutionScale, 1.25);
  assert.ok(RENDER_PROFILES.high.resolutionScale < 2);
});

test("mobile/reduced motion/low-core devices start in eco mode", () => {
  assert.equal(initialRenderQuality(390, false, 8), "eco");
  assert.equal(initialRenderQuality(1920, true, 8), "eco");
  assert.equal(initialRenderQuality(1920, false, 4), "eco");
  assert.equal(initialSpaceMotion(390, false), false);
  assert.equal(initialSpaceMotion(1920, true), false);
  assert.equal(initialSpaceMotion(1920, false), true);
});

test("render settings explicitly trade frame budget, resolution and terrain detail", () => {
  assert.ok(RENDER_PROFILES.eco.resolutionScale < RENDER_PROFILES.balanced.resolutionScale);
  assert.ok(RENDER_PROFILES.balanced.resolutionScale < RENDER_PROFILES.high.resolutionScale);
  assert.ok(RENDER_PROFILES.eco.targetFrameRate <= RENDER_PROFILES.balanced.targetFrameRate);
  assert.ok(RENDER_PROFILES.balanced.targetFrameRate <= RENDER_PROFILES.high.targetFrameRate);
  assert.ok(RENDER_PROFILES.eco.maximumScreenSpaceError > RENDER_PROFILES.high.maximumScreenSpaceError);
  assert.equal(RENDER_PROFILES.eco.fxaa, false);
});

test("render quality control cycles through three meaningful modes", () => {
  assert.deepEqual(RENDER_QUALITY_ORDER, ["eco", "balanced", "high"]);
  assert.equal(nextRenderQuality("eco"), "balanced");
  assert.equal(nextRenderQuality("balanced"), "high");
  assert.equal(nextRenderQuality("high"), "eco");
});

test("global MVT provider is bounded to a small eager tile hierarchy", () => {
  assert.equal(GLOBAL_VECTOR_MAX_ZOOM, 5);
  assert.equal(THEMATIC_MAX_ZOOM, GLOBAL_VECTOR_MAX_ZOOM);
  assert.equal(GLOBAL_VECTOR_TILE_NODES, 1365);
  assert.equal(GLOBAL_VECTOR_TILE_NODES * 4, 5460); // ~75% fewer than z0..6=5461
});
