import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { DEFAULT_ON, LAYER_INFO, LAYER_TABS, openedCounts, openedLayers } from "../src/panels/layerTabs.ts";
import { ENGLISH } from "../src/locales/en.ts";

test("every layer toggle has a tab and an English chip label", () => {
  // The toggles are the keys of LayerToggles in useLayerSettings.ts.
  const source = readFileSync(new URL("../src/hooks/useLayerSettings.ts", import.meta.url), "utf8");
  const declared = source.match(/export type LayerToggles = [^;]+;/s)[0];
  const extra = [...declared.matchAll(/(\w+): boolean/g)].map((m) => m[1]);
  const scene = readFileSync(new URL("../src/sceneState.ts", import.meta.url), "utf8").match(/LAYER_KEYS = \[([^\]]+)\]/)[1].match(/\w+/g);
  for (const key of [...scene, ...extra]) {
    assert.ok(LAYER_INFO[key], key);
    assert.ok(LAYER_TABS.includes(LAYER_INFO[key].tab), key);
    assert.ok(ENGLISH[LAYER_INFO[key].label], LAYER_INFO[key].label);
  }
});

test("only layers turned on beyond the default view count as opened", () => {
  const layers = Object.fromEntries(Object.keys(LAYER_INFO).map((k) => [k, DEFAULT_ON.has(k)]));
  assert.deepEqual(openedLayers(layers), []);
  Object.assign(layers, { storms: true, flights: true, moon: true, paths: true });
  assert.deepEqual(openedLayers(layers), ["storms", "moon", "flights", "paths"]);
  assert.deepEqual(openedCounts(layers), { earth: 1, space: 1, human: 2, play: 0 });
  // Predicted paths without the satellites show nothing, so they are not listed.
  layers.satellites = false;
  assert.deepEqual(openedLayers(layers), ["storms", "moon", "flights"]);
});

test("satellites sit under Human activity, rocket launches under Interactive", () => {
  for (const key of ["satellites", "paths", "starlink"]) assert.equal(LAYER_INFO[key].tab, "human", key);
  assert.equal(LAYER_INFO.launches.tab, "play");
  const layers = Object.fromEntries(Object.keys(LAYER_INFO).map((k) => [k, DEFAULT_ON.has(k)]));
  Object.assign(layers, { starlink: true, launches: true });
  assert.deepEqual(openedCounts(layers), { earth: 0, space: 0, human: 1, play: 1 });
});
