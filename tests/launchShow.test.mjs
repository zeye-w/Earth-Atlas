import test from "node:test";
import assert from "node:assert/strict";
import { COUNTDOWN_SECONDS, IGNITION_TIME, PRELAUNCH_SECONDS, prelaunch, SHOW_DURATION, showFrame, VENT_SECONDS, ventPuff } from "../src/fireworks/launchSequence.ts";
import { ROCKET_DURATION, rocketFrame } from "../src/fireworks/rocketFlight.ts";
import { ARM_HINGE, launchComplex, MAST_HEIGHT, TOWER } from "../src/fireworks/launchComplex.ts";
import { clearingStyle } from "../src/fireworks/cityContext.ts";
import { LAUNCH_SITES } from "../src/launchSites.ts";
import { planError } from "../src/fireworks/spacePlan.ts";
import { getSpaceState } from "../src/fireworks/spaceState.ts";
import { ENGLISH } from "../src/locales/en.ts";

const all = (count, t) => Array.from({ length: count }, (_, i) => ventPuff(i, count, t)).filter(Boolean);

test("the ground show counts down from T−10 with the rocket waiting on the pad", () => {
  assert.equal(COUNTDOWN_SECONDS, 10);
  assert.equal(SHOW_DURATION, PRELAUNCH_SECONDS + ROCKET_DURATION);
  assert.equal(showFrame(0).countdown, 10);
  assert.equal(showFrame(0.2).countdown, 10);
  assert.equal(showFrame(9.2).countdown, 1);
  for (const t of [0, 3, 6.9, IGNITION_TIME - 0.01]) {
    const frame = showFrame(t);
    assert.equal(frame.phase, "countdown");
    assert.equal(frame.thrust, false);
    assert.equal(frame.altitude, 0);
  }
  assert.equal(showFrame(IGNITION_TIME).phase, "ignition");
  assert.equal(showFrame(COUNTDOWN_SECONDS).phase, "liftoff");
  // After the prelude the flight is rocketFrame shifted by the prelude.
  assert.deepEqual({ ...showFrame(PRELAUNCH_SECONDS + 12), countdown: 0 }, { ...rocketFrame(12), countdown: 0 });
  assert.equal(showFrame(SHOW_DURATION).phase, "complete");
  assert.deepEqual(showFrame(NaN), showFrame(0));
});

test("arms swing clear and venting stops before ignition", () => {
  assert.equal(prelaunch(0).arms, 0);
  assert.equal(prelaunch(COUNTDOWN_SECONDS - 6).arms, 0);
  assert.equal(prelaunch(COUNTDOWN_SECONDS - 3.5).arms, 1);
  assert.equal(prelaunch(0).vent, 1);
  assert.equal(prelaunch(IGNITION_TIME).vent, 0);
  // Arms are monotonic.
  let previous = 0;
  for (let t = 0; t < COUNTDOWN_SECONDS; t += 0.1) { const arms = prelaunch(t).arms; assert.ok(arms >= previous); previous = arms; }
});

test("the prelude camera orbit ends exactly on the flight camera at liftoff", () => {
  const start = prelaunch(0), end = prelaunch(COUNTDOWN_SECONDS);
  assert.ok(start.heading < -1 && start.range < 500);
  assert.ok(Math.abs(end.heading) < 1e-9);
  assert.ok(Math.abs(end.pitch - -0.025) < 1e-9);
  assert.ok(Math.abs(end.range - 650) < 1e-9);
});

test("vent vapour leaves the rocket's side, sinks and drifts, and is gone by ignition", () => {
  assert.deepEqual(all(44, 2.3), all(44, 2.3));
  const puffs = all(44, 4);
  assert.ok(puffs.length > 30);
  for (const p of puffs) {
    assert.ok(Math.hypot(p.east, p.north) >= 6, "outside the rocket body");
    assert.ok(p.alpha >= 0 && p.alpha <= 0.45 && p.size > 0 && p.heat === 0);
  }
  assert.equal(all(44, IGNITION_TIME + VENT_SECONDS).length, 0);
  assert.equal(all(44, COUNTDOWN_SECONDS + 5).length, 0);
});

test("the launch complex stands clear of the rocket and its flight path", () => {
  const { pad, arms, lights } = launchComplex();
  assert.ok(pad.length > 60 && arms.length === 4 && lights.length > 4);
  // Tower and masts are away from the rocket (radius 6, boosters to 12 m east and west).
  assert.ok(Math.hypot(TOWER.east, TOWER.north) - TOWER.half > 12);
  assert.equal(ARM_HINGE.x, TOWER.east + TOWER.half);
  assert.ok(lights.every(l => Math.hypot(l.east, l.north) > 12 && l.up <= MAST_HEIGHT + 10));
  // Arms reach from the tower face to just outside the rocket, above the boosters' tops (54 m).
  for (const arm of arms) assert.ok(arm.offset.x < -6 && arm.offset.x > ARM_HINGE.x && arm.offset.z > 54);
});

test("city buildings near a launch pad are hidden", () => {
  const site = { longitude: -80.6041, latitude: 28.6083 };
  const style = clearingStyle(site, 320);
  const feature = (dEast, dNorth) => {
    const properties = {
      "cesium#longitude": site.longitude + dEast / (111_320 * Math.cos(site.latitude * Math.PI / 180)),
      "cesium#latitude": site.latitude + dNorth / 111_320,
    };
    return { getProperty: (name) => properties[name], getPropertyInherited: (name) => properties[name], hasProperty: (name) => name in properties };
  };
  assert.equal(style.show.evaluate(feature(100, 100)), false);
  assert.equal(style.show.evaluate(feature(0, 300)), false);
  assert.equal(style.show.evaluate(feature(0, 340)), true);
  assert.equal(style.show.evaluate(feature(-500, 0)), true);
});

test("launch sites are real coordinates with English names, and the default space show uses one", () => {
  const ids = new Set();
  for (const site of LAUNCH_SITES) {
    assert.ok(!ids.has(site.id)); ids.add(site.id);
    assert.ok(Math.abs(site.latitude) <= 90 && Math.abs(site.longitude) <= 180);
    assert.ok(ENGLISH[site.label], site.label);
  }
  const state = getSpaceState();
  assert.equal(planError(state.sites), null);
  for (const site of state.sites.filter(s => s.kind === "rocket")) {
    assert.ok(LAUNCH_SITES.some(pad => pad.latitude === site.latitude && pad.longitude === site.longitude), site.label);
  }
});
