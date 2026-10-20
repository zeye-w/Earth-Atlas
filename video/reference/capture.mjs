/**
 * Reference capture for video/shots.json using the site's recording mode
 * (src/recording.ts). It defines the protocol; the Remotion project may
 * reuse or replace it.
 *
 *   node --experimental-strip-types video/reference/capture.mjs \
 *     --base http://localhost:4173/ --mode stills --out video/preview [--shot s5-iss]
 *
 * --mode stills  first / middle / last frame of each shot (framing review)
 * --mode frames  every frame at the output fps (PNG sequence per shot)
 * --anchor 2026-10-18  override the anchor day D (default: two days ago, UTC)
 *
 * Set PW_CHROMIUM_PATH to use a preinstalled Chromium.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { subsolarPoint } from "../../src/solar.ts";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1]]] : pairs), []));
const spec = JSON.parse(readFileSync(new URL("../shots.json", import.meta.url), "utf8"));
const BASE = args.base ?? spec.site.baseUrl;
const MODE = args.mode ?? "stills";
const OUT = args.out ?? "video/preview";
const { width, height, fps } = spec.output;
const HOUR = 3_600_000;

const DAY = 86_400_000;
const anchor = args.anchor ? Date.parse(args.anchor + "T00:00:00Z") : Math.floor(Date.now() / DAY) * DAY - 2 * DAY;

const easings = {
  linear: (t) => t,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
};
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;
const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Keyframe values at shot progress t (0..1). */
function keyframeAt(keyframes, t, easing) {
  const e = easings[easing](t);
  let i = 0;
  while (i < keyframes.length - 2 && keyframes[i + 1].t < e) i++;
  const [a, b] = [keyframes[i], keyframes[i + 1] ?? keyframes[i]];
  const local = b.t === a.t ? 0 : (e - a.t) / (b.t - a.t);
  const out = {};
  for (const key of Object.keys(a)) {
    if (key === "t") continue;
    out[key] = key === "longitude" || key === "heading" || key === "headingOffset" ? lerpAngle(a[key], b[key], local) : lerp(a[key], b[key], local);
  }
  return out;
}

function sceneTime(shot, t) {
  if (shot.time.mode === "live") return null;
  const hours = lerp(shot.time.fromHours, shot.time.toHours, t);
  // Hourly stills land exactly on the hour (cloud frames are hourly).
  return anchor + (shot.time.mode === "hourly-stills" ? Math.round(hours) : hours) * HOUR;
}

function sceneUrl(shot) {
  const layers = { ...spec.defaults.layers, ...(shot.layers ?? {}) };
  const options = { ...spec.defaults.options, ...(shot.options ?? {}), ...(shot.atmosphereShells ? { atmosphereShells: shot.atmosphereShells } : {}) };
  // The first pose seeds the page; the script sets the camera per frame anyway.
  const scene = { v: 1, camera: [0, 0, 20_000_000, 0, -Math.PI / 2 + 1e-6, 0], layers, options };
  return BASE + spec.site.recordQuery + "#scene=" + encodeURIComponent(JSON.stringify(scene));
}

async function applyFrame(page, shot, t, shotSeconds) {
  const time = sceneTime(shot, t);
  const easing = shot.camera.easing ?? spec.defaults.easing;
  const pose = keyframeAt(shot.camera.keyframes, t, easing);
  await page.evaluate(async ({ shot, time, pose, shotSeconds }) => {
    const api = window.__terrascope;
    api.setTime(time);
    if (shot.effects?.auroraShimmer) api.setEffectsTime(shotSeconds * shot.effects.auroraShimmer.secondsPerSecond);
    if (shot.camera.type === "lookAtSatellite") {
      const sat = api.satellite(shot.camera.satellite);
      if (!sat) throw new Error("satellite " + shot.camera.satellite + " unavailable at this time");
      api.lookAt({ longitude: sat.longitude, latitude: sat.latitude, height: sat.altitudeKm * 1000, heading: sat.headingDeg + pose.headingOffset, pitch: pose.pitch, range: pose.range });
    } else {
      api.setCamera(pose);
    }
    return api.idle(45_000);
  }, { shot, time, pose: shot.camera.longitudeRef === "antisolar" ? { ...pose, longitude: wrap(subsolarPoint(new Date()).longitude + 180 + pose.longitude) } : pose, shotSeconds });
}

async function captureShot(browser, shot) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => console.warn(shot.id, "page error:", error.message));
  await page.goto("about:blank");
  await page.goto(sceneUrl(shot));
  await page.waitForFunction(() => window.__terrascope, null, { timeout: 60_000 });
  await page.evaluate(async ({ ui, track }) => {
    const api = window.__terrascope;
    await api.ready();
    api.setUi(ui);
    api.showTrackCard(track ?? null);
  }, { ui: shot.ui ?? spec.defaults.ui, track: shot.trackCard });
  if (shot.camera.type === "lookAtSatellite") {
    await page.waitForFunction((id) => window.__terrascope.satellite(id) !== null, shot.camera.satellite, { timeout: 60_000 });
  }
  const duration = shot.end - shot.start;
  const count = MODE === "frames" ? Math.round(duration * fps) : 3;
  const dir = OUT + (MODE === "frames" ? "/" + shot.id : "");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    await applyFrame(page, shot, t, t * duration);
    const name = MODE === "frames" ? dir + "/" + String(i).padStart(4, "0") + ".png" : dir + "/" + shot.id + "-" + ["a", "b", "c"][i] + ".jpg";
    await page.screenshot({ path: name, ...(MODE === "frames" ? {} : { type: "jpeg", quality: 85 }), timeout: 180_000 });
  }
  console.log("captured", shot.id, count, "frame(s)");
  await page.close();
}

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
console.log("anchor D =", new Date(anchor).toISOString());
const shots = spec.shots.filter((shot) => shot.type !== "remotion-only" && (!args.shot || shot.id === args.shot));
const failed = [];
for (const shot of shots) {
  try { await captureShot(browser, shot); }
  catch (error) { console.warn(shot.id, "failed:", error.message); failed.push(shot.id); }
}
await browser.close();
if (failed.length) { console.log("::warning::not captured: " + failed.join(", ")); process.exitCode = 1; }
