import assert from "node:assert/strict";
import { test } from "node:test";
import { GROUND_SECONDS, groundPuff, hash, IGNITION_WINDOW, TRAIL_SECONDS, trailPuff } from "../src/fireworks/rocketSmoke.ts";
import { IGNITION_LEAD, ROCKET_COUNTDOWN, ROCKET_DURATION, rocketFrame } from "../src/fireworks/rocketFlight.ts";

const all = (fn, count, t) => Array.from({ length: count }, (_, i) => fn(i, count, t)).filter(Boolean);

test("smoke is deterministic and only exists after ignition", () => {
  for (let i = 0; i < 50; i++) { const h = hash(i, 3); assert.ok(h >= 0 && h < 1); assert.equal(h, hash(i, 3)); }
  assert.deepEqual(all(trailPuff, 140, 12.3), all(trailPuff, 140, 12.3));
  // The engines light IGNITION_LEAD before liftoff; no smoke before that.
  assert.equal(all(trailPuff, 140, ROCKET_COUNTDOWN - IGNITION_LEAD - 0.1).length, 0);
  assert.equal(all(groundPuff, 56, ROCKET_COUNTDOWN - IGNITION_LEAD - 0.1).length, 0);
  // Held down at ignition, the exhaust already billows around the pad.
  assert.ok(all(groundPuff, 56, ROCKET_COUNTDOWN - 0.2).length > 0);
  assert.ok(all(trailPuff, 140, ROCKET_COUNTDOWN + 8).length > 60);
  assert.equal(all(trailPuff, 140, ROCKET_DURATION + 1).length, 0);
});

test("the column overlaps into one plume rather than separate beads", () => {
  for (const t of [ROCKET_COUNTDOWN + 4, ROCKET_COUNTDOWN + 12, ROCKET_COUNTDOWN + 30]) {
    const puffs = all(trailPuff, 140, t).sort((a, b) => b.up - a.up);
    // Consecutive puffs along the column are closer than the smaller one is wide.
    let gaps = 0;
    for (let i = 1; i < puffs.length; i++) {
      const a = puffs[i - 1], b = puffs[i];
      if (Math.hypot(a.east - b.east, a.north - b.north, a.up - b.up) > Math.min(a.size, b.size)) gaps++;
    }
    assert.ok(gaps <= puffs.length * 0.1, `${gaps} gaps of ${puffs.length} at t=${t}`);
  }
});

test("young smoke is hot and small, old smoke cool, wide and faint", () => {
  const t = ROCKET_COUNTDOWN + 15;
  const puffs = all(trailPuff, 140, t);
  const hot = puffs.filter(p => p.heat > 0.5), cool = puffs.filter(p => p.heat === 0);
  assert.ok(hot.length > 0 && cool.length > 0);
  const mean = (list, key) => list.reduce((sum, p) => sum + p[key], 0) / list.length;
  assert.ok(mean(hot, "size") < mean(cool, "size"));
  // Hot puffs are the ones nearest the rocket.
  const rocket = rocketFrame(t), distance = (p) => Math.hypot(rocket.east - p.east, rocket.altitude - p.up);
  assert.ok(Math.max(...hot.map(distance)) < Math.min(...cool.map(distance)));
  for (const p of puffs) assert.ok(p.alpha >= 0 && p.alpha <= 0.5 && p.size > 0 && p.up >= 2);
});

test("the ground cloud is emitted while the flame reaches the pad and spreads outward", () => {
  assert.ok(IGNITION_WINDOW > 1 && IGNITION_WINDOW < 8);
  const early = all(groundPuff, 56, ROCKET_COUNTDOWN + 1), late = all(groundPuff, 56, ROCKET_COUNTDOWN + 12);
  assert.ok(early.length > 0 && late.length === 56);
  const radius = (p) => Math.hypot(p.east, p.north);
  assert.ok(Math.max(...late.map(radius)) > Math.max(...early.map(radius)));
  // Puffs rest on the ground (centre at least 0.42 sizes up) and billow at most ~50 m above that.
  for (const p of late) assert.ok(p.up >= p.size * 0.42 && p.up - p.size * 0.42 < 50 && radius(p) < 300);
  assert.equal(all(groundPuff, 56, ROCKET_COUNTDOWN + IGNITION_WINDOW + GROUND_SECONDS + 0.1).length, 0);
  assert.ok(TRAIL_SECONDS > 0);
});
