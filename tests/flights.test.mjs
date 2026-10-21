import test from "node:test";
import assert from "node:assert/strict";
import { ADSB_LOL_URL, MAX_EXTRAPOLATION_S, OPENSKY_URL, altitudeBand, decodeFlights, describeFlight, extrapolate, parseAdsbLol, parseOpenSky } from "../src/flightData.ts";

// Synthetic records in the shape of the real feeds (not real aircraft).
const NOW_S = 1_792_561_960;
const readsb = {
  now: NOW_S + 0.5,
  aircraft: [
    { hex: "ABC123", flight: "TST101  ", r: "B-0001", t: "A20N", category: "A3", lat: 31.123456, lon: 121.654321, alt_baro: 35000, alt_geom: 36000, gs: 450, track: 271.6, seen_pos: 2.25 },
    { hex: "def456", flight: "TST202", t: "B738", lat: 40, lon: -73, alt_baro: "ground", gs: 12, track: 90, seen_pos: 1 },
    { hex: "stale1", lat: 10, lon: 10, alt_baro: 30000, seen_pos: 75 },
    { hex: "veh001", category: "C2", lat: 51.47, lon: -0.45, alt_baro: "ground", seen_pos: 0 },
    { hex: "nopos1", alt_baro: 30000 },
    { hex: "baro01", lat: -33.9, lon: 151.2, alt_baro: 10000, true_heading: 45.4 },
  ],
};

test("adsb.lol: units, ground, fallbacks and filtering", () => {
  const snapshot = parseAdsbLol(readsb);
  assert.equal(snapshot.source, "adsb.lol");
  assert.equal(snapshot.time, (NOW_S + 0.5) * 1000);
  assert.deepEqual(snapshot.aircraft.map((a) => a[0]), ["abc123", "def456", "baro01"]);
  const [cruise, ground, baro] = snapshot.aircraft;
  // Geometric altitude preferred: 36,000 ft = 10,973 m; 450 kt = 231.5 m/s.
  assert.deepEqual(cruise, ["abc123", "TST101", 31.1235, 121.6543, 10973, 231.5, 272, "A20N", "B-0001", 2.3]);
  assert.equal(ground[4], null);
  assert.equal(baro[4], 3048);
  assert.equal(baro[6], 45);
  assert.equal(baro[5], null);
  assert.throws(() => parseAdsbLol({ ac: [] }));
});

test("OpenSky: state vectors to the same tuples", () => {
  const snapshot = parseOpenSky({
    time: NOW_S,
    states: [
      ["abc123", "TST101  ", "Testland", NOW_S - 4, NOW_S, 121.5, 31.2, 10500, false, 230.4, 271.2, 0, null, 10700, "1234", false, 0],
      ["def456", "", "Testland", NOW_S - 2, NOW_S, -73, 40, null, true, 5, 90, null, null, null, null, false, 0],
      ["old001", "OLD", "Testland", NOW_S - 300, NOW_S, 0, 0, 9000, false, 200, 10, 0, null, 9100, null, false, 0],
      ["nopos1", "NOP", "Testland", null, NOW_S, null, null, 9000, false, 200, 10, 0, null, null, null, false, 0],
    ],
  });
  assert.equal(snapshot.source, "opensky");
  assert.equal(snapshot.time, NOW_S * 1000);
  assert.deepEqual(snapshot.aircraft, [
    ["abc123", "TST101", 31.2, 121.5, 10700, 230.4, 271, "", "", 4],
    ["def456", "", 40, -73, null, 5, 90, "", "", 2],
  ]);
  assert.deepEqual(parseOpenSky({ time: NOW_S, states: null }).aircraft, []);
});

test("decode: report time from the snapshot time and age", () => {
  const { flights, source, time } = decodeFlights(parseAdsbLol(readsb));
  assert.equal(source, "adsb.lol");
  assert.equal(flights[0].reportedAt, time - 2300);
  assert.equal(flights[0].callsign, "TST101");
  assert.throws(() => decodeFlights({ error: "Flight data unavailable" }));
});

test("dead reckoning along the track, capped, airborne only", () => {
  const east = { latitude: 0, longitude: 0, speed: 250, track: 90, altitude: 10000 };
  const moved = extrapolate(east, 100);
  // 25 km east along the equator.
  assert.ok(Math.abs(moved.longitude - 25_000 / 6_371_008.8 * 180 / Math.PI) < 1e-9);
  assert.ok(Math.abs(moved.latitude) < 1e-9);
  assert.deepEqual(extrapolate(east, 1000), extrapolate(east, MAX_EXTRAPOLATION_S));
  assert.deepEqual(extrapolate({ ...east, altitude: null }, 100), { latitude: 0, longitude: 0 });
  // Across the antimeridian the longitude wraps.
  assert.ok(extrapolate({ ...east, longitude: 179.9 }, 120).longitude < -179);
  const north = extrapolate({ ...east, track: 0 }, 40);
  assert.ok(north.latitude > 0.08 && Math.abs(north.longitude) < 1e-9);
});

test("altitude bands and the click summary", () => {
  assert.deepEqual([null, 0, 2999, 3000, 8999, 9000].map(altitudeBand), ["ground", "low", "low", "mid", "mid", "high"]);
  const [flight] = decodeFlights(parseAdsbLol(readsb)).flights;
  assert.equal(describeFlight(flight, flight.reportedAt + 12_400), "TST101 · A20N B-0001 · 高度 10,973 m · 地速 833 km/h · 航向 272° · 12 秒前的位置报告");
  assert.equal(describeFlight({ ...flight, callsign: "", registration: "", type: "", altitude: null, speed: null, track: null }, flight.reportedAt), "ABC123 · 地面 · 0 秒前的位置报告");
});

/** A fresh copy of the Worker module (it caches in module state). */
const loadWorker = async () => (await import("../worker/index.ts?" + Math.random())).default;
const many = (n) => ({ now: NOW_S, aircraft: Array.from({ length: n }, (_, i) => ({ hex: "t" + i, lat: i / 100, lon: i / 100, alt_baro: 30000, gs: 400, track: 10, seen_pos: 1 })) });

async function withFetch(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return handler(String(url)); };
  try { await run(calls); } finally { globalThis.fetch = original; }
}
const request = (path, method = "GET") => new Request("https://earth-atlas.example" + path, { method });
const assets = { ASSETS: { fetch: async () => new Response("static") } };

test("worker: proxies adsb.lol with an identifying User-Agent and caches", async () => {
  const worker = await loadWorker();
  await withFetch(() => Response.json(many(300)), async (calls) => {
    const first = await worker.fetch(request("/api/flights"), assets);
    assert.equal(first.status, 200);
    assert.match(first.headers.get("cache-control"), /max-age=20/);
    const body = await first.json();
    assert.equal(body.source, "adsb.lol");
    assert.equal(body.aircraft.length, 300);
    await worker.fetch(request("/api/flights"), assets);
    assert.equal(calls.length, 1, "second request served from memory");
    assert.equal(calls[0].url, ADSB_LOL_URL);
    assert.match(new Headers(calls[0].init.headers).get("user-agent"), /^TerraScope\/.*github\.com/);
  });
});

test("worker: falls back to OpenSky, then fails without inventing data", async () => {
  const worker = await loadWorker();
  const states = Array.from({ length: 150 }, (_, i) => ["s" + i, "", "", NOW_S, NOW_S, i / 10, i / 10, 9000, false, 200, 5, 0, null, 9100, null, false, 0]);
  await withFetch((url) => (url === OPENSKY_URL ? Response.json({ time: NOW_S, states }) : new Response("busy", { status: 503 })), async (calls) => {
    const response = await worker.fetch(request("/api/flights"), assets);
    const body = await response.json();
    assert.equal(body.source, "opensky");
    assert.equal(body.aircraft.length, 150);
    assert.deepEqual(calls.map((c) => c.url), [ADSB_LOL_URL, OPENSKY_URL]);
  });
  const fresh = await loadWorker();
  // A near-empty answer counts as a failure too.
  await withFetch(() => Response.json(many(3)), async () => {
    const response = await fresh.fetch(request("/api/flights"), assets);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("worker: other paths go to the static assets", async () => {
  const worker = await loadWorker();
  assert.equal(await (await worker.fetch(request("/index.html"), assets)).text(), "static");
  assert.equal((await worker.fetch(request("/api/flights", "POST"), assets)).status, 405);
});
