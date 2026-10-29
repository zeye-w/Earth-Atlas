import test from "node:test";
import assert from "node:assert/strict";
import {
  cmaLevel, gdacsKeyTime, mergeStorms, parseEonet, parseGdacsGeometry, parseGdacsList, parseHazardSnapshot,
  saffirSimpsonLevel, stormAt, stormMotion, stormName, stormPath,
} from "../src/hazardData.ts";
import { stormDisplayName, typhoonChineseName } from "../src/typhoonNames.ts";
import { ENGLISH } from "../src/locales/en.ts";

const H = 3_600_000;
// Shapes as returned by EONET v3 and the GDACS API (trimmed from real responses, October 2026).
const eonet = {
  events: [
    { id: "EONET_25729", title: "Tropical Cyclone Arnab", categories: [{ id: "severeStorms" }], sources: [{ id: "JTWC", url: "https://www.metoc.navy.mil/jtwc/products/io0226.tcw" }],
      geometry: [
        { magnitudeValue: 35, magnitudeUnit: "kts", date: "2026-10-25T18:00:00Z", type: "Point", coordinates: [89.3, 15.6] },
        { magnitudeValue: 120, magnitudeUnit: "kts", date: "2026-10-27T12:00:00Z", type: "Point", coordinates: [82.7, 16.3] },
        { magnitudeValue: 65, magnitudeUnit: "kts", date: "2026-10-28T00:00:00Z", type: "Point", coordinates: [81.6, 16.2] },
      ] },
    { id: "EONET_1", title: "Prescribed Fire 123, Oregon", categories: [{ id: "wildfires" }], sources: [{ id: "IRWIN", url: "https://irwin.doi.gov/observer/" }],
      geometry: [{ date: "2026-10-27T10:00:00Z", type: "Point", coordinates: [-122.1, 44.2] }] },
    { id: "EONET_2", title: "Iceberg D28", categories: [{ id: "seaLakeIce" }], sources: [{ id: "NATICE", url: "https://usicecenter.gov/" }],
      geometry: [{ date: "2026-10-01T00:00:00Z", type: "Point", coordinates: [-30, -60] }, { date: "2026-10-20T00:00:00Z", type: "Point", coordinates: [-31, -61] }] },
    { id: "EONET_3", title: "Dust over Arabia", categories: [{ id: "dustHaze" }], sources: [],
      geometry: [{ date: "2026-10-26T00:00:00Z", type: "Polygon", coordinates: [[[40, 20], [50, 20], [50, 30], [40, 30], [40, 20]]] }] },
    { id: "EONET_4", title: "Unknown thing", categories: [{ id: "alienInvasion" }], geometry: [{ date: "2026-10-26T00:00:00Z", type: "Point", coordinates: [0, 0] }] },
    { id: "EONET_5", title: "Broken", categories: [{ id: "wildfires" }], geometry: [{ date: "nope", type: "Point", coordinates: [0, 0] }] },
  ],
};
const gdacsList = { features: [
  { properties: { eventtype: "TC", eventid: 1001345, eventname: "ARNAB-26", iscurrent: "true", alertlevel: "Red", source: "JTWC", fromdate: "2026-10-26T00:00:00",
    affectedcountries: [{ countryname: "India" }], severitydata: { severity: 222.22, severityunit: "km/h" },
    url: { geometry: "https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1001345&episodeid=10", report: "https://www.gdacs.org/report.aspx?eventid=1001345" } } },
  { properties: { eventtype: "TC", eventid: 1001338, eventname: "CHAMPI-26", iscurrent: "true", alertlevel: "Orange", source: "JTWC", fromdate: "2026-10-14T12:00:00",
    country: "Philippines, Guam, Japan", affectedcountries: [], severitydata: { severity: 296.29, severityunit: "km/h" },
    url: { geometry: "https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1001338&episodeid=46" } } },
  { properties: { eventtype: "TC", eventid: 999, eventname: "OLD-25", iscurrent: "false", alertlevel: "Green" } },
  { properties: { eventtype: "EQ", eventid: 5, iscurrent: "true" } },
] };
const circle = (lon, lat) => ({ type: "Polygon", coordinates: [[[lon - 0.1, lat], [lon, lat + 0.1], [lon + 0.1, lat], [lon, lat - 0.1], [lon - 0.1, lat]]] });
const champiGeometry = { features: [
  { geometry: { type: "Point", coordinates: [140, 13] }, properties: { Class: "Point_Centroid" } },
  ...[["10251200", 127.4, 31.17], ["10251800", 130.5, 31.87], ["10260600", 135.0, 32.57], ["10261800", 139.0, 33.5]].map(([key, lon, lat]) => ({
    geometry: circle(lon, lat), properties: { Class: "Point_Polygon_Point_1", key, polygondate: "2026-10-25T18:00:00" } })),
  { geometry: { type: "Polygon", coordinates: [[[127, 31], [131, 30], [136, 31], [136, 34], [131, 33], [127, 32], [127, 31]]] }, properties: { Class: "Poly_Cones" } },
  { geometry: { type: "Polygon", coordinates: [[[127, 30], [133, 30], [133, 33], [127, 33], [127, 30]]] }, properties: { Class: "Poly_Green" } },
  { geometry: { type: "MultiPolygon", coordinates: [[[[128, 31], [130, 31], [130, 32], [128, 32], [128, 31]]]] }, properties: { Class: "Poly_Red" } },
] };

test("EONET events and storm tracks are separated and trimmed", () => {
  const { events, tracks } = parseEonet(eonet);
  assert.deepEqual(events.map((e) => e.id), ["EONET_1", "EONET_3", "EONET_2"]);
  // The latest observation stands for the event; polygons by their centre.
  assert.equal(events.find((e) => e.id === "EONET_2").longitude, -31);
  const dust = events.find((e) => e.id === "EONET_3");
  assert.deepEqual([dust.longitude, dust.latitude], [45, 25]);
  assert.equal(events[0].url, "https://irwin.doi.gov/observer/");
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].name, "Arnab");
  assert.deepEqual(tracks[0].track.map((p) => p.windKt), [35, 120, 65]);
  assert.throws(() => parseEonet({ title: "nothing" }));
});

test("GDACS lists only current cyclones, with alert, countries and wind", () => {
  const storms = parseGdacsList(gdacsList);
  assert.deepEqual(storms.map((s) => [s.name, s.alert]), [["ARNAB", "red"], ["CHAMPI", "orange"]]);
  assert.deepEqual(storms[0].countries, ["India"]);
  assert.deepEqual(storms[1].countries, ["Philippines", "Guam", "Japan"]);
  assert.equal(Math.round(storms[1].maxWindKmh), 296);
  assert.equal(storms[1].report, null);
});

test("GDACS keys become times in the right year, also across New Year", () => {
  assert.equal(gdacsKeyTime("10181800", Date.parse("2026-10-14T12:00:00Z")), Date.parse("2026-10-18T18:00:00Z"));
  assert.equal(gdacsKeyTime("01020600", Date.parse("2026-12-30T00:00:00Z")), Date.parse("2027-01-02T06:00:00Z"));
  assert.equal(gdacsKeyTime("bad", 0), null);
});

test("GDACS geometry gives fixes, cone and wind swaths", () => {
  const g = parseGdacsGeometry(champiGeometry, Date.parse("2026-10-14T12:00:00Z"));
  assert.equal(g.points.length, 4);
  assert.equal(g.points[0].time, Date.parse("2026-10-25T12:00:00Z"));
  assert.ok(Math.abs(g.points[0].longitude - 127.4) < 1e-6 && Math.abs(g.points[0].latitude - 31.17) < 1e-6);
  assert.equal(g.advisory, Date.parse("2026-10-25T18:00:00Z"));
  assert.equal(g.cone.length, 7);
  assert.deepEqual(g.swaths.map((w) => w.level), ["green", "red"]);
});

test("storms merge EONET's observed track with GDACS's forecast", () => {
  const list = parseGdacsList(gdacsList);
  const { tracks } = parseEonet(eonet);
  const champi = parseGdacsGeometry(champiGeometry, list[1].from);
  const storms = mergeStorms([{ storm: list[0], geometry: null }, { storm: list[1], geometry: champi }], tracks);
  const arnab = storms.find((s) => s.name === "Arnab");
  assert.equal(arnab.id, "gdacs-1001345");
  assert.equal(arnab.alert, "red");
  assert.equal(arnab.track.length, 3);
  assert.equal(arnab.forecast.length, 0);
  // No EONET track: GDACS fixes up to the advisory are observed, later ones forecast.
  const ch = storms.find((s) => s.name === "CHAMPI");
  assert.deepEqual(ch.track.map((p) => p.time), [Date.parse("2026-10-25T12:00:00Z"), Date.parse("2026-10-25T18:00:00Z")]);
  assert.equal(ch.forecast.length, 2);
  assert.ok(ch.cone && ch.swaths.length === 2);
  // An EONET-only storm is kept without alert or forecast.
  const lone = mergeStorms([], tracks);
  assert.equal(lone[0].id, "eonet-EONET_25729");
  assert.equal(lone[0].alert, null);
});

test("the snapshot check keeps valid data and drops the rest", () => {
  const { events, tracks } = parseEonet(eonet);
  const snapshot = { v: 1, fetched: 1, events, storms: mergeStorms([], tracks) };
  assert.deepEqual(parseHazardSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
  const broken = { ...snapshot, events: [...events, { id: "x", category: "wildfires", time: 1, latitude: 99, longitude: 0 }], storms: [...snapshot.storms, { id: "y", track: [] }] };
  const checked = parseHazardSnapshot(broken);
  assert.equal(checked.events.length, events.length);
  assert.equal(checked.storms.length, 1);
  assert.throws(() => parseHazardSnapshot({ error: "Hazard data unavailable" }));
});

test("intensity scales: CMA grades by m/s, Saffir–Simpson by knots", () => {
  assert.equal(cmaLevel(30).key, "td");       // 15.4 m/s
  assert.equal(cmaLevel(35).key, "ts");       // 18.0 m/s
  assert.equal(cmaLevel(50).key, "sts");      // 25.7 m/s
  assert.equal(cmaLevel(65).key, "ty");       // 33.4 m/s
  assert.equal(cmaLevel(85).key, "sty");      // 43.7 m/s
  assert.equal(cmaLevel(100).key, "superty"); // 51.4 m/s
  assert.equal(cmaLevel(null).key, "unknown");
  assert.equal(saffirSimpsonLevel(33).key, "td");
  assert.equal(saffirSimpsonLevel(64).key, "c1");
  assert.equal(saffirSimpsonLevel(120).key, "c4");
  assert.equal(saffirSimpsonLevel(160).key, "c5");
  for (const label of ["热带低压", "热带风暴", "强热带风暴", "台风", "强台风", "超强台风", "强度未知"]) assert.ok(ENGLISH[label], label);
});

test("storm position follows the track and its forecast through time", () => {
  const storm = {
    track: [
      { time: 0, latitude: 15, longitude: 179, windKt: 50 },
      { time: 6 * H, latitude: 16, longitude: -179, windKt: 70 },
    ],
    forecast: [{ time: 12 * H, latitude: 17, longitude: -177, windKt: null }],
  };
  assert.equal(stormAt(storm, -2 * H), null);
  assert.equal(stormAt(storm, 14 * H), null);
  // Across the antimeridian the short way, not round the globe.
  const mid = stormAt(storm, 3 * H);
  assert.ok(Math.abs(mid.latitude - 15.5) < 1e-9);
  assert.ok(Math.abs(Math.abs(mid.longitude) - 180) < 1e-9);
  assert.equal(mid.windKt, 50);
  assert.equal(mid.forecast, false);
  const ahead = stormAt(storm, 9 * H);
  assert.equal(ahead.forecast, true);
  assert.equal(ahead.windKt, 70);
  assert.ok(Math.abs(ahead.longitude - -178) < 1e-9);
  assert.equal(stormPath(storm)[1].longitude, 181);
  const motion = stormMotion(storm, 3 * H);
  assert.ok(motion.heading > 45 && motion.heading < 90, String(motion.heading));
  assert.ok(motion.speedKmh > 30 && motion.speedKmh < 50, String(motion.speedKmh));
});

test("storm names: prefixes dropped, Chinese names for western Pacific typhoons", () => {
  assert.equal(stormName("Super Typhoon Champi"), "Champi");
  assert.equal(stormName("Tropical Storm Olana"), "Olana");
  assert.equal(stormName("IN-FA-26"), "IN-FA");
  assert.equal(typhoonChineseName("CHAMPI"), "蔷琵");
  assert.equal(typhoonChineseName("In-fa"), "烟花");
  assert.equal(typhoonChineseName("Arnab"), null);
  assert.equal(stormDisplayName("CHAMPI", "zh"), "蔷琵（Champi）");
  assert.equal(stormDisplayName("CHAMPI", "en"), "Champi");
  assert.equal(stormDisplayName("Arnab", "zh"), "Arnab");
});

test("the Worker builds a snapshot and keeps going when a feed fails", async () => {
  const { buildHazards } = await import("../worker/hazards.ts");
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.startsWith("https://eonet.gsfc.nasa.gov/")) return new Response(JSON.stringify(eonet), { headers: { "Content-Type": "application/rss+xml" } });
      if (u.includes("geteventlist")) return new Response(JSON.stringify(gdacsList));
      if (u.includes("eventid=1001338")) return new Response(JSON.stringify(champiGeometry));
      return new Response("nope", { status: 500 });
    };
    const snapshot = await buildHazards(Date.parse("2026-10-29T00:00:00Z"));
    assert.equal(snapshot.events.length, 3);
    assert.deepEqual(snapshot.storms.map((s) => s.name).sort(), ["Arnab", "CHAMPI"]);
    // GDACS down: EONET alone still gives events and observed tracks.
    globalThis.fetch = async (url) => String(url).startsWith("https://eonet") ? new Response(JSON.stringify(eonet)) : new Response("", { status: 503 });
    const partial = await buildHazards();
    assert.equal(partial.storms.length, 1);
    assert.equal(partial.storms[0].alert, null);
    globalThis.fetch = async () => new Response("", { status: 503 });
    await assert.rejects(buildHazards());
  } finally { globalThis.fetch = original; }
});
