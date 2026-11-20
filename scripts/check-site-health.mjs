import { checkStarlink } from "./starlink-health.mjs";
/**
 * Production health check: the deployed site, its Worker endpoints and the
 * public feeds the browser calls directly, each parsed with the app's own
 * parser (a feed that answers 200 with a changed format still fails here).
 * Run every two hours by .github/workflows/site-health.yml, which opens or
 * updates a "site-health" issue while anything fails and closes it once all
 * checks pass again.
 *
 *   node --experimental-strip-types scripts/check-site-health.mjs [report.md]
 *
 * Exit code 1 when a check still fails after one retry. Writes a Markdown
 * report (first argument) for the issue body.
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { parseLaunchSnapshot } from "../src/launchData.ts";
import { parseHazardSnapshot } from "../src/hazardData.ts";
import { decodeFlights } from "../src/flightData.ts";
import { parseWeather } from "../src/weatherData.ts";
import { QUAKE_FEEDS, parseQuakeFeed } from "../src/earthquakeData.ts";
import { KP_NOW_URL, parseKpNow } from "../src/geomagnetic.ts";
import { OVATION_URL, parseOvation } from "../src/auroraData.ts";
import { MAG_URL, WIND_URL, parseSolarWind } from "../src/solarWindData.ts";
import { CLOUD_METADATA_URL, latestCloudObservation } from "../src/cloudData.ts";
import { STARLINK, constellationUrl } from "../src/constellationData.ts";
import { TRUE_COLOR_LAYER, trueColorDate, trueColorUrl } from "../src/trueColorData.ts";
import { parseGeologicalUnits } from "../src/geology.ts";
import { POLAR_CAP_EDGE, polarCapProbeUrl } from "../src/polarCapData.ts";
import { FLARES_URL, XRAYS_URL, flareClass, parseFlares, parseXrays } from "../src/solarActivity.ts";
import { parseSpaceSnapshot } from "../src/spaceData.ts";

const SITE = (process.env.SITE_URL || "https://earth-atlas.edwardlab.workers.dev").replace(/\/$/, "");
const HOUR = 3_600_000;
const report = process.argv[2];

async function get(url, init = {}) {
  // Longer than the Worker's own worst case (two flight feeds at 15 s each), so its answer arrives.
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(45_000), headers: { "User-Agent": "TerraScope-site-health/1.0", Origin: SITE, ...init.headers } });
  return response;
}
async function json(url) {
  const response = await get(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    // The site's own endpoints say which upstream failed in `detail`.
    const detail = await response.json().then((body) => body?.detail, () => null);
    throw new Error("HTTP " + response.status + (typeof detail === "string" ? " — " + detail : ""));
  }
  return response.json();
}
const ago = (ms) => (ms < HOUR ? Math.round(ms / 60_000) + " min" : (ms / HOUR).toFixed(1) + " h") + " old";
function fresh(time, maxMs, what) {
  const age = Date.now() - time;
  if (age > maxMs) throw new Error(`${what} is ${ago(age)} (limit ${ago(maxMs).replace(" old", "")})`);
  return ago(age);
}

/** [area, name, check returning a short detail]; a check throws to fail. */
const CHECKS = [
  ["Site", "Home page", async () => {
    const response = await get(SITE + "/");
    const html = await response.text();
    if (!response.ok || !html.includes("TerraScope")) throw new Error("HTTP " + response.status);
    return "HTTP 200";
  }],
  ["Site", "Intro video", async () => {
    // The opening video index.html plays on a first visit (public/intro/).
    const html = await (await get(SITE + "/")).text();
    if (!html.includes("intro-video")) throw new Error("home page has no intro markup (old deploy?)");
    const response = await get(SITE + "/intro/intro.mp4");
    const type = response.headers.get("content-type") ?? "", bytes = (await response.arrayBuffer()).byteLength;
    if (!response.ok || !type.startsWith("video/") || bytes < 100_000) throw new Error(`HTTP ${response.status}, ${type || "no type"}, ${bytes} bytes`);
    return `${type}, ${Math.round(bytes / 1024)} KB`;
  }],
  ["Worker", "/api/flights", async () => {
    const { source, time, flights } = decodeFlights(await json(SITE + "/api/flights"));
    if (flights.length < 1000) throw new Error("only " + flights.length + " aircraft");
    // Snapshots come every 15 minutes from a scheduled workflow, which GitHub can delay.
    return `${flights.length} aircraft from ${source}, ${fresh(time, 45 * 60_000, "snapshot")}`;
  }],
  ["Worker", "/api/launches", async () => {
    const snapshot = parseLaunchSnapshot(await json(SITE + "/api/launches"));
    if (!snapshot.launches.length) throw new Error("no launches");
    return `${snapshot.launches.length} launches, ${fresh(snapshot.fetched, 8 * HOUR, "calendar")}`;
  }],
  ["Worker", "/api/hazards", async () => {
    const snapshot = parseHazardSnapshot(await json(SITE + "/api/hazards"));
    return `${snapshot.events.length} events, ${snapshot.storms.length} cyclones, ${fresh(snapshot.fetched, 2 * HOUR, "snapshot")}`;
  }],
  ["Worker", "/api/space", async () => {
    const snapshot = parseSpaceSnapshot(await json(SITE + "/api/space"));
    if (snapshot.probes.length < 5) throw new Error("only " + snapshot.probes.length + " probes");
    // Fetched daily at 03:30 UTC by space-data.yml.
    return `${snapshot.asteroids.length} asteroids, ${snapshot.probes.length} probes, ${fresh(snapshot.fetched, 36 * HOUR, "snapshot")}`;
  }],
  ["Worker", "Weather snapshot", async () => {
    const grid = parseWeather(await json(SITE + "/data/weather/latest.json"));
    return "valid " + grid.validTime;
  }],
  ["Worker", "/api/internet/dns-flows", async () => {
    const data = await json(SITE + "/api/internet/dns-flows");
    if (!data || typeof data !== "object") throw new Error("not JSON object");
    return "OK";
  }],
  ["Worker", "/api/stats/summary", async () => {
    // Without the passphrase the dashboard API must refuse (401), not be unconfigured (503).
    const response = await get(SITE + "/api/stats/summary");
    if (response.status !== 401) throw new Error("expected 401 without the passphrase, got " + response.status);
    return "configured (401 without passphrase)";
  }],
  ["Feed", "USGS earthquakes", async () => {
    const quakes = parseQuakeFeed(await json(QUAKE_FEEDS.day.url));
    return quakes.length + " events today";
  }],
  ["Feed", "NOAA Kp index", async () => {
    const now = parseKpNow(await json(KP_NOW_URL));
    return `Kp ${now.kp}, ${fresh(now.time.getTime(), 3 * HOUR, "Kp")}`;
  }],
  ["Feed", "NOAA aurora forecast", async () => {
    const grid = parseOvation(await json(OVATION_URL));
    return "forecast " + (grid.forecastTime?.toISOString().slice(0, 16) ?? "?");
  }],
  ["Feed", "NOAA solar wind", async () => {
    const [wind, mag] = await Promise.all([json(WIND_URL), json(MAG_URL)]);
    const samples = parseSolarWind(wind, mag);
    return `${samples.length} samples, ${fresh(samples.at(-1).time, 2 * HOUR, "latest sample")}`;
  }],
  ["Feed", "SSEC cloud imagery", async () => {
    const latest = latestCloudObservation(await json(CLOUD_METADATA_URL));
    return fresh(latest.getTime(), 6 * HOUR, "latest frame");
  }],
  ["Feed", "CelesTrak Starlink", async () => {
    return checkStarlink({
      read: () => JSON.parse(readFileSync('.cache/site-health/starlink.json', 'utf8')),
      write: value => { mkdirSync('.cache/site-health', { recursive: true }); writeFileSync('.cache/site-health/starlink.json', JSON.stringify(value)); },
      request: () => get(constellationUrl(STARLINK)),
    });
  }],
  ["Feed", "NASA GIBS true colour", async () => {
    // Three tiles across the globe: a gap in one day's mosaic (an empty 1.6 KB
    // tile) is NASA's and shows as base imagery; most of the day missing is an outage.
    const date = trueColorDate(new Date());
    const sizes = await Promise.all(["3/3/6", "3/2/1", "3/4/2"].map(async (tile) => {
      const response = await get(trueColorUrl(date).replace("{z}/{y}/{x}", tile));
      return response.ok ? (await response.arrayBuffer()).byteLength : 0;
    }));
    const full = sizes.filter((bytes) => bytes >= 5000).length;
    if (full < 2) throw new Error(`${date}: only ${full} of 3 tiles have data (${sizes.join(", ")} bytes)`);
    return `${TRUE_COLOR_LAYER} ${date}, ${full} of 3 tiles with data`;
  }],
  ["Feed", "NASA GIBS polar caps", async () => {
    // The browser draws these into WebGL, so the answer must allow cross-origin use.
    const response = await get(polarCapProbeUrl(-90, POLAR_CAP_EDGE, 0, 90));
    const type = response.headers.get("content-type") ?? "", cors = response.headers.get("access-control-allow-origin");
    const bytes = (await response.arrayBuffer()).byteLength;
    if (!response.ok || !type.startsWith("image/") || bytes < 2000) throw new Error(`HTTP ${response.status}, ${type || "no type"}, ${bytes} bytes`);
    if (cors !== "*" && cors !== SITE) throw new Error("no CORS header (" + (cors ?? "none") + ")");
    return `${type}, ${Math.round(bytes / 1024)} KB, CORS ${cors}`;
  }],
  ["Feed", "NOAA X-ray flares", async () => {
    const [flares, xray] = [parseFlares(await json(FLARES_URL)), parseXrays(await json(XRAYS_URL))];
    if (!xray) throw new Error("no 0.1-0.8 nm X-ray sample");
    return `${flares.length} flares in 7 days, now ${flareClass(xray.flux)}, ${fresh(xray.time, HOUR, "X-ray sample")}`;
  }],
  ["Feed", "Macrostrat geology", async () => {
    const units = parseGeologicalUnits(await json("https://macrostrat.org/api/v2/geologic_units/map?lat=43&lng=-89.3&format=json"));
    if (!units.length) throw new Error("no map units at a known site");
    return units.length + " units at test site";
  }],
];

async function run([area, name, check]) {
  const started = Date.now();
  try {
    return { area, name, ok: true, detail: await check(), ms: Date.now() - started };
  } catch (error) {
    return { area, name, ok: false, detail: String(error?.message ?? error).slice(0, 200), ms: Date.now() - started };
  }
}

let results = await Promise.all(CHECKS.map(run));
// Retry transient feeds once. CelesTrak explicitly limits repeated downloads;
// its failures must wait for the next eligible scheduled attempt.
const failedFirst = results.filter((r) => !r.ok && r.name !== "CelesTrak Starlink");
if (failedFirst.length) {
  await new Promise((resolve) => setTimeout(resolve, 60_000));
  const retried = await Promise.all(CHECKS.filter(([, name]) => failedFirst.some((r) => r.name === name)).map(run));
  results = results.map((r) => retried.find((x) => x.name === r.name) ?? r);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.area.padEnd(6)} ${r.name.padEnd(26)} ${r.detail} (${r.ms} ms)`);
if (report) {
  const lines = [
    failed.length ? `**${failed.length} of ${results.length} checks failing** (transient feeds retried once; CelesTrak downloads limited to 2-hour intervals), checked ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC against ${SITE}.` : `All ${results.length} checks pass.`,
    "",
    "| | Area | Check | Detail |",
    "|---|---|---|---|",
    ...results.map((r) => `| ${r.ok ? "✅" : "❌"} | ${r.area} | ${r.name} | ${r.detail.replace(/\|/g, "\\|")} |`),
  ];
  writeFileSync(report, lines.join("\n") + "\n");
  writeFileSync(report + ".failing", failed.map((r) => r.name).sort().join("\n"));
}
process.exitCode = failed.length ? 1 : 0;
