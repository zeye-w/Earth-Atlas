import assert from "node:assert/strict";
import { test } from "node:test";
import {
  makeThematicStyle, THEMATIC_MAX_ZOOM, AGE_OPTIONS, ROCK_OPTIONS,
} from "../src/mapThematic.ts";

test("global MVT upper zoom bound prevents massive eager tile hierarchy", () => {
  assert.ok(THEMATIC_MAX_ZOOM <= 6, "Global z14 would allocate hundreds of millions of nodes");
  assert.equal(AGE_OPTIONS.length, 5);
  assert.equal(ROCK_OPTIONS.length, 4);
});

test("age conditions consume the verified Macrostrat vector-age property names", () => {
  const style = makeThematicStyle("age", "all", "all");
  assert.match(style.show, /\$\{map_id\}/);
  assert.equal(style.color.conditions.length, 5);
  const predicates = style.color.conditions.map(([x]) => x).join(" ");
  assert.match(predicates, /\$\{best_age_top\}/);
  assert.match(predicates, /\$\{best_age_bottom\}/);
  assert.match(predicates, /251\.902/);
  assert.match(predicates, /538\.8/);
  assert.doesNotMatch(predicates, /@@/);
});

test("era filter only admits fully contained age intervals", () => {
  const style = makeThematicStyle("age", "mesozoic", "all");
  assert.match(style.show, /\$\{best_age_top\} >= 66/);
  assert.match(style.show, /\$\{best_age_bottom\} <= 251\.902/);
  assert.match(style.show, /\$\{best_age_bottom\} >= \$\{best_age_top\}/);
});

test("rock filters use authoritative MVT lith free-text field but remain provisional", () => {
  const style = makeThematicStyle("lithology", "all", "igneous");
  assert.match(style.show, /\$\{lith\}/);
  assert.match(style.show, /regExp/);
  assert.match(style.show, /plutonic/);
  assert.match(style.show, /!\(/);
  const all = makeThematicStyle("lithology", "all", "all");
  assert.ok(all.color.conditions.length >= 4);
  assert.match(all.color.conditions[0][0], /sandstone/);
  assert.match(all.color.conditions[1][0], /granite/);
  assert.match(all.color.conditions[2][0], /gneiss/);
});

test("opacity changes declared 3D Tiles style color alpha", () => {
  const full = makeThematicStyle("age", "all", "all", 1);
  const partial = makeThematicStyle("age", "all", "all", 0.25);
  assert.match(full.color.conditions[0][1], /1\.00/);
  assert.match(partial.color.conditions[0][1], /0\.25/);
});

test("no class is invented from the map unit title in the vector styling path", () => {
  const text = JSON.stringify(makeThematicStyle("lithology", "all", "all"));
  assert.doesNotMatch(text, /\$\{name\}/);
  assert.doesNotMatch(text, /\$\{strat_name\}/);
});
