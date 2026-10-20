/**
 * Live remote smoke test. Deliberately separate from offline unit tests:
 * requires external network and verifies provider/deployment availability.
 * Run manually in GitHub Actions, or on PRs proposing integration changes.
 */
import assert from "node:assert/strict";
import { parseGeologicalUnits } from "../src/geology.ts";
import { parseLithologyDictionary } from "../src/lithology.ts";
import { OVATION_URL, northernProfile, parseOvation } from "../src/auroraData.ts";
import { QUAKE_FEEDS, parseQuakeFeed } from "../src/earthquakeData.ts";
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
  const profile = northernProfile(grid);
  console.log("NOAA OVATION forecast:", grid.forecastTime?.toISOString(), "max probability:", grid.maxProbability,
    "northern oval:", profile ? "lat range " + Math.min(...profile.latitudes).toFixed(1) + "-" + Math.max(...profile.latitudes).toFixed(1) : "none above threshold");
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
