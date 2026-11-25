import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, closeViewDistanceKm, hasSphere, moonFrame, moonPositions, MOONS, PLANET_FACTS, planetFrame } from "../src/astronomy/planetBodies.ts";
import { length } from "../src/astronomy/solarSystem.ts";

const T = Date.UTC(2026, 10, 19);
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} not within ${tol} of ${b}`);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test("each planet's frame puts its z axis on its north pole and is a rotation", () => {
  for (const key of Object.keys(PLANET_FACTS)) {
    const { body, equator, north } = planetFrame(key, T);
    for (const m of [body, equator]) {
      const z = apply(m, [0, 0, 1]);
      near(dot(z, north), 1, 1e-9, `${key} pole`);
      const x = apply(m, [1, 0, 0]), y = apply(m, [0, 1, 0]);
      near(length(x), 1, 1e-12, `${key} unit`); near(dot(x, y), 0, 1e-12, `${key} orthogonal`);
    }
  }
  // Known poles (J2000 declination): Jupiter ~64.5°, Uranus ~-15.2° (tilted over), Saturn ~83.5°.
  near(Math.asin(planetFrame("Jupiter", T).north[2]) * 180 / Math.PI, 64.5, 0.2, "Jupiter pole dec");
  near(Math.asin(planetFrame("Uranus", T).north[2]) * 180 / Math.PI, -15.2, 0.2, "Uranus pole dec");
  near(Math.asin(planetFrame("Saturn", T).north[2]) * 180 / Math.PI, 83.5, 0.2, "Saturn pole dec");
});

test("the prime meridian turns once a day (Mars: ~24.6 h)", () => {
  const x0 = apply(planetFrame("Mars", T).body, [1, 0, 0]);
  const x1 = apply(planetFrame("Mars", T + 24.623 * 3_600_000).body, [1, 0, 0]);
  near(dot(x0, x1), 1, 1e-3, "one sol later");
  const half = apply(planetFrame("Mars", T + 12.31 * 3_600_000).body, [1, 0, 0]);
  near(dot(x0, half), -1, 1e-2, "half a sol later");
});

test("moons are at their distances, in their planet's equator", () => {
  for (const key of ["Mars", "Jupiter", "Saturn", "Neptune", "Pluto"]) {
    const { north } = planetFrame(key, T);
    for (const { moon, position } of moonPositions(key, T)) {
      near(length(position), moon.distance, moon.distance * 0.06, moon.key);
      if (moon.approximate) near(dot(position, north) / moon.distance, 0, 1e-9, `${moon.key} equatorial`);
    }
  }
  assert.equal(moonPositions("Venus", T).length, 0);
  // Jupiter's four from a theory, Charon from Pluto's rotation.
  assert.equal(MOONS.filter((m) => !m.approximate).length, 5);
});

test("Charon sits over Pluto's prime meridian, and Pluto turns once per Charon orbit", () => {
  const charon = (t) => moonPositions("Pluto", t).find((m) => m.moon.key === "charon").position;
  const { body } = planetFrame("Pluto", T);
  const x = [body[0], body[3], body[6]];
  near(dot(charon(T), x) / 19_591, 1, 1e-9, "on the prime meridian");
  // Half a Charon period later, it is on the other side.
  near(dot(charon(T + 3.1936 * 86_400_000), charon(T)) / 19_591 ** 2, -1, 2e-3, "half an orbit");
});

test("moons with a map keep their prime meridian toward the planet", () => {
  for (const moon of MOONS.filter((m) => m.texture)) {
    const f = moonFrame(moon, T);
    const x = [f[0], f[3], f[6]], y = [f[1], f[4], f[7]], z = [f[2], f[5], f[8]];
    const r = moonPositions(moon.planet, T).find((m) => m.moon.key === moon.key).position;
    near(dot(x, r) / length(r), -1, 1e-9, moon.key + " faces its planet");
    for (const [a, b] of [[x, y], [y, z], [z, x]]) near(dot(a, b), 0, 1e-9, moon.key + " orthogonal");
    for (const v of [x, y, z]) near(length(v), 1, 1e-9, moon.key + " unit");
  }
  assert.deepEqual(MOONS.filter((m) => m.texture).map((m) => m.key).sort(), ["callisto", "charon", "europa", "ganymede", "io", "titan", "triton"]);
});

test("close views show the whole disc and the rings", () => {
  assert.ok(hasSphere("Jupiter") && hasSphere("Pluto") && !hasSphere("Earth"));
  assert.deepEqual(Object.keys(PLANET_FACTS).filter((k) => PLANET_FACTS[k].ring), ["Saturn", "Uranus"]);
  for (const [key, facts] of Object.entries(PLANET_FACTS)) {
    const d = closeViewDistanceKm(key);
    assert.ok(d > 5 * (facts.ring?.outer ?? facts.radius) / 1.2 && d < 12 * facts.radius, key);
  }
});
