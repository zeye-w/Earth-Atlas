/**
 * Capture the README screenshots in docs/screenshots/ from a running build
 * with live data (NASA GIBS, NOAA SWPC, USGS, CelesTrak, Macrostrat, SSEC, adsb.lol).
 * Run by .github/workflows/screenshots.yml; needs open network access.
 *
 * Usage: node --experimental-strip-types scripts/capture-screenshots.mjs [baseURL]
 * Set PW_CHROMIUM_PATH to use a preinstalled Chromium.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { solarElevation, subsolarPoint } from "../src/solar.ts";
import { ADSB_LOL_URL, FLIGHT_USER_AGENT, parseAdsbLol } from "../src/flightData.ts";

const BASE = process.argv[2] ?? "http://localhost:4173";
const OUT = new URL("../docs/screenshots/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const sun = subsolarPoint(new Date());
const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
// Populated regions: the one deepest in night shows the city lights; the one
// closest to dusk anchors the hero shot so the terminator crosses land.
const REGIONS = [[10, 47], [115, 32], [80, 23], [-88, 37], [-55, -15]];
const elevation = ([lon, lat]) => solarElevation(lat, lon, sun);
const [nightLon, nightLat] = REGIONS.reduce((a, b) => (elevation(b) < elevation(a) ? b : a));
const [duskLon] = REGIONS.reduce((a, b) => (Math.abs(elevation(b) + 12) < Math.abs(elevation(a) + 12) ? b : a));
// Shift the hero camera from that region 35° toward the Sun.
const towardSun = Math.sign(wrap(sun.longitude - duskLon)) * 35;

const OFF = {
  clouds: false, geology: false, dayNight: true, cities: false, atmosphere: true, aurora: false, lights: false,
  quakes: false, plates: false, volcanoes: false, satellites: false, paths: false, geoLabels: false,
};
const OPTIONS = { cloudOpacity: 65, opacity: 85, mapMode: "raster", ageFilter: "all", rockFilter: "all", quakeRange: "month" };

function sceneUrl(camera, layers, options = {}, time) {
  const scene = { v: 1, camera, layers: { ...OFF, ...layers }, options: { ...OPTIONS, ...options }, ...(time ? { time } : {}) };
  return BASE + "/#scene=" + encodeURIComponent(JSON.stringify(scene));
}
const topDown = (lon, lat, height) => [lon, lat, height, 0, -Math.PI / 2 + 1e-6, 0];

/** [file, url, { panel group to show open, text to wait for, after() }] */
const SHOTS = [
  ["hero", sceneUrl(topDown(wrap(duskLon + towardSun), 22, 17_500_000), { cities: true, lights: true, geoLabels: true, satellites: true, paths: true }), { group: "EARTH VIEW" }],
  ["night-lights", sceneUrl(topDown(nightLon, nightLat, 6_500_000), { lights: true, cities: true }), {}],
  ["aurora", sceneUrl(topDown(wrap(sun.longitude + 180), 72, 11_000_000), { aurora: true, lights: true }), { group: "EARTH VIEW", wait: "Kp " }],
  ["tectonics", sceneUrl(topDown(150, 12, 13_000_000), { dayNight: false, quakes: true, plates: true, volcanoes: true }), { group: "TECTONICS", wait: "次地震" }],
  ["satellites", sceneUrl(topDown(wrap(sun.longitude), 20, 25_000_000), { satellites: true, paths: true }), { group: "SATELLITES", wait: "已加载" }],
  ["starlink", sceneUrl(topDown(wrap(sun.longitude + 50), 25, 24_000_000), { starlink: true, lights: true }), { group: "SATELLITES", wait: "颗卫星" }],
  ["solar-wind", sceneUrl(topDown(0, 0, 17_000_000), { solarWind: true }), { group: "EARTH VIEW", wait: "km/s", press: "拉远查看磁层" }],
  ["flights", sceneUrl(topDown(8, 49, 4_200_000), { flights: true, lights: true, cities: true }), { group: "AVIATION", wait: "架航空器" }],
  ["geology", sceneUrl(topDown(-104, 39, 4_500_000), { dayNight: false, geology: true, cities: true }), { click: "RECORD FOUND" }],
  ["atmosphere-layers", sceneUrl([wrap(sun.longitude - 10), 0, 1_200_000, Math.PI / 2, -0.45, 0], { dayNight: false, cities: false }, { atmosphereShells: 5 }), { group: "EARTH VIEW" }],
  ["timeline", sceneUrl(topDown(150, 15, 14_000_000), { quakes: true, plates: true, lights: true }, {}, Math.floor((Date.now() - 12 * 86_400_000) / 3_600_000) * 3_600_000), { group: "TECTONICS", wait: "回放" }],
  ["true-color", sceneUrl(topDown(wrap(sun.longitude - 15), 12, 12_500_000), { dayNight: false, trueColor: true }), {}],
  ["geo-labels", sceneUrl(topDown(116, 30, 6_500_000), { dayNight: false, cities: true, geoLabels: true }), {}],
  ["clouds", sceneUrl(topDown(wrap(sun.longitude), 12, 17_000_000), { dayNight: false, clouds: true }), {}],
];

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

async function capture(file, url, { group, wait, click, press } = {}, viewport = { width: 1600, height: 900 }) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (error) => console.warn(file, "page error:", error.message));
  // `vite preview` has no Worker: answer /api/flights the way worker/index.ts does.
  await page.route("**/api/flights", async (route) => {
    const response = await fetch(ADSB_LOL_URL, { headers: { "User-Agent": FLIGHT_USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(parseAdsbLol(await response.json())) });
  });
  try {
    // Fresh document per shot: a hash-only change would not reload the app.
    await page.goto("about:blank");
    await page.goto(url);
    await page.locator("#splash").waitFor({ state: "detached", timeout: 60_000 });
    const panel = page.locator("#earth-layer-panel");
    const panelOpen = async () => !(await panel.getAttribute("class"))?.includes("is-collapsed");
    if (group) {
      if (!(await panelOpen())) await page.getByRole("button", { name: "图层", exact: true }).click();
      // Show only the group that matches this shot.
      await panel.evaluate((el, g) => {
        for (const details of el.querySelectorAll("details")) details.open = Boolean(details.querySelector("summary")?.textContent?.includes(g));
      }, group);
    } else if (await panelOpen()) {
      await page.getByRole("button", { name: "收起图层面板" }).click();
    }
    if (wait) await page.getByText(wait).first().waitFor({ timeout: 60_000 }).catch(() => console.warn(file, "did not show", wait));
    if (press) {
      await page.getByRole("button", { name: press }).click();
      await page.waitForTimeout(4_000);
    }
    if (click) {
      await page.waitForTimeout(8_000);
      await page.mouse.click(viewport.width / 2, viewport.height / 2);
      await page.getByText(click).first().waitFor({ timeout: 60_000 }).catch(() => console.warn(file, "did not show", click));
    }
    // Imagery tiles stream in for a while on a software renderer.
    await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 30_000));
    // Animated layers (aurora, satellites) keep a software renderer busy.
    await page.screenshot({ path: new URL(file + ".jpg", OUT).pathname, type: "jpeg", quality: 86, timeout: 180_000 });
    console.log("captured", file);
  } finally {
    await page.close();
  }
}

const failed = [];
async function tryCapture(...args) {
  try {
    await capture(...args);
  } catch (error) {
    // Keep going: one slow scene should not discard the others.
    console.warn(args[0], "failed:", error.message);
    failed.push(args[0]);
  }
}
for (const [file, url, options] of SHOTS) await tryCapture(file, url, options);
await tryCapture("mobile", sceneUrl(topDown(wrap(sun.longitude + 60), 20, 22_000_000), { cities: true, lights: true, geoLabels: true }), {}, { width: 390, height: 844 });
await browser.close();
if (failed.length) console.log("::warning::screenshots not updated: " + failed.join(", "));
