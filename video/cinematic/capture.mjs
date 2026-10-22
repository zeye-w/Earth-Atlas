/**
 * Capture a range of frames of the film from the local build, replaying the
 * plan's data snapshot. Every frame: virtual clock at T0 + t, camera pose
 * from story.mjs, wait until tiles and layer work are done, screenshot, and
 * record what the HUD needs (camera height, where the station and the locked
 * flight are on screen, the flight's readings).
 *
 * Env: CINE_SITE, CINE_PLAN (directory with plan.json and data/), CINE_OUT,
 * CINE_FRAMES ("first-last", or "preview" for stills every 0.8 s),
 * CINE_MODEL_URL, CINE_MODEL_ROTATION ("h,p,r" degrees), CINE_MODEL_SCALE (model units
 * to metres).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { STATION, FRAMES, PICTURE_HEIGHT, WIDTH, contextFrom, frameAt, layersAt } from "./story.mjs";
import { norm, sub, toGeo } from "./geometry.mjs";
import { openPage, replayData, waitForLayers } from "./browser.mjs";

const SITE = process.env.CINE_SITE || "http://127.0.0.1:4173/";
const PLAN = process.env.CINE_PLAN || "video/cinematic/out/plan";
const OUT = process.env.CINE_OUT || "video/cinematic/out/frames";
const RANGE = process.env.CINE_FRAMES || "preview";
const MODEL_URL = process.env.CINE_MODEL_URL || "/record-assets/tiangong.glb";
const MODEL_ROTATION = (process.env.CINE_MODEL_ROTATION || "0,0,0").split(",").map(Number);
const MODEL_SCALE = Number(process.env.CINE_MODEL_SCALE || 1);
mkdirSync(OUT, { recursive: true });

const plan = JSON.parse(readFileSync(PLAN + "/plan.json", "utf8"));
const ctx = contextFrom(plan);
const frames = RANGE === "preview"
  ? Array.from({ length: Math.ceil(FRAMES / 24) }, (_, i) => i * 24).concat([216, 380, 393, 410, 576, 648, 899]).sort((a, b) => a - b)
  : (() => { const [a, b] = RANGE.split("-").map(Number); return Array.from({ length: b - a + 1 }, (_, i) => a + i); })();
const uniqueFrames = [...new Set(frames)].filter((f) => f >= 0 && f < FRAMES);

const needs = new Set();
for (const f of uniqueFrames) for (const [key, on] of Object.entries(layersAt(f / 30))) if (on && ["satellites", "starlink", "flights", "solarWind", "aurora"].includes(key)) needs.add(key);
const first = frameAt(uniqueFrames[0], ctx);
const scene = {
  v: 1, camera: [plan.region?.lon ?? 0, plan.region?.lat ?? 0, 17_000_000, 0, -Math.PI / 2 + 1e-6, 0], layers: first.layers,
  options: { cloudOpacity: 65, opacity: 90, mapMode: "raster", ageFilter: "all", rockFilter: "all", quakeRange: "week", atmosphereShells: 0 },
};
const { browser, page, errors, url } = await openPage({ site: SITE, scene });
const missing = [];
await replayData(page, PLAN + "/data", missing);
const log = [];
const report = { plan: { T0: plan.T0, mode: plan.mode }, range: RANGE, frames: log, errors, missing, unsettled: 0, started: new Date().toISOString() };
const save = () => writeFileSync(OUT + "/capture-" + RANGE + ".json", JSON.stringify(report, null, 1));

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__terrascope && window.__terrascope.version >= 2), null, { timeout: 120_000 });
  await page.evaluate(async (T0) => {
    const api = window.__terrascope;
    await api.ready();
    api.setUi("clean");
    api.setVirtualNow(T0);
  }, plan.T0);
  // Every layer this range uses must have its real data before any frame is taken.
  await page.evaluate((layers) => window.__terrascope.setLayers(layers), Object.fromEntries([...needs].map((k) => [k, true])));
  await waitForLayers(page, [...needs]);
  if (uniqueFrames.some((f) => frameAt(f, ctx).stationModel)) {
    await page.evaluate((options) => window.__terrascope.satelliteModel({ ...options }), { id: STATION.id, url: MODEL_URL, rotation: MODEL_ROTATION, scale: MODEL_SCALE });
  }

  let layers = null;
  const apply = async (frame, timeout) => {
    const f = frameAt(frame, ctx);
    const layerChange = JSON.stringify(f.layers) !== JSON.stringify(layers);
    layers = f.layers;
    return page.evaluate(async ({ f, layerChange, timeout, hex, stationId }) => {
      const api = window.__terrascope;
      if (layerChange) api.setLayers(f.layers);
      api.setVirtualNow(f.virtualTime);
      api.setEffectsTime(f.effectsTime);
      api.setLayerAlpha("flights", f.alpha.flights);
      api.setLayerAlpha("starlink", f.alpha.starlink);
      api.setCameraPose(f.camera);
      const settled = await api.idle(timeout);
      api.render();
      // What the HUD draws over this frame.
      const station = api.satellitePosition(stationId);
      const flight = api.flight(hex);
      const [stationScreen, flightScreen] = api.project([station ?? [0, 0, 0], flight?.position ?? [0, 0, 0]]);
      return {
        settled,
        station: station ? { position: station, ...stationScreen } : null,
        flight: flight ? { ...flightScreen, altitude: flight.flight.altitude, speed: flight.flight.speed, track: flight.flight.track, position: flight.position } : null,
      };
    }, { f, layerChange, timeout, hex: plan.flight.hex, stationId: STATION.id });
  };

  // Warm-up: fly the range once quickly so the imagery tiles are cached.
  for (let i = 0; i < uniqueFrames.length; i += 8) await apply(uniqueFrames[i], 6_000);
  layers = null;

  for (const frame of uniqueFrames) {
    const f = frameAt(frame, ctx);
    const probe = await apply(frame, 45_000);
    const file = String(frame).padStart(4, "0") + ".jpg";
    await page.screenshot({ path: OUT + "/" + file, type: "jpeg", quality: 95, clip: { x: 0, y: 0, width: WIDTH, height: PICTURE_HEIGHT } });
    const cam = toGeo(f.camera.position);
    const entry = {
      frame, t: f.t, take: f.take, file, settled: probe.settled,
      camera: { lon: cam.lon, lat: cam.lat, height: cam.h, fov: f.camera.fov },
      station: probe.station && (() => {
        return { x: probe.station.x, y: probe.station.y, visible: probe.station.visible, distance: norm(sub(probe.station.position, f.camera.position)), height: toGeo(probe.station.position).h, speed: ctx.station.inertialSpeed(f.virtualTime) };
      })(),
      flight: probe.flight && { x: probe.flight.x, y: probe.flight.y, visible: probe.flight.visible, altitude: probe.flight.altitude, speed: probe.flight.speed, track: probe.flight.track, distance: norm(sub(probe.flight.position, f.camera.position)) },
    };
    log.push(entry);
    if (!probe.settled) report.unsettled++;
    if (log.length % 10 === 1) { console.log("frame", frame, "t", f.t.toFixed(2), "settled", probe.settled); save(); }
  }
  if (missing.length) throw new Error("Live-data requests missing from the snapshot: " + missing.slice(0, 5).join(", "));
  report.finished = new Date().toISOString();
  save();
  console.log("Captured", log.length, "frames;", report.unsettled, "not fully settled;", errors.length, "page errors");
  // More than 2% of frames with tiles still loading would show as flicker.
  if (RANGE !== "preview" && report.unsettled > Math.ceil(log.length * 0.02)) throw new Error(report.unsettled + " frames captured before tiles settled");
} catch (error) {
  report.failure = String(error?.stack ?? error);
  save();
  throw error;
} finally {
  await browser.close();
}
