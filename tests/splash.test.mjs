import assert from "node:assert/strict";
import { test } from "node:test";
import { splashProgress, TileProgress } from "../src/splash.ts";

test("loading stages fill the bar in order and imagery completes it", () => {
  assert.equal(splashProgress("engine"), 0);
  assert.ok(splashProgress("globe") > splashProgress("engine"));
  assert.ok(splashProgress("imagery", 0) >= splashProgress("globe"));
  assert.equal(splashProgress("imagery", 1), 1);
  assert.equal(splashProgress("imagery", 7), 1);
  assert.equal(splashProgress("imagery", Number.NaN), splashProgress("imagery", 0));
});

test("tile progress measures the queue against its largest size", () => {
  const tiles = new TileProgress();
  assert.equal(tiles.update(0), 0);
  assert.equal(tiles.update(40), 0);
  assert.equal(tiles.update(10), 0.75);
  assert.equal(tiles.update(0), 1);
  assert.equal(tiles.update(-3), 0);
});
