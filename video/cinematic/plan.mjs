/**
 * Plan the film: find the next moment the ISS passes sunlit over a dark
 * Europe, wait for it (full mode), snapshot all live data at that moment,
 * pick the flight to lock onto, and write plan.json for the capture jobs.
 *
 * Env: CINE_SITE (local build, recording mode), CINE_PRODUCTION (for the
 * /api/flights Worker), CINE_OUT, CINE_MODE (preview|full), CINE_MAX_WAIT_MIN.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { decodeFlights, extrapolate } from "../../src/flightData.ts";
import { epochOf, parseOmmCsv } from "../../src/constellationData.ts";
import { dynamicPressure, parseSolarWind, shueMagnetopause } from "../../src/solarWindData.ts";
import { parseKpNow } from "../../src/geomagnetic.ts";
import { parseOvation } from "../../src/auroraData.ts";
import { FLIGHT_LOCK, contextFrom, frameAt, layersAt } from "./story.mjs";
import { RE, add, dot, geo, mul, norm, satelliteFromOmm, surfaceDistance } from "./geometry.mjs";
import { findFilmWindow, upcomingWindows } from "./pass.mjs";
import { openPage, recordData, waitForLayers } from "./browser.mjs";

const SITE = process.env.CINE_SITE || "http://127.0.0.1:4173/";
const PRODUCTION = process.env.CINE_PRODUCTION || "https://earth-atlas.edwardlab.workers.dev/";
const OUT = process.env.CINE_OUT || "video/cinematic/out/plan";
const MODE = process.env.CINE_MODE || "preview";
const MAX_WAIT_MIN = Number(process.env.CINE_MAX_WAIT_MIN || "300");
mkdirSync(OUT, { recursive: true });

const fmt = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC（北京时间 " + new Date(ms + 8 * 3_600_000).toISOString().slice(5, 16).replace("T", " ") + "）";

// 1. The ISS elements and the upcoming windows.
const response = await fetch("https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json", { signal: AbortSignal.timeout(30_000) });
const [issOmmFetched] = await response.json();
const windows = upcomingWindows(satelliteFromOmm(issOmmFetched), Date.now() + 4 * 60_000, 8, 120);
console.log("Upcoming windows (ISS sunlit over dark Europe):");
for (const w of windows) console.log("  ", fmt(w.T0), " (", Math.round((w.last - w.first) / 1000), "s wide )");
writeFileSync(OUT + "/windows.json", JSON.stringify(windows.map((w) => ({ ...w, utc: new Date(w.T0).toISOString() })), null, 2));
let window = windows[0];
if (!window && MODE !== "full") {
  // Preview only checks framing: any pass over Europe will do.
  window = findFilmWindow(satelliteFromOmm(issOmmFetched), Date.now() + 4 * 60_000, 48, 10_000, true);
  console.log("::warning::No dark-Europe window in five days; preview uses a pass at " + (window && fmt(window.T0)) + " regardless of lighting.");
}
if (!window) throw new Error("No ISS pass over a dark Europe in the next five days; try again later.");
const waitMin = (window.T0 - Date.now()) / 60_000;
if (MODE === "full") {
  if (waitMin > MAX_WAIT_MIN) {
    console.log(`::error::Next window ${fmt(window.T0)} is ${Math.round(waitMin)} min away (limit ${MAX_WAIT_MIN}). Start the workflow within ${MAX_WAIT_MIN} min before it.`);
    process.exit(2);
  }
  // Snapshot just before T0 so aircraft are dead-reckoned for under two minutes.
  const wake = window.T0 - 35_000;
  console.log("Waiting", Math.round((wake - Date.now()) / 60_000), "min for", fmt(window.T0));
  while (Date.now() < wake) await new Promise((r) => setTimeout(r, Math.min(60_000, wake - Date.now())));
}

// 2. Snapshot every live feed the film uses, as the page requests them.
const scene = {
  v: 1, camera: [9, 50, 17_000_000, 0, -Math.PI / 2 + 1e-6, 0],
  layers: { ...layersAt(0), satellites: true, paths: true, starlink: true, flights: true, solarWind: true, aurora: true },
  options: { cloudOpacity: 65, opacity: 90, mapMode: "raster", ageFilter: "all", rockFilter: "all", quakeRange: "week", atmosphereShells: 0 },
};
const { browser, page, errors, url } = await openPage({ site: SITE, scene, viewport: { width: 1280, height: 720 } });
const snapshotAt = Date.now();
const index = await recordData(page, OUT + "/data", PRODUCTION);
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__terrascope), null, { timeout: 120_000 });
await page.evaluate(() => window.__terrascope.ready());
await waitForLayers(page, ["satellites", "starlink", "flights", "solarWind", "aurora"]);
await browser.close();
console.log("Snapshot:", index.length, "responses;", errors.length, "page errors");

// 3. Readings for the HUD, from exactly those responses.
const body = (pattern) => {
  const entry = index.find((e) => pattern.test(e.url));
  if (!entry) throw new Error("Snapshot lacks " + pattern);
  return readFileSync(OUT + "/data/" + entry.file, "utf8");
};
// The request the satellite layer itself makes (src/satelliteOrbits.ts).
const stations = JSON.parse(body(/GROUP=STATIONS&FORMAT=JSON$/));
const issOmm = stations.find((r) => Number(r.NORAD_CAT_ID) === 25544);
if (!issOmm) throw new Error("ISS elements missing from the snapshot");
const flights = decodeFlights(JSON.parse(body(/\/api\/flights/)));
const starlink = parseOmmCsv(body(/GROUP=starlink/i)).filter((r) => Math.abs(window.T0 - epochOf(r).getTime()) <= 10 * 86_400_000);
const wind = parseSolarWind(JSON.parse(body(/rtsw_wind_1m/)), JSON.parse(body(/rtsw_mag_1m/)));
const latest = wind.at(-1);
const pressure = dynamicPressure(latest.density, latest.speed);
const kp = parseKpNow(JSON.parse(body(/planetary_k_index_1m/)));
const ovation = parseOvation(JSON.parse(body(/ovation_aurora_latest/)));

// 4. The flight to lock onto: airborne, with a callsign, nearest the point
// the camera looks at in the middle of the lock.
const ctx = contextFrom({ T0: window.T0, issOmm });
const lockFrame = Math.round(((FLIGHT_LOCK.start + FLIGHT_LOCK.end) / 2) * 30);
const { camera, virtualTime } = frameAt(lockFrame, ctx);
// Where the view ray meets the ground (spherical Earth is enough here).
const b = dot(camera.position, camera.direction), c = dot(camera.position, camera.position) - RE * RE;
const along = -b - Math.sqrt(Math.max(0, b * b - c));
const aim = add(camera.position, mul(camera.direction, along));
let best = null;
for (const f of flights.flights) {
  if (f.altitude === null || f.altitude < 8_000 || !f.callsign) continue;
  const p = extrapolate(f, (virtualTime - f.reportedAt) / 1000);
  const d = surfaceDistance(geo(p.longitude, p.latitude, 0), aim);
  if (!best || d < best.d) best = { d, f };
}
if (!best) throw new Error("No airborne aircraft with a callsign in the snapshot");
if (best.d > 250e3) {
  const message = "Nearest airborne flight is " + Math.round(best.d / 1000) + " km from the lock point";
  if (MODE === "full") throw new Error(message);
  console.log("::warning::" + message + " (preview continues)");
}

const plan = {
  mode: MODE, T0: window.T0, window, snapshotAt, issOmm,
  flight: { hex: best.f.hex, callsign: best.f.callsign, type: best.f.type, registration: best.f.registration, distanceFromAimKm: Math.round(best.d / 1000) },
  readings: {
    aircraft: flights.flights.length, airborne: flights.flights.filter((f) => f.altitude !== null).length, flightsTime: flights.time, flightsSource: flights.source,
    starlink: starlink.length,
    solarWind: { speed: Math.round(latest.speed), density: Number(latest.density.toFixed(1)), bz: latest.bz === null ? null : Number(latest.bz.toFixed(1)), time: latest.time, source: latest.source },
    pressure: Number(pressure.toFixed(2)), magnetopause: Number(shueMagnetopause(pressure, latest.bz ?? 0).r0.toFixed(1)),
    kp: kp.kp, kpTime: kp.time, ovationForecast: ovation.forecastTime ?? null,
  },
  pageErrors: errors,
};
writeFileSync(OUT + "/plan.json", JSON.stringify(plan, null, 2));
console.log("PLAN", JSON.stringify({ T0: new Date(plan.T0).toISOString(), flight: plan.flight, readings: plan.readings }, null, 1));
