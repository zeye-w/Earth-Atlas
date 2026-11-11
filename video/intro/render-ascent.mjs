/**
 * Render the last shot of the intro video from the app's own globe: straight
 * up from low orbit, through the day's real cloud cover, to the default view
 * the app opens on (17,000 km above 48°N 2°E, north up), so the video hands
 * over to the live globe in place. Run by .github/workflows/intro-video.yml
 * against a local build in recording mode; needs network access for imagery.
 *
 *   node video/intro/render-ascent.mjs http://127.0.0.1:4173 out/frames
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const site = process.argv[2] ?? "http://127.0.0.1:4173";
const out = process.argv[3] ?? "video/intro/out/frames";
mkdirSync(out, { recursive: true });

export const FPS = 30;
const SECONDS = 4, HOLD_FRAMES = 20;
/** From over the Mediterranean coast to the app's home view. */
const START = { longitude: 5.4, latitude: 43.3, height: 250_000, heading: 24 };
const END = { longitude: 2, latitude: 48, height: 17_000_000, heading: 0 };

const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function pose(t) {
  const s = smoother(Math.min(1, Math.max(0, t)));
  // Height eases in log space: equal steps of zoom, not of metres.
  const height = Math.exp(Math.log(START.height) + (Math.log(END.height) - Math.log(START.height)) * s);
  const mix = (a, b) => a + (b - a) * s;
  return { longitude: mix(START.longitude, END.longitude), latitude: mix(START.latitude, END.latitude), height, heading: mix(START.heading, END.heading), pitch: -90 };
}

const browser = await chromium.launch({
  headless: true, executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(300_000);
page.on("pageerror", (error) => console.log("JS", error.message));
await page.goto(site.replace(/\/?$/, "/") + "?record&lang=en");
await page.waitForFunction(() => "__terrascope" in window);
// Two days ago at 11:00 UTC: that day's mosaic is complete and Europe is in full daylight.
const day = new Date(Date.now() - 2 * 86_400_000);
const time = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 11);
await page.evaluate(async (time) => {
  const api = window.__terrascope;
  await api.ready();
  api.setUi("clean");
  api.setTime(time);
  api.setLayers({ trueColor: true, dayNight: true, atmosphere: true, clouds: false, cities: false, geoLabels: false, lights: false, aurora: false, satellites: false, paths: false });
}, time);

const frames = SECONDS * FPS;
for (let i = 0; i < frames + HOLD_FRAMES; i++) {
  const settled = await page.evaluate(async (pose) => {
    const api = window.__terrascope;
    api.setCamera(pose);
    return api.idle(20_000);
  }, pose(i / (frames - 1)));
  // The last frames repeat the end pose: the video rests on the home view.
  await page.locator(".cesium-widget canvas").screenshot({ path: `${out}/f${String(i).padStart(4, "0")}.png` });
  if (i % 10 === 0 || !settled) console.log("frame", i, "height km", Math.round(pose(i / (frames - 1)).height / 1000), settled ? "" : "(tiles still loading)");
}
await browser.close();
