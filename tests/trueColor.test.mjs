import assert from "node:assert/strict";
import { test } from "node:test";
import { trueColorDate, trueColorUrl } from "../src/trueColorData.ts";
import { quakesAt } from "../src/earthquakeData.ts";

test("true colour shows yesterday for today or the future, else the moment's UTC day", () => {
  const now = new Date("2026-10-20T05:00:00Z");
  assert.equal(trueColorDate(now, now), "2026-10-19");
  assert.equal(trueColorDate(new Date("2026-10-20T23:00:00Z"), now), "2026-10-19");
  assert.equal(trueColorDate(new Date("2026-10-19T23:59:00Z"), now), "2026-10-19");
  assert.equal(trueColorDate(new Date("2026-10-01T00:30:00Z"), now), "2026-10-01");
  assert.match(trueColorUrl("2026-10-19"), /\/VIIRS_NOAA20_CorrectedReflectance_TrueColor\/default\/2026-10-19\/GoogleMapsCompatible_Level9\/\{z\}\/\{y\}\/\{x\}\.jpg$/);
});

test("earthquake replay shows events up to the moment and flags missing coverage", () => {
  const now = Date.UTC(2026, 9, 20);
  const quake = (hoursAgo) => ({ time: new Date(now - hoursAgo * 3_600_000) });
  const quakes = [quake(1), quake(10), quake(30)];
  assert.equal(quakesAt(quakes, "week", now - 5 * 3_600_000, now).shown.length, 2);
  assert.equal(quakesAt(quakes, "day", now - 5 * 3_600_000, now).covered, true);
  assert.equal(quakesAt(quakes, "day", now - 30 * 3_600_000, now).covered, false);
});
