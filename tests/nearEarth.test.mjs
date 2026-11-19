import assert from "node:assert/strict";
import { test } from "node:test";
import { altitudeLabel, dipoleFrame, earthMoonLagrange, EARTH_RADIUS_KM, equatorialRing, fieldLine, GEOMAGNETIC_NORTH, lShellAltitudeKm, orbitPoints, REFERENCE_ORBITS, rulerPosition } from "../src/nearEarth.ts";

const len = (v) => Math.hypot(...v);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("orbits have their real size and inclination", () => {
  const geo = equatorialRing(35_786);
  for (const p of geo) { near(len(p), EARTH_RADIUS_KM + 35_786, 1e-6, "GEO radius"); near(p[2], 0, 1e-6, "GEO in the equator"); }
  const iss = orbitPoints(REFERENCE_ORBITS.find((o) => o.key === "iss"), 0);
  near(Math.max(...iss.map((p) => Math.asin(p[2] / len(p)) * 180 / Math.PI)), 51.6, 0.1, "ISS reaches 51.6°");
  const molniya = orbitPoints(REFERENCE_ORBITS.find((o) => o.key === "molniya"), 0, 720);
  const radii = molniya.map(len);
  near(Math.min(...radii), EARTH_RADIUS_KM + 500, 1, "perigee");
  near(Math.max(...radii), EARTH_RADIUS_KM + 39_700, 5, "apogee");
  // Apogee (argument of perigee 270°) is over the north.
  assert.ok(molniya[radii.indexOf(Math.max(...radii))][2] > 0);
});

test("radiation belt field lines follow the tilted dipole", () => {
  const [e1, e2, e3] = dipoleFrame();
  for (const [a, b] of [[e1, e2], [e1, e3], [e2, e3]]) near(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], 0, 1e-9, "orthogonal");
  near(Math.asin(e3[2]) * 180 / Math.PI, GEOMAGNETIC_NORTH.latitude, 1e-9, "axis latitude");
  const line = fieldLine(4.5, 0);
  // Highest at the magnetic equator, 4.5 Earth radii out; both ends near the surface.
  near(Math.max(...line.map(len)), 4.5 * EARTH_RADIUS_KM, 5, "equatorial crossing");
  near(len(line[0]), 1.02 * EARTH_RADIUS_KM, 1, "footpoint");
  near(len(line.at(-1)), 1.02 * EARTH_RADIUS_KM, 1, "other footpoint");
  near(lShellAltitudeKm(1.6), 3_823, 1, "inner belt heart altitude");
});

test("Earth–Moon Lagrange points lie where the restricted three-body problem puts them", () => {
  const moon = [384_400, 0, 0], v = [0, 1.02, 0];
  const L = earthMoonLagrange(moon, v);
  near(L.L1[0], 326_366, 100, "L1");
  near(L.L2[0], 448_979, 100, "L2");
  near(L.L3[0], -386_322, 100, "L3");
  near(len(L.L4), 384_400, 1, "L4 at the Moon's distance");
  assert.ok(L.L4[1] > 0 && L.L5[1] < 0, "L4 leads, L5 trails");
});

test("the ruler's log scale and labels", () => {
  assert.equal(rulerPosition(100), 0);
  assert.equal(rulerPosition(2_000_000), 1);
  assert.ok(rulerPosition(420) < rulerPosition(35_786) && rulerPosition(35_786) < rulerPosition(384_400));
  assert.equal(altitudeLabel(420), "420 km");
  assert.equal(altitudeLabel(35_786), "3.6 万 km");
  assert.equal(altitudeLabel(384_400), "38 万 km");
  assert.equal(altitudeLabel(1_500_000, "en"), "1.5 million km");
});
