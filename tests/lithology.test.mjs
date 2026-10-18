import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLithologyDictionary, classifyLithologies } from "../src/lithology.ts";

const example = { success: { v: 2, license: "CC-BY 4.0", data: [
  { lith_id: 7, name: "Sandstone", class: "sedimentary" },
  { lith_id: 10, name: "Mudstone", class: "sedimentary" },
  { lith_id: 8, name: "Basalt", class: "igneous" },
  { lith_id: 9, name: "Gneiss", class: "metamorphic" },
  { lith_id: 12, name: "Uncertain type", class: "unknown class" },
] } };

test("Macrostrat v2 lithology lexicon IDs, names and classes", () => {
  const dict = parseLithologyDictionary(example);
  assert.equal(dict.size, 5);
  assert.equal(dict.get(7)?.name, "Sandstone");
  assert.equal(dict.get(8)?.rockClass, "igneous");
  assert.equal(dict.get(12)?.rockClass, "unclassified");
});

test("normalize multiple lithologies without inferring from free text", () => {
  const dict = parseLithologyDictionary(example);
  const result = classifyLithologies([7, 10, 7], dict);
  assert.deepEqual(result.names, ["Sandstone", "Mudstone"]);
  assert.equal(result.rockClass, "sedimentary");
  assert.equal(result.matchedCount, 2);
});

test("mixed classes remain mixed and unrecognized IDs must not be classified", () => {
  const dict = parseLithologyDictionary(example);
  assert.equal(classifyLithologies([7, 8], dict).rockClass, "mixed");
  assert.equal(classifyLithologies([7, 999], dict).rockClass, "unclassified");
  assert.deepEqual(classifyLithologies([7, 999], dict).missingIds, [999]);
  assert.equal(classifyLithologies([12], dict).rockClass, "unclassified");
  assert.equal(classifyLithologies([7], null).rockClass, "unclassified");
});

test("never accept API metadata or empty dictionary as lithology definitions", () => {
  assert.throws(() => parseLithologyDictionary({ success: { v: 2, options: {} } }), /Unexpected/);
  assert.throws(() => parseLithologyDictionary({ success: { data: [] } }), /Empty/);
});
