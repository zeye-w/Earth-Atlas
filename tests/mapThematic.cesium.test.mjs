import assert from "node:assert/strict";
import { test } from "node:test";
import { Cesium3DTileStyle } from "cesium";
import { makeThematicStyle } from "../src/mapThematic.ts";

const feature = (properties) => ({
  getProperty: (name) => properties[name],
  hasProperty: (name) => Object.hasOwn(properties, name),
});

test("Cesium parses and evaluates era styles against real-world tile field names", () => {
  const style = new Cesium3DTileStyle(makeThematicStyle("age", "mesozoic", "all"));
  assert.equal(Boolean(style.show?.evaluate(feature({ map_id: 20, best_age_top: 66, best_age_bottom: 100.5 }))), true);
  assert.equal(Boolean(style.show?.evaluate(feature({ map_id: 21, best_age_top: 0, best_age_bottom: 5 }))), false);
  assert.equal(Boolean(style.show?.evaluate(feature({ map_id: 22, best_age_top: 65, best_age_bottom: 100 }))), false);
  assert.equal(Boolean(style.show?.evaluate(feature({ line_id: 1, type: "fault" }))), false);
});

test("Cesium evaluates exact positive/negative free-text matches for rock filters", () => {
  const style = new Cesium3DTileStyle(makeThematicStyle("lithology", "all", "igneous"));
  assert.equal(Boolean(style.show?.evaluate(feature({ map_id: 1, lith: "plutonic: undivided granitic rocks" }))), true);
  assert.equal(Boolean(style.show?.evaluate(feature({ map_id: 2, lith: "sedimentary" }))), false);
  assert.equal(Boolean(style.show?.evaluate(feature({ map_id: 3, lith: "sandstone and basalt" }))), false);
});
