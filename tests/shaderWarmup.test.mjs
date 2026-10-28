import assert from "node:assert/strict";
import { test } from "node:test";
import { onShowWarmup, requestShowWarmup } from "../src/fireworks/shaderWarmup.ts";

test("show warm-up is requested once and reaches late subscribers", () => {
  let early = 0, late = 0;
  const removeEarly = onShowWarmup(() => early++);
  requestShowWarmup();
  requestShowWarmup();
  assert.equal(early, 1);
  // A viewer created after the request (e.g. after a WebGL context loss) still warms up.
  const removeLate = onShowWarmup(() => late++);
  assert.equal(late, 1);
  removeEarly(); removeLate();
});
