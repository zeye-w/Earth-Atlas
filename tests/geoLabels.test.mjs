import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { maxLabelDistance, minLabelDistance, spacedName } from "../src/geoLabelData.ts";

const labels = JSON.parse(readFileSync(new URL("../src/data/geoLabels.json", import.meta.url), "utf8"));

test("bundled geographic labels are complete and well-formed", () => {
  const kinds = new Set(labels.map((label) => label.kind));
  assert.deepEqual([...kinds].sort(), ["ocean", "range", "sea", "strait"]);
  for (const label of labels) {
    assert.ok(label.tier === 1 || label.tier === 2, label.name);
    assert.ok(Math.abs(label.longitude) <= 180 && Math.abs(label.latitude) <= 90, label.name);
    assert.match(label.name, /^[一-鿿]+$/, "simplified Chinese name only: " + label.name);
  }
  const names = labels.filter((label) => label.kind !== "ocean").map((label) => label.name);
  assert.equal(new Set(names).size, names.length, "no duplicate sea, strait or range names");
});

test("well-known features sit where they belong", () => {
  const near = (name, lon, lat, tolerance) => {
    const label = labels.find((l) => l.name === name);
    assert.ok(label, name);
    assert.ok(Math.abs(label.longitude - lon) <= tolerance && Math.abs(label.latitude - lat) <= tolerance, name + " at " + label.longitude + "," + label.latitude);
  };
  near("马六甲海峡", 100.5, 3.5, 2);
  near("直布罗陀海峡", -5.6, 35.9, 1);
  near("台湾海峡", 119.5, 24, 1.5);
  near("喜马拉雅山脉", 84, 28.5, 4);
  near("南海", 114, 13, 4);
  near("渤海", 120, 38.8, 1.5);
});

test("smaller features only show when the camera is closer", () => {
  assert.ok(maxLabelDistance({ kind: "ocean", tier: 1 }) > maxLabelDistance({ kind: "sea", tier: 1 }));
  assert.ok(maxLabelDistance({ kind: "sea", tier: 1 }) > maxLabelDistance({ kind: "sea", tier: 2 }));
  assert.ok(maxLabelDistance({ kind: "strait", tier: 1 }) > maxLabelDistance({ kind: "strait", tier: 2 }));
  assert.ok(minLabelDistance({ kind: "ocean" }) > 0 && minLabelDistance({ kind: "strait" }) === 0);
  assert.equal(spacedName({ kind: "ocean", name: "太平洋" }), "太 平 洋");
  assert.equal(spacedName({ kind: "strait", name: "琼州海峡" }), "琼州海峡");
});
