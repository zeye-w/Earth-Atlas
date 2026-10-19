/**
 * Live remote smoke test. Deliberately separate from offline unit tests:
 * requires external network and verifies provider/deployment availability.
 * Run manually in GitHub Actions, or on PRs proposing integration changes.
 */
import assert from "node:assert/strict";
import { parseGeologicalUnits } from "../src/geology.ts";
import { parseLithologyDictionary } from "../src/lithology.ts";
import { OVATION_URL, northernProfile, parseOvation } from "../src/auroraData.ts";

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

const site = "https://earth-atlas.edwardlab.workers.dev";
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
