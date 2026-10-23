import assert from "node:assert/strict";
import { test } from "node:test";
import { Cartesian3 } from "cesium";
import { arc, packetProgress, packetSeconds } from "../src/internet/internetOverlay.ts";

test("a longer round trip flies visibly slower", () => {
  assert.ok(packetSeconds(10) < packetSeconds(100));
  assert.ok(packetSeconds(100) < packetSeconds(300));
  assert.equal(packetSeconds(5000), packetSeconds(600));
});

test("a packet goes out, comes back, rests, and repeats", () => {
  const flow = { probeId: 0, rttMs: 40 };
  const leg = packetSeconds(40);
  assert.equal(packetProgress(flow, 0), 0);
  assert.ok(Math.abs(packetProgress(flow, leg / 2) - 0.5) < 1e-9);
  assert.ok(Math.abs(packetProgress(flow, leg * 1.5) - 0.5) < 1e-9);
  assert.equal(packetProgress(flow, leg * 2 + 0.1), null);
  const period = 2 * leg + 1.5;
  assert.equal(packetProgress(flow, period + leg / 2), packetProgress(flow, leg / 2));
});

test("arcs join the two points and rise above the surface between them", () => {
  const path = arc([2.35, 48.86], [114.17, 22.32]);
  const ends = [Cartesian3.fromDegrees(2.35, 48.86, 5_000), Cartesian3.fromDegrees(114.17, 22.32, 5_000)];
  // Geocentric vs geodetic latitude moves the ends by a few kilometres at most.
  assert.ok(Cartesian3.distance(path[0], ends[0]) < 25_000);
  assert.ok(Cartesian3.distance(path.at(-1), ends[1]) < 25_000);
  // Never below the ellipsoid at either end.
  assert.ok(Cartesian3.magnitude(path[0]) >= Cartesian3.magnitude(Cartesian3.fromDegrees(2.35, 48.86, 0)));
  const middle = Cartesian3.magnitude(path[path.length >> 1]);
  assert.ok(middle > 6_371_000 + 500_000, "long hops arc high");
  const short = arc([2.35, 48.86], [2.4, 48.9]);
  assert.ok(Cartesian3.magnitude(short[16]) < 6_371_000 + 60_000, "short hops stay low");
});
