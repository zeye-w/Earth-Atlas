import assert from "node:assert/strict";
import { test } from "node:test";
import { FAR_ENTER_M, FAR_EXIT_M, farViewFor, isFarView, onFarView, setFarView } from "../src/farView.ts";

test("the far view switches on beyond 100,000 km and off inside 80,000 km", () => {
  assert.equal(farViewFor(20_000_000, false), false);
  assert.equal(farViewFor(FAR_ENTER_M + 1, false), true);
  // Between the two thresholds the current state holds (no flicker).
  assert.equal(farViewFor(90_000_000, false), false);
  assert.equal(farViewFor(90_000_000, true), true);
  assert.equal(farViewFor(FAR_EXIT_M - 1, true), false);
});

test("listeners hear each change once", () => {
  const heard = [];
  const off = onFarView((far) => heard.push(far));
  setFarView(true); setFarView(true); setFarView(false);
  off();
  setFarView(true);
  assert.deepEqual(heard, [true, false]);
  assert.equal(isFarView(), true);
  setFarView(false);
});
