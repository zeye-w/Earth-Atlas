/**
 * Live remote smoke test. Deliberately separate from offline unit tests:
 * requires external network and verifies provider/deployment availability.
 * Run manually in GitHub Actions, or on PRs proposing integration changes.
 */
import assert from "node:assert/strict";
import { parseGeologicalUnits } from "../src/geology.ts";
import { parseLithologyDictionary } from "../src/lithology.ts";
import { OVATION_URL, northernProfile, parseOvation, southernProfile } from "../src/auroraData.ts";
import { QUAKE_FEEDS, parseQuakeFeed } from "../src/earthquakeData.ts";
import { CLOUD_METADATA_URL, cloudTileUrl, cloudTimes } from "../src/cloudData.ts";
import { STARLINK, constellationUrl, parseOmmCsv, shellCounts, epochOf } from "../src/constellationData.ts";
import { MAG_URL, WIND_URL, dynamicPressure, parseSolarWind, shueMagnetopause } from "../src/solarWindData.ts";
import { ADSB_LOL_URL, FLIGHT_USER_AGENT, decodeFlights, parseAdsbLol } from "../src/flightData.ts";
import { TRUE_COLOR_LAYER, trueColorDate, trueColorUrl } from "../src/trueColorData.ts";
import { KP_HISTORY_URL, KP_NOW_URL, kpLevel, parseKpHistory, parseKpNow } from "../src/geomagnetic.ts";

async function get(label, url, timeout = 20000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: {
      Accept: label.startsWith("Macrostrat") ? "application/json" : "*/*",
      ...(label.startsWith("Macrostrat") ? { Origin: "https://earth-atlas.edwardlab.workers.dev" } : {}),
      "User-Agent": "Earth-Atlas-GitHub-Actions-Smoke-Test/0.1",
    },
  });
  const contentType = res.headers.get("content-type") || "(missing)";
  console.log(label, "HTTP", res.status, "content-type", contentType);
  if (label.startsWith("Macrostrat")) {
    const cors = res.headers.get("access-control-allow-origin") ?? "(missing)";
    console.log(label, "Access-Control-Allow-Origin", cors);
    assert.ok(cors === "*" || cors === "https://earth-atlas.edwardlab.workers.dev", label + " CORS disallows deployed origin");
  }
  assert.ok(res.ok, label + " HTTP " + res.status);
  return res;
}

let failed = false;

try {
  const url = "https://macrostrat.org/api/v2/geologic_units/map?lat=43&lng=-89.3&format=json";
  const response = await get("Macrostrat", url);
  assert.match(response.headers.get("content-type") || "", /json/i, "Macrostrat should return JSON");
  const json = await response.json();
  console.log("Macrostrat payload wrapper keys:", Object.keys(json).slice(0, 15).join(", "));
  const units = parseGeologicalUnits(json);
  console.log("Macrostrat matching geological units:", units.length);
  assert.ok(units.length > 0, "Known terrestrial sample site should have at least one map unit");
  console.log("Macrostrat first unit:", JSON.stringify({
    name: units[0].name,
    age: units[0].age,
    lithology: units[0].lithology,
    ageRangeMa: units[0].ageRangeMa,
    sourceId: units[0].sourceId,
    mapId: units[0].mapId,
  }));
} catch (error) {
  failed = true;
  console.error("LIVE_MACROSTRAT_FAILURE:", error);
  // Diagnose whether the endpoint ignores filter parameters or only a
  // particular response format is affected. Record metadata only.
  const probes = [
    ["no-format", "https://macrostrat.org/api/v2/geologic_units/map?lat=43&lng=-89.3"],
    ["float-coordinates", "https://macrostrat.org/api/v2/geologic_units/map?lat=43.000000&lng=-89.300000&format=json"],
    ["alternate-coordinate", "https://macrostrat.org/api/v2/geologic_units/map?lat=40.0&lng=-105.0&format=json"],
    ["by-map-id", "https://macrostrat.org/api/v2/geologic_units/map?map_id=2092425&format=json"],
    ["geojson", "https://macrostrat.org/api/v2/geologic_units/map?lat=43&lng=-89.3&format=geojson"],
    ["other-api", "https://macrostrat.org/api/v2/defs/lithologies?format=json"],
  ];
  for (const [name, url] of probes) {
    try {
      const res = await get("Macrostrat probe " + name, url, 10000);
      const body = await res.text();
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      const rootKeys = parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
      const data = parsed?.data;
      console.log("  probe:", name, "rootKeys:", rootKeys.join(","),
        "dataType:", Array.isArray(data) ? "array(" + data.length + ")" : typeof data,
        "successKeys:", parsed?.success && typeof parsed.success === "object" ? Object.keys(parsed.success).join(",") : "(none)",
        "preview:", JSON.stringify(parsed).slice(0, 320));
    } catch (diagnosticError) {
      console.error("  probe:", name, String(diagnosticError));
    }
  }
}

try {
  const response = await get("Macrostrat lithology dictionary", "https://macrostrat.org/api/v2/defs/lithologies?format=json");
  const dict = parseLithologyDictionary(await response.json());
  console.log("Real Macrostrat lithologies:", dict.size);
  assert.ok(dict.size > 20, "Expected a nontrivial official lexicon");
} catch (error) {
  failed = true;
  console.error("LIVE_LITHOLOGY_FAILURE:", error);
}

try {
  const response = await fetch(OVATION_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: "application/json", Origin: "https://earth-atlas.edwardlab.workers.dev" },
  });
  const cors = response.headers.get("access-control-allow-origin") ?? "(missing)";
  console.log("NOAA OVATION HTTP", response.status, "content-type", response.headers.get("content-type"), "Access-Control-Allow-Origin", cors);
  assert.ok(response.ok, "NOAA OVATION HTTP " + response.status);
  assert.ok(cors === "*" || cors === "https://earth-atlas.edwardlab.workers.dev", "NOAA OVATION CORS disallows deployed origin");
  const grid = parseOvation(await response.json());
  const oval = (profile) => profile ? "lat range " + Math.min(...profile.latitudes).toFixed(1) + "-" + Math.max(...profile.latitudes).toFixed(1) + ", max " + profile.maxProbability + "%" : "none above threshold";
  console.log("NOAA OVATION forecast:", grid.forecastTime?.toISOString(), "max probability:", grid.maxProbability,
    "northern oval:", oval(northernProfile(grid)), "southern oval:", oval(southernProfile(grid)));
} catch (error) {
  failed = true;
  console.error("LIVE_NOAA_OVATION_FAILURE:", error);
}

try {
  const headers = { Accept: "application/json", Origin: "https://earth-atlas.edwardlab.workers.dev" };
  const nowResponse = await fetch(KP_NOW_URL, { signal: AbortSignal.timeout(20000), headers });
  const cors = nowResponse.headers.get("access-control-allow-origin") ?? "(missing)";
  console.log("NOAA Kp (1m) HTTP", nowResponse.status, "Access-Control-Allow-Origin", cors);
  assert.ok(nowResponse.ok && (cors === "*" || cors === "https://earth-atlas.edwardlab.workers.dev"), "NOAA Kp unavailable or CORS blocked");
  const now = parseKpNow(await nowResponse.json());
  console.log("  current Kp:", now.kp, kpLevel(now.kp).label, now.time.toISOString());
  const historyResponse = await fetch(KP_HISTORY_URL, { signal: AbortSignal.timeout(20000), headers });
  console.log("NOAA Kp (3h) HTTP", historyResponse.status, "Access-Control-Allow-Origin", historyResponse.headers.get("access-control-allow-origin") ?? "(missing)");
  const history = parseKpHistory(await historyResponse.json());
  console.log("  history samples:", history.length, "latest:", JSON.stringify(history.at(-1)));
} catch (error) {
  failed = true;
  console.error("LIVE_NOAA_KP_FAILURE:", error);
}

for (const [range, feed] of Object.entries(QUAKE_FEEDS)) {
  try {
    const response = await fetch(feed.url, {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: "application/json", Origin: "https://earth-atlas.edwardlab.workers.dev" },
    });
    const cors = response.headers.get("access-control-allow-origin") ?? "(missing)";
    console.log("USGS " + range, "HTTP", response.status, "Access-Control-Allow-Origin", cors);
    assert.ok(response.ok, "USGS HTTP " + response.status);
    assert.ok(cors === "*" || cors === "https://earth-atlas.edwardlab.workers.dev", "USGS CORS disallows deployed origin");
    const quakes = parseQuakeFeed(await response.json());
    const largest = quakes[quakes.length - 1];
    console.log("  events:", quakes.length, "largest:", largest ? "M" + largest.magnitude + " " + largest.place : "none");
  } catch (error) {
    failed = true;
    console.error("LIVE_USGS_FAILURE:", range, error);
  }
}

for (const [label, url] of [
  ["NASA Blue Marble tile", "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/2/1/1.jpeg"],
  ["NASA Black Marble tile", "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/2/1/1.png"],
]) {
  try {
    const response = await get(label, url);
    const type = response.headers.get("content-type") || "";
    const bytes = (await response.arrayBuffer()).byteLength;
    console.log("  bytes:", bytes);
    assert.match(type, /image\//i, label + " is not an image");
    assert.ok(bytes > 1000, label + " unexpectedly small");
  } catch (error) {
    failed = true;
    console.error("LIVE_GIBS_FAILURE:", label, error);
  }
}

const site = "https://earth-atlas.edwardlab.workers.dev";

// Daily true colour: yesterday's and a month-old mosaic must reach the deployed origin.
for (const date of [trueColorDate(new Date()), trueColorDate(new Date(Date.now() - 28 * 24 * 60 * 60 * 1000))]) {
  const label = "GIBS true colour " + TRUE_COLOR_LAYER + " " + date;
  try {
    const response = await fetch(trueColorUrl(date).replace("{z}/{y}/{x}", "3/3/6"), { signal: AbortSignal.timeout(20000), headers: { Origin: site } });
    const type = response.headers.get("content-type") || "(missing)";
    const cors = response.headers.get("access-control-allow-origin") ?? "(missing)";
    const bytes = (await response.arrayBuffer()).byteLength;
    console.log(label, "HTTP", response.status, type, "CORS", cors, "bytes", bytes);
    assert.ok(response.ok, "HTTP " + response.status);
    assert.match(type, /image\/jpeg/i);
    assert.ok(cors === "*" || cors === site, "CORS disallows deployed origin");
    assert.ok(bytes > 5000, "tile unexpectedly small (no data?)");
  } catch (error) {
    failed = true;
    console.error("LIVE_GIBS_FAILURE:", label, error);
  }
}

// Cloud history for the timeline: about 30 days of hourly frames, and the
// oldest still serves tiles to the deployed origin.
try {
  const response = await fetch(CLOUD_METADATA_URL, { signal: AbortSignal.timeout(20000), headers: { Origin: site } });
  const cors = response.headers.get("access-control-allow-origin") ?? "(missing)";
  const times = cloudTimes(await response.json());
  console.log("RealEarth globalir catalog HTTP", response.status, "CORS", cors, "frames", times.length, "range", times[0]?.toISOString(), "..", times.at(-1)?.toISOString());
  assert.ok(cors === "*" || cors === site, "CORS disallows deployed origin");
  assert.ok(times.length >= 24 * 20, "fewer than 20 days of hourly frames");
  const tile = await fetch(cloudTileUrl(times[0]).replace("x={x}&y={y}&z={z}", "x=1&y=1&z=2"), { signal: AbortSignal.timeout(20000), headers: { Origin: site } });
  const type = tile.headers.get("content-type") || "(missing)";
  const bytes = (await tile.arrayBuffer()).byteLength;
  console.log("  oldest frame tile HTTP", tile.status, type, "bytes", bytes);
  assert.ok(tile.ok && /image\//.test(type) && bytes > 5000, "oldest cloud frame has no tile");
} catch (error) {
  failed = true;
  console.error("LIVE_CLOUD_FAILURE:", error);
}

// Starlink constellation (CSV): size, count, element ages and CORS.
try {
  const started = Date.now();
  const response = await fetch(constellationUrl(STARLINK), { signal: AbortSignal.timeout(30000), headers: { Origin: site } });
  const text = await response.text();
  const cors = response.headers.get("access-control-allow-origin") ?? "(missing)";
  const records = parseOmmCsv(text);
  const ages = records.map((r) => (Date.now() - epochOf(r).getTime()) / 86_400_000).sort((a, b) => a - b);
  console.log("CelesTrak Starlink CSV HTTP", response.status, response.headers.get("content-type"), "CORS", cors, "bytes", text.length, "records", records.length, "in", Date.now() - started, "ms");
  console.log("  header:", text.split("\n")[0].slice(0, 300));
  console.log("  element age days: median", ages[Math.floor(ages.length / 2)].toFixed(1), "max", ages.at(-1).toFixed(1), "older than 10 d:", ages.filter((a) => a > 10).length);
  console.log("  shells:", JSON.stringify(shellCounts(records).slice(0, 6)));
  assert.ok(cors === "*" || cors === site, "CORS disallows deployed origin");
  assert.ok(records.length > 1000, "too few Starlink records");
} catch (error) {
  failed = true;
  console.error("LIVE_CELESTRAK_STARLINK_FAILURE:", error);
}

// Solar wind (RTSW, ~24 h): CORS, size, coverage, latest values.
try {
  const responses = await Promise.all([WIND_URL, MAG_URL].map((url) => fetch(url, { signal: AbortSignal.timeout(30000), headers: { Origin: site } })));
  const bodies = await Promise.all(responses.map((r) => r.text()));
  responses.forEach((r, i) => console.log("SWPC solar wind", i ? "mag" : "wind", "HTTP", r.status, "CORS", r.headers.get("access-control-allow-origin") ?? "(missing)", "bytes", bodies[i].length, "start", bodies[i].slice(0, 110)));
  const samples = parseSolarWind(JSON.parse(bodies[0]), JSON.parse(bodies[1]));
  const latest = samples.at(-1);
  const mp = shueMagnetopause(dynamicPressure(latest.density, latest.speed), latest.bz ?? 0);
  console.log("  samples", samples.length, "range", new Date(samples[0].time).toISOString(), "..", new Date(latest.time).toISOString(), "with Bz", samples.filter((s) => s.bz !== null).length);
  console.log("  sources", JSON.stringify(Object.fromEntries([...new Set(samples.map((x) => x.source))].map((src) => [src, samples.filter((x) => x.source === src).length]))));
  console.log("  latest", JSON.stringify(latest), "Pd", dynamicPressure(latest.density, latest.speed).toFixed(2), "nPa  magnetopause r0", mp.r0.toFixed(2), "RE");
  for (const r of responses) { const cors = r.headers.get("access-control-allow-origin"); assert.ok(cors === "*" || cors === site, "CORS disallows deployed origin"); }
  assert.ok(samples.length > 1000, "fewer than 1000 solar wind samples");
} catch (error) {
  failed = true;
  console.error("LIVE_SWPC_SOLAR_WIND_FAILURE:", error);
}

// Live flights: the upstream feed the Worker uses, then the deployed proxy.
try {
  const started = Date.now();
  const response = await fetch(ADSB_LOL_URL, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": FLIGHT_USER_AGENT, Accept: "application/json" } });
  const snapshot = parseAdsbLol(await response.json());
  const compact = JSON.stringify(snapshot).length;
  console.log("adsb.lol all_with_pos HTTP", response.status, "aircraft", snapshot.aircraft.length, "airborne", snapshot.aircraft.filter((a) => a[4] !== null).length, "compact bytes", compact, "in", Date.now() - started, "ms");
  assert.ok(snapshot.aircraft.length > 1000, "too few aircraft from adsb.lol");
} catch (error) {
  failed = true;
  console.error("LIVE_ADSB_LOL_FAILURE:", error);
}
try {
  const response = await fetch(site + "/api/flights", { signal: AbortSignal.timeout(30000) });
  const { source, time, flights } = decodeFlights(await response.json());
  console.log("Cloudflare /api/flights HTTP", response.status, "cache-control", response.headers.get("cache-control"), "source", source, "aircraft", flights.length, "data age", Math.round((Date.now() - time) / 1000), "s");
  assert.ok(flights.length > 1000, "too few aircraft from the deployed proxy");
  assert.ok(Date.now() - time < 10 * 60_000, "deployed flight data older than 10 minutes");
} catch (error) {
  failed = true;
  console.error("LIVE_FLIGHTS_PROXY_FAILURE:", error);
}

for (const path of [
  "/",
  "/cesium/Workers/transferTypedArrayTest.js",
  "/cesium/Workers/createVerticesFromHeightmap.js",
  "/cesium/Assets/approximateTerrainHeights.json",
]) {
  try {
    const response = await get("Cloudflare " + path, site + path);
    const body = await response.text();
    const type = response.headers.get("content-type") || "";
    if (path.endsWith(".js")) assert.match(type, /javascript/i, path + " has wrong MIME");
    if (path.endsWith(".json")) {
      assert.match(type, /json/i, path + " has wrong MIME");
      assert.doesNotThrow(() => JSON.parse(body));
    }
    assert.ok(body.length > 30, "Unexpected empty static asset: " + path);
    if (path !== "/") assert.doesNotMatch(body.slice(0, 180).toLowerCase(), /<!doctype html|<html/, "SPA fallback served at " + path);
    console.log("  bytes:", body.length);
  } catch (error) {
    failed = true;
    console.error("LIVE_WORKER_FAILURE:", path, error);
  }
}

if (failed) process.exitCode = 1;
else console.log("Live Macrostrat and Cloudflare resource smoke checks passed.");
