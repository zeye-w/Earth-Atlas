import test from "node:test";
import assert from "node:assert/strict";
import { createGlassCalm } from "../src/glassCalm.ts";

test("glass panels turn solid at once and blur again only after the globe has been calm", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const changes = [];
  const calm = createGlassCalm((busy) => changes.push(busy), 800);
  calm.moving(true);
  assert.deepEqual(changes, [true]);
  // While tiles stream, the queue empties and refills many times a second.
  for (let i = 0; i < 20; i++) {
    calm.loading(true);
    t.mock.timers.tick(30);
    calm.loading(false);
    t.mock.timers.tick(30);
  }
  calm.moving(false);
  t.mock.timers.tick(799);
  assert.deepEqual(changes, [true], "no flicker back to blur while streaming");
  t.mock.timers.tick(1);
  assert.deepEqual(changes, [true, false]);
  // A new batch within the calm period cancels the pending return.
  calm.loading(true);
  calm.loading(false);
  t.mock.timers.tick(400);
  calm.loading(true);
  t.mock.timers.tick(5_000);
  assert.deepEqual(changes, [true, false, true]);
  calm.loading(false);
  calm.dispose();
  t.mock.timers.tick(5_000);
  assert.deepEqual(changes, [true, false, true]);
});
