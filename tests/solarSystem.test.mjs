import assert from "node:assert/strict";
import { test } from "node:test";
import { AU_KM, eclipticRing, ECLIPTIC_NORTH, fromEarth, helio, length, orbit, planetsNow, sunFromEarth } from "../src/astronomy/solarSystem.ts";

const T = Date.UTC(2026, 10, 19);
const au = (v) => length(v) / AU_KM;

test("planets are at their known distances from the Sun", () => {
  for (const [key, lo, hi] of [["Mercury", 0.30, 0.47], ["Venus", 0.71, 0.73], ["Earth", 0.98, 1.02], ["Mars", 1.38, 1.67], ["Jupiter", 4.95, 5.46], ["Saturn", 9.0, 10.1], ["Uranus", 18.2, 20.1], ["Neptune", 29.8, 30.4], ["Pluto", 29.6, 49.4]]) {
    const d = au(helio(key, T));
    assert.ok(d >= lo && d <= hi, `${key} at ${d.toFixed(2)} AU`);
  }
  // Seen from the Earth's centre, the Sun is the Earth's heliocentric position reversed.
  assert.ok(Math.abs(au(sunFromEarth(T)) - au(helio("Earth", T))) < 1e-12);
  // Earth-centred = heliocentric minus the Earth's.
  const m = fromEarth("Mars", T), h = helio("Mars", T), e = helio("Earth", T);
  assert.ok(Math.abs(m[0] - (h[0] - e[0])) < 1e-3);
});

test("an orbit closes on itself after one period", () => {
  const o = orbit("Mars", T);
  assert.equal(o.length, 361);
  assert.ok(length([o[0][0] - o[360][0], o[0][1] - o[360][1], o[0][2] - o[360][2]]) / AU_KM < 0.01);
});

test("belt rings lie in the ecliptic plane", () => {
  for (const p of eclipticRing(3)) {
    assert.ok(Math.abs(p[0] * ECLIPTIC_NORTH[0] + p[1] * ECLIPTIC_NORTH[1] + p[2] * ECLIPTIC_NORTH[2]) < 1e-3);
    assert.ok(Math.abs(au(p) - 3) < 1e-9);
  }
});

test("visibility follows the elongation from the Sun", () => {
  const now = planetsNow(T);
  assert.equal(now.length, 8);
  for (const p of now) {
    if (p.elongation < 15) assert.equal(p.visibility, "hidden");
    else if (p.elongation > 135) assert.equal(p.visibility, "night");
    else assert.ok(p.visibility === "morning" || p.visibility === "evening");
  }
  // Jupiter is bright (around magnitude −2).
  assert.ok(now.find((p) => p.key === "Jupiter").magnitude < -1.5);
});
