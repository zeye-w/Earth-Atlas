/**
 * Live remote smoke test. Deliberately separate from offline unit tests:
 * requires external network and verifies provider/deployment availability.
 * Run manually in GitHub Actions, or on PRs proposing integration changes.
 */
import assert from "node:assert/strict";
import { parseGeologicalUnits } from "../src/geology.ts";

async function get(label, url, timeout = 20000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: {
      Accept: label === "Macrostrat" ? "application/json" : "*/*",
      "User-Agent": "Earth-Atlas-GitHub-Actions-Smoke-Test/0.1",
    },
  });
  const contentType = res.headers.get("content-type") || "(missing)";
  console.log(label, "HTTP", res.status, "content-type", contentType);
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
