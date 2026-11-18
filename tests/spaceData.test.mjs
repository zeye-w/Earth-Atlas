import assert from "node:assert/strict";
import { test } from "node:test";
import { asteroidAt, diameterRange, distanceLabel, lightTimeLabel, parseSpaceSnapshot, probeAt, sizeLabel, LUNAR_DISTANCE_KM, AU_KM } from "../src/spaceData.ts";

const H = 3_600_000, T = Date.parse("2026-11-22T04:20:00Z");
const snapshot = () => ({
  v: 1, fetched: T - 4 * 24 * H,
  asteroids: [
    { id: "2026 WJ", name: "(2026 WJ)", approach: T, distanceKm: 645_000, distanceRangeKm: [643_000, 647_000], speedKms: 9.2, h: 27.1, diameterM: null,
      track: [[T + H, 10, 0, 0], [T - H, -10, 0, 0], [T, 0, 0, 0]] },
    { id: "bad", name: "no track" },
  ],
  probes: [
    { id: -170, key: "jwst", time: T, position: [384_897, 1_580_682, 402_378], velocity: [-0.1, 0.08, -0.05], sunDistanceKm: 1.49e8 },
    { id: -1, key: "unknown", time: T, position: [0, 0, 0], velocity: [0, 0, 0], sunDistanceKm: 1 },
  ],
});

test("the snapshot parses, dropping malformed rows and unknown probes", () => {
  const s = parseSpaceSnapshot(snapshot());
  assert.equal(s.asteroids.length, 1);
  assert.deepEqual(s.asteroids[0].track.map((p) => p[0]), [T - H, T, T + H]);
  assert.deepEqual(s.probes.map((p) => p.key), ["jwst"]);
  assert.throws(() => parseSpaceSnapshot({ v: 2 }));
});

test("positions along a track and along a probe's velocity", () => {
  const a = parseSpaceSnapshot(snapshot()).asteroids[0];
  assert.deepEqual(asteroidAt(a, T + H / 2), [5, 0, 0]);
  assert.equal(asteroidAt(a, T + 2 * H), null);
  const p = parseSpaceSnapshot(snapshot()).probes[0];
  assert.deepEqual(probeAt(p, T + 10_000), [384_896, 1_580_682.8, 402_377.5]);
});

test("sizes from absolute magnitude, distances and light time read naturally", () => {
  const [lo, hi] = diameterRange(27.1);
  assert.ok(lo > 8 && lo < 11 && hi > 20 && hi < 24, `${lo}–${hi}`);
  assert.equal(sizeLabel({ h: 27.1, diameterM: null }), "约 10–23 m");
  assert.equal(sizeLabel({ h: 19, diameterM: 1200 }), "约 1.2 km");
  assert.equal(distanceLabel(1.68 * LUNAR_DISTANCE_KM), "645,789 公里");
  assert.equal(distanceLabel(1.5e6 * 2), "300 万公里");
  assert.equal(distanceLabel(169 * AU_KM), "169 天文单位");
  assert.equal(lightTimeLabel(384_400), "1.3 秒");
  assert.equal(lightTimeLabel(169 * AU_KM), "23 小时 26 分");
});
