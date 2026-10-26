import assert from "node:assert/strict";
import { test } from "node:test";
import { createFireworkShow, particleAt } from "../src/fireworks/physics.ts";

test("all firework styles have three bounded volleys and a finite lifetime", () => {
  for (const style of ["bloom", "ring", "willow"]) {
    const show = createFireworkShow(style);
    assert.equal(show.bursts.length, 3);
    assert.ok(show.particles.length <= 3 * 84);
    assert.ok(show.duration > 6 && show.duration < 10);
    assert.ok(show.particles.every((p) => p.life > 2 && p.life < 5));
  }
});

test("the same style and seed reproduce identical particles", () => {
  assert.deepEqual(createFireworkShow("ring", 42), createFireworkShow("ring", 42));
  assert.notDeepEqual(createFireworkShow("ring", 42), createFireworkShow("ring", 43));
});

test("particle positions are local, continuous and disappear after lifetime", () => {
  const particle = createFireworkShow("bloom", 10).particles[0];
  assert.equal(particleAt(particle, particle.start - 0.01), null);
  assert.equal(particleAt(particle, particle.start + particle.life), null);
  const origin = particleAt(particle, particle.start);
  assert.ok(origin);
  assert.equal(origin.east, particle.east);
  assert.equal(origin.north, particle.north);
  assert.equal(origin.height, particle.height);
  const middle = particleAt(particle, particle.start + particle.life / 2);
  const end = particleAt(particle, particle.start + particle.life - 0.01);
  assert.ok(middle && end);
  assert.ok(Number.isFinite(end.height));
  assert.ok(end.opacity < middle.opacity);
});

test("falling particles disappear at the ground rather than collecting at a clamped height", () => {
  const particle = { ...createFireworkShow("willow", 42).particles[0], start: 0, height: 10, vu: 0, gravity: 20, life: 4 };
  assert.ok(particleAt(particle, 0.99)?.height > 0);
  assert.equal(particleAt(particle, 1), null);
  assert.equal(particleAt(particle, 2), null);
  for (const style of ["bloom", "ring", "willow"]) {
    for (const p of createFireworkShow(style, 42).particles) {
      for (let t = p.start; t < p.start + p.life; t += 0.2) {
        const sample = particleAt(p, t);
        assert.ok(sample === null || sample.height > 0);
      }
    }
  }
});
