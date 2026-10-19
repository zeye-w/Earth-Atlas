import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { kpLevel, parseKpHistory, parseKpNow } from "../src/geomagnetic.ts";
import { formatEruptionYear, gvpUrl, isRecentlyActive } from "../src/volcanoData.ts";
import { AUTO_QUALITY_MIN_FPS, FrameRateMonitor, lowerRenderQuality } from "../src/performance.ts";

// Synthetic NOAA-shaped rows for parser tests only (NOT real Kp values).
test("current Kp comes from the latest valid 1-minute sample", () => {
  const sample = parseKpNow([
    { time_tag: "2026-10-19T06:00:00", kp_index: 2, estimated_kp: 2.33, kp: "2P" },
    { time_tag: "2026-10-19T06:01:00", kp_index: 3, estimated_kp: 3.67, kp: "4M" },
    { time_tag: "bad", estimated_kp: 9 },
  ]);
  assert.equal(sample.kp, 3.67);
  assert.equal(sample.time.toISOString(), "2026-10-19T06:01:00.000Z");
  assert.throws(() => parseKpNow([]));
});

test("Kp history accepts the header-table and object forms", () => {
  const table = parseKpHistory([
    ["time_tag", "Kp", "a_running", "station_count"],
    ["2026-10-19 03:00:00.000", "2.67", "12", "8"],
    ["2026-10-19 00:00:00.000", "5.33", "56", "8"],
  ]);
  assert.deepEqual(table.map((s) => s.kp), [5.33, 2.67], "sorted by time");
  const objects = parseKpHistory([{ time_tag: "2026-10-19T00:00:00", Kp: 1.0 }]);
  assert.equal(objects[0].kp, 1);
  assert.throws(() => parseKpHistory([["foo", "bar"], ["x", "1"]]));
});

test("Kp levels follow the NOAA G scale", () => {
  assert.equal(kpLevel(1.3).storm, null);
  assert.equal(kpLevel(4.3).label, "活跃");
  assert.equal(kpLevel(5).storm, "G1");
  assert.equal(kpLevel(7.7).storm, "G3");
  assert.equal(kpLevel(9).storm, "G5");
});

test("bundled GVP volcano list is complete and well formed", () => {
  const data = JSON.parse(readFileSync(new URL("../src/data/volcanoes.json", import.meta.url), "utf8"));
  assert.match(data.source, /Global Volcanism Program/);
  assert.match(data.retrieved, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(data.volcanoes.length > 1000);
  for (const v of data.volcanoes) {
    assert.ok(Math.abs(v.lon) <= 180 && Math.abs(v.lat) <= 90, v.name);
    assert.equal(typeof v.name, "string");
  }
  const etna = data.volcanoes.find((v) => v.name === "Etna");
  assert.ok(etna && etna.country === "Italy");
});

test("volcano helpers format years and flag recent eruptions", () => {
  const now = new Date("2026-10-19T00:00:00Z");
  const base = { id: 211060, name: "Test", country: "", type: "", elevation: null, lon: 0, lat: 0 };
  assert.equal(isRecentlyActive({ ...base, lastEruption: 2024 }, now), true);
  assert.equal(isRecentlyActive({ ...base, lastEruption: 1708 }, now), false);
  assert.equal(isRecentlyActive({ ...base, lastEruption: null }, now), false);
  assert.equal(formatEruptionYear(-8300), "公元前 8300 年");
  assert.equal(formatEruptionYear(2024), "2024 年");
  assert.equal(gvpUrl({ ...base, lastEruption: null }), "https://volcano.si.edu/volcano.cfm?vn=211060");
});

test("frame-rate monitor ignores idle gaps and reports sustained rates", () => {
  const monitor = new FrameRateMonitor();
  let t = 1000;
  let fps = null;
  for (let i = 0; i < 200 && fps === null; i++) fps = monitor.addFrame((t += 50)); // 20 fps
  assert.ok(fps !== null && Math.abs(fps - 20) < 0.5);
  assert.ok(fps < AUTO_QUALITY_MIN_FPS);
  monitor.reset();
  // On-demand renders seconds apart never form a window.
  let idle = null;
  for (let i = 0; i < 200; i++) idle = monitor.addFrame((t += 2000)) ?? idle;
  assert.equal(idle, null);
  // A struggling device (~4 fps) is still measured.
  monitor.reset();
  let slow = null;
  for (let i = 0; i < 200 && slow === null; i++) slow = monitor.addFrame((t += 250));
  assert.ok(slow !== null && Math.abs(slow - 4) < 0.2);
  assert.equal(lowerRenderQuality("high"), "balanced");
  assert.equal(lowerRenderQuality("balanced"), "eco");
  assert.equal(lowerRenderQuality("eco"), null);
});
