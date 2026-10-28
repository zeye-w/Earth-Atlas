import assert from "node:assert/strict";
import { test } from "node:test";
import { createFireworkShow, particleAt } from "../src/fireworks/physics.ts";

test("all firework styles have three solo shells, a three-shell finale and a finite lifetime", () => {
  for (const style of ["bloom", "ring", "willow"]) {
    const show = createFireworkShow(style);
    assert.equal(show.bursts.length, 6);
    assert.equal(new Set(show.bursts.slice(3).map((b) => b.start)).size, 1, "the finale fires together");
    assert.ok(show.bursts.slice(0, 3).every((b, i, solo) => i === 0 || b.start > solo[i - 1].start));
    assert.ok(show.particles.length <= 3 * 84 + 3 * 56);
    assert.ok(show.particles.every((p) => show.bursts[p.burst].start === p.start));
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
  const particle = { ...createFireworkShow("willow", 42).particles[0], start: 0, height: 10, vu: 0, gravity: 20, drag: 0, life: 4 };
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

test("drag makes stars burst fast, then slow and stay within speed / drag", () => {
  for (const style of ["bloom", "ring", "willow"]) {
    for (const p of createFireworkShow(style, 7).particles) {
      const at = (dt) => particleAt(p, p.start + dt);
      const spread = (s) => Math.hypot(s.east - p.east, s.north - p.north);
      const early = spread(at(0.2)) / 0.2, late = (spread(at(1.2)) - spread(at(1.0))) / 0.2;
      assert.ok(late < early * 0.5, "horizontal speed falls off");
      const horizontal = Math.hypot(p.ve, p.vn);
      for (let t = 0; t < p.life; t += 0.25) {
        const s = at(t);
        if (s) assert.ok(spread(s) <= horizontal / p.drag + 1e-6);
      }
    }
  }
});

test("stars leave the burst white-hot and cool to their colour", () => {
  const p = createFireworkShow("bloom", 3).particles[0];
  assert.equal(particleAt(p, p.start).heat, 1);
  assert.ok(particleAt(p, p.start + 0.1).heat > 0);
  assert.equal(particleAt(p, p.start + 0.5).heat, 0);
});

test("twinkling dims a star only in the second half of its life", () => {
  const p = { ...createFireworkShow("willow", 5).particles.find((x) => x.twinkle), height: 500 };
  const plain = { ...p, twinkle: false };
  for (let t = 0; t < p.life * 0.5; t += 0.01) assert.equal(particleAt(p, p.start + t).opacity, particleAt(plain, p.start + t).opacity);
  let dimmed = 0;
  for (let t = p.life * 0.5; t < p.life; t += 0.01) {
    const a = particleAt(p, p.start + t), b = particleAt(plain, p.start + t);
    if (a.opacity < b.opacity) dimmed++;
  }
  assert.ok(dimmed > 5);
});
