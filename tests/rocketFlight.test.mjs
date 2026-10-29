import assert from "node:assert/strict";
import { test } from "node:test";
import { IGNITION_LEAD, rocketFrame, ROCKET_DURATION } from "../src/fireworks/rocketFlight.ts";

test("rocket counts down, lights its engines held on the pad, then lifts off at three seconds", () => {
  for (const t of [-1, 0, 1, 1.49]) {
    const frame = rocketFrame(t);
    assert.equal(frame.phase, "countdown");
    assert.equal(frame.altitude, 0);
    assert.equal(frame.thrust, false);
  }
  // Ignition IGNITION_LEAD seconds early: thrust on, still on the pad.
  for (const t of [3 - IGNITION_LEAD, 2.5, 2.99]) {
    const frame = rocketFrame(t);
    assert.equal(frame.phase, "ignition");
    assert.equal(frame.thrust, true);
    assert.equal(frame.altitude, 0);
  }
  assert.equal(rocketFrame(3).phase, "liftoff");
  assert.equal(rocketFrame(3).thrust, true);
  assert.ok(rocketFrame(3.5).altitude > 0);
  assert.equal(rocketFrame(9).phase, "ascent");
});
test("the bounded illustrative trajectory rises continuously and turns smoothly", () => {
  let previous = rocketFrame(3);
  for (let t = 3.1; t < ROCKET_DURATION; t += 0.1) {
    const frame = rocketFrame(t);
    assert.ok(frame.altitude > previous.altitude);
    assert.ok(frame.east >= previous.east);
    assert.ok(frame.tilt >= 0 && frame.tilt < Math.PI / 2);
    assert.ok(Object.values(frame).filter(v => typeof v === "number").every(Number.isFinite));
    previous = frame;
  }
  const end = rocketFrame(ROCKET_DURATION);
  assert.ok(end.altitude > 50_000 && end.altitude < 55_000);
  assert.equal(end.phase, "complete");
  assert.equal(end.thrust, false);
  assert.deepEqual(rocketFrame(ROCKET_DURATION + 1000), end);
  assert.deepEqual(rocketFrame(NaN), rocketFrame(0));
});
