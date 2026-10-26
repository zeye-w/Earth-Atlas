import assert from "node:assert/strict";
import { test } from "node:test";
import { createFireworkShow, particleAt } from "../src/fireworks/physics.ts";
import { sparkFade, sparkWake } from "../src/fireworks/showVisuals.ts";

test("continuous spark ribbons run from older positions to the live star", () => {
  const p = createFireworkShow("bloom").particles[0];
  const time = p.start + 1;
  const wake = sparkWake(p, time, 7, 0.6);
  assert.equal(wake.length, 7);
  assert.deepEqual(wake[0], particleAt(p, time - 0.6));
  assert.deepEqual(wake.at(-1), particleAt(p, time));
  assert.ok(wake.every(point => point.height > 0 && Object.values(point).every(Number.isFinite)));
});
test("ribbons have a fixed vertex budget and no zero-age or expired ghosts", () => {
  const p = createFireworkShow("willow").particles[0];
  for (const time of [p.start - 1, p.start, p.start + p.life, NaN]) assert.deepEqual(sparkWake(p, time, 7, 0.8), []);
  assert.equal(sparkWake(p, p.start + 1, 1000, 0.8).length, 10);
  assert.equal(sparkWake(p, p.start + 1, 1, 0.8).length, 2);
  assert.deepEqual(sparkWake(p, p.start + 1, 7, NaN), []);
});
test("volley light fades continuously and never sends invalid alpha to the renderer", () => {
  assert.equal(sparkFade(-1, 4), 1);
  assert.equal(sparkFade(1, 4), 1);
  assert.ok(sparkFade(3, 4) < 1 && sparkFade(3, 4) > sparkFade(3.5, 4));
  assert.equal(sparkFade(4, 4), 0);
  assert.equal(sparkFade(10, 4), 0);
  assert.equal(sparkFade(NaN, 4), 0);
  assert.equal(sparkFade(0, 0), 0);
});
