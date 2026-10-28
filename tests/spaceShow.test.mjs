import assert from "node:assert/strict";
import { test } from "node:test";
import { cameraRange, GIANT_SCALE, planCenter, planDuration, planError, siteDelay, siteDistance, SPACE_STAR_BUDGET, starStride } from "../src/fireworks/spacePlan.ts";
import { createFireworkShow, particleAt } from "../src/fireworks/physics.ts";

const beijing = { label: "北京", longitude: 116.4074, latitude: 39.9042, kind: "fireworks" };
const tokyo = { label: "东京", longitude: 139.6503, latitude: 35.6762, kind: "rocket" };
test("regional plans accept nearby cities and reject unsupported/duplicate locations", () => {
  assert.equal(planError([beijing, tokyo]), null);
  assert.match(planError([]), /至少/);
  assert.match(planError([beijing, beijing]), /已经/);
  assert.match(planError([beijing, { ...tokyo, longitude: NaN }]), /无效/);
  assert.match(planError([beijing, { ...tokyo, longitude: 181 }]), /无效/);
  assert.match(planError([beijing, { ...tokyo, longitude: 2.35, latitude: 48.86 }]), /4000/);
  assert.match(planError(Array.from({ length: 7 }, (_, i) => ({ ...beijing, longitude: 116 + i / 10 }))), /6/);
});
test("date-line plans have a local center rather than jumping to Greenwich", () => {
  const sites = [179, -179].map(longitude => ({ ...beijing, longitude, latitude: 10 }));
  assert.equal(planError(sites), null);
  const center = planCenter(sites);
  assert.ok(Math.abs(center.longitude) > 179.9);
  assert.ok(Math.abs(center.latitude - 10) < 0.01);
  assert.ok(siteDistance(sites[0], sites[1]) < 230_000);
});
test("relay timing gives every site its full show and sync has no offset", () => {
  for (let i = 0; i < 6; i++) { assert.equal(siteDelay(i, false), 0); assert.equal(siteDelay(i, true), i * 3); }
  assert.equal(planDuration(6, false), 48);
  assert.equal(planDuration(6, true), 63);
});
test("framing widens for mobile, scales with regional extent and clamps zoom", () => {
  const desktop = cameraRange(1_000_000, Math.PI / 3, 1.6, 1);
  assert.ok(cameraRange(1_000_000, Math.PI / 3, 0.46, 1) > desktop);
  assert.ok(cameraRange(1_500_000, Math.PI / 3, 1.6, 1) > desktop);
  assert.ok(cameraRange(1_000_000, Math.PI / 3, 1.6, 1.5) < desktop);
  assert.equal(cameraRange(1_000_000, Math.PI / 3, 1.6, 100), cameraRange(1_000_000, Math.PI / 3, 1.6, 1.8));
});
test("giant fireworks occupy real three-dimensional distances while retaining a bounded particle budget", () => {
  const show = createFireworkShow("bloom");
  // Each site draws every stride-th star, within the per-site budget.
  assert.ok(Math.ceil(show.particles.length / starStride(show.particles.length, false)) <= SPACE_STAR_BUDGET);
  assert.ok(Math.ceil(show.particles.length / starStride(show.particles.length, true)) <= SPACE_STAR_BUDGET / 2);
  assert.ok(show.bursts.every(b => b.height * GIANT_SCALE > 100_000));
  const p = show.particles[0];
  const initial = particleAt(p, p.start), later = particleAt(p, p.start + 1);
  assert.ok(Math.hypot(later.east - initial.east, later.north - initial.north, later.height - initial.height) * GIANT_SCALE > 10_000);
  assert.equal(particleAt(p, p.start + p.life + 1), null);
});
