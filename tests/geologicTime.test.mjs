import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyGeologicEra, ERA_GUIDE } from "../src/geologicTime.ts";

test("broad ICS era guide requires both valid bounds", () => {
  assert.equal(classifyGeologicEra(0, 20).key, "cenozoic");
  assert.equal(classifyGeologicEra(66, 72.1).key, "mesozoic");
  assert.equal(classifyGeologicEra(300, 420).key, "paleozoic");
  assert.equal(classifyGeologicEra(650, 1800).key, "precambrian");
});

test("straddling boundaries, missing values and invalid ranges are unclassified", () => {
  assert.equal(classifyGeologicEra(65, 70).key, "unknown");
  assert.equal(classifyGeologicEra(240, 270).key, "unknown");
  assert.equal(classifyGeologicEra(null, 70).key, "unknown");
  assert.equal(classifyGeologicEra(500, 200).key, "unknown");
  assert.equal(classifyGeologicEra(66, 66).key, "unknown");
  assert.equal(classifyGeologicEra(0, 5000).key, "unknown");
});

test("era legend has unique category IDs and legible labels", () => {
  assert.deepEqual(ERA_GUIDE.map((x) => x.key), ["cenozoic", "mesozoic", "paleozoic", "precambrian"]);
  assert.ok(ERA_GUIDE.every((x) => x.label.includes(" / ")));
});
