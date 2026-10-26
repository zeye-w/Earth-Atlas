import assert from "node:assert/strict";
import { test } from "node:test";
import { Cartesian3, Material, PrimitiveCollection } from "cesium";
import { RibbonCollection } from "../src/fireworks/visualMaterials.ts";

test("shared ribbon material is released once when its parent viewer primitives are destroyed", () => {
  const material = new Material({ fabric: { type: "TestRibbonOwnership", uniforms: { opacity: 1 }, components: { emission: "vec3(1.0)", alpha: "opacity" } } });
  const lines = new RibbonCollection();
  for (let i = 0; i < 12; i++) lines.add({ positions: [Cartesian3.ZERO, Cartesian3.UNIT_X], material });
  const parent = new PrimitiveCollection();
  parent.add(lines);
  assert.doesNotThrow(() => parent.destroy());
  assert.equal(lines.isDestroyed(), true);
  assert.equal(material.isDestroyed(), true);
});
