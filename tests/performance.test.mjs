import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RENDER_PROFILES, RENDER_QUALITY_ORDER, GLOBAL_VECTOR_MAX_ZOOM,
  GLOBAL_VECTOR_TILE_NODES, initialRenderQuality, renderSettings,
  nextRenderQuality,
} from "../src/performance.ts";
import { THEMATIC_MAX_ZOOM } from "../src/mapThematic.ts";

test("default desktop quality is balanced and uses part of a high-DPI screen", () => {
  assert.equal(initialRenderQuality(1920, false, 8), "balanced");
  assert.equal(initialRenderQuality(1920, false, 4), "balanced");
  assert.equal(renderSettings("balanced", 2).resolutionScale, 1.5);
  assert.equal(renderSettings("high", 2).resolutionScale, 2);
  assert.equal(renderSettings("high", 3).resolutionScale, 2);
  assert.equal(renderSettings("eco", 2).resolutionScale, 1);
});

test("render scale never exceeds the screen and FXAA only runs at low pixel ratios", () => {
  assert.equal(renderSettings("high", 1).resolutionScale, 1);
  assert.equal(renderSettings("balanced", 1).fxaa, true);
  assert.equal(renderSettings("balanced", 2).fxaa, false);
  assert.equal(renderSettings("balanced", Number.NaN).resolutionScale, 1);
});

test("mobile/reduced motion/low-core devices start in eco mode", () => {
  assert.equal(initialRenderQuality(390, false, 8), "eco");
  assert.equal(initialRenderQuality(1920, true, 8), "eco");
  assert.equal(initialRenderQuality(1920, false, 2), "eco");
});

test("render settings explicitly trade frame budget, resolution and terrain detail", () => {
  assert.ok(RENDER_PROFILES.eco.maxPixelRatio < RENDER_PROFILES.balanced.maxPixelRatio);
  assert.ok(RENDER_PROFILES.balanced.maxPixelRatio < RENDER_PROFILES.high.maxPixelRatio);
  assert.ok(RENDER_PROFILES.eco.targetFrameRate <= RENDER_PROFILES.balanced.targetFrameRate);
  assert.ok(RENDER_PROFILES.balanced.targetFrameRate <= RENDER_PROFILES.high.targetFrameRate);
  assert.ok(RENDER_PROFILES.eco.maximumScreenSpaceError > RENDER_PROFILES.high.maximumScreenSpaceError);
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
