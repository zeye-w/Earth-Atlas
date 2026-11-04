import test from "node:test";
import assert from "node:assert/strict";
import { pickHighlights, MAX_HIGHLIGHTS } from "../src/highlights.ts";
import { ENGLISH } from "../src/locales/en.ts";
import { parseBatch } from "../worker/statsCore.ts";

const H = 3_600_000, NOW = Date.parse("2026-11-04T12:00:00Z");
const storm = (id, alert, windKt, extra = {}) => ({
  id, name: id.toUpperCase(), source: "JTWC", alert, countries: [], maxWindKmh: null, advisory: NOW, cone: null, swaths: [], report: null,
  track: [{ time: NOW - 12 * H, latitude: 15, longitude: 130, windKt }, { time: NOW, latitude: 16, longitude: 129, windKt }], forecast: [], ...extra,
});
const launch = (id, hours, extra = {}) => ({ id, name: id, mission: id, missionType: "", description: "", orbit: "", rocket: "Falcon 9", provider: "SpaceX",
  status: "go", statusName: "Go", net: NOW + hours * H, precision: "time", windowStart: null, windowEnd: null, padId: "1", pad: "SLC-40",
  location: "Cape Canaveral", country: "US", latitude: 28.5, longitude: -80.5, webcast: false, ...extra });
const quake = (id, magnitude, hoursAgo) => ({ id, magnitude, magnitudeType: "mww", place: "Somewhere", time: new Date(NOW - hoursAgo * H), depthKm: 10, longitude: 0, latitude: 0, url: null, tsunami: false });
const input = (over = {}) => ({ hazards: { v: 1, fetched: NOW, events: [], storms: [] }, launches: { v: 1, fetched: NOW, launches: [] }, quakes: [], kp: 2, now: NOW, ...over });

test("a quiet day still offers the evergreen highlights", () => {
  assert.deepEqual(pickHighlights(input()).map((h) => h.kind), ["terminator", "iss"]);
  // Every source down: the same fallbacks, no crash.
  assert.deepEqual(pickHighlights({ hazards: null, launches: null, quakes: null, kp: null, now: NOW }).map((h) => h.kind), ["terminator", "iss"]);
});

test("notable events are ranked: red cyclone, big quake, storm, launch, volcano", () => {
  const picks = pickHighlights(input({
    hazards: { v: 1, fetched: NOW, storms: [storm("weak", "green", 40), storm("champi", "red", 120)],
      events: [{ id: "v1", title: "Etna", category: "volcanoes", time: NOW - 24 * H, latitude: 37.7, longitude: 15, source: "SIVolcano", url: null }] },
    launches: { v: 1, fetched: NOW, launches: [launch("later", 30), launch("soon", 5), launch("rough", 2, { precision: "day" })] },
    quakes: [quake("small", 5.0, 2), quake("big", 7.1, 3), quake("old", 7.8, 30)],
    kp: 6.3,
  }));
  assert.equal(picks.length, MAX_HIGHLIGHTS);
  assert.deepEqual(picks.map((h) => h.kind), ["storm", "quake", "aurora", "launch"]);
  assert.equal(picks[0].storm.id, "champi");
  assert.equal(picks[1].quake.id, "big");
  // The next launch with an exact time, not one known only to the day.
  assert.equal(picks[3].launch.id, "soon");
});

test("storms need an alert or strong-typhoon winds, and must be active now", () => {
  const strong = storm("strong", null, 90);
  const ended = storm("ended", "red", 120, { track: [{ time: NOW - 48 * H, latitude: 15, longitude: 130, windKt: 120 }, { time: NOW - 30 * H, latitude: 16, longitude: 129, windKt: 120 }] });
  const kinds = pickHighlights(input({ hazards: { v: 1, fetched: NOW, events: [], storms: [storm("weak", "green", 50), strong, ended] } }));
  assert.deepEqual(kinds.filter((h) => h.kind === "storm").map((h) => h.storm.id), ["strong"]);
});

test("a launch more than a week away, small quakes and quiet geomagnetism are not highlights", () => {
  const picks = pickHighlights(input({ launches: { v: 1, fetched: NOW, launches: [launch("far", 24 * 9)] }, quakes: [quake("m5", 5.4, 1)], kp: 4.7 }));
  assert.deepEqual(picks.map((h) => h.kind), ["terminator", "iss"]);
  // A launch within the week fills in on a quiet day, ahead of the evergreens.
  assert.deepEqual(pickHighlights(input({ launches: { v: 1, fetched: NOW, launches: [launch("week", 24 * 4)] } })).map((h) => h.kind), ["launch", "terminator", "iss"]);
});

test("highlight copy has English text and clicks are counted by the statistics", () => {
  for (const key of ["今日看点", "火箭发射", "地震", "极光", "昼夜", "空间站", "地磁暴 · Kp {0}", "此刻的晨昏线", "国际空间站此刻在哪"]) assert.ok(ENGLISH[key], key);
  const batch = parseBatch({ visitor: "abcdef12", session: "abcdef34", lang: "zh", device: "desktop", events: [{ name: "highlight", detail: "storm" }] });
  assert.deepEqual(batch.events, [{ name: "highlight", detail: "storm" }]);
});
