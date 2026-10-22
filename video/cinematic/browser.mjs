/**
 * Browser plumbing shared by the plan and the capture: one Chromium page on
 * the local build in recording mode, and the data snapshot. The plan records
 * every live-data response once; each capture job replays exactly those, so
 * all chunks show the same real data, captured at one moment.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { chromium } from "@playwright/test";
import { PICTURE_HEIGHT, WIDTH } from "./story.mjs";

/** Requests that carry live data (everything else, e.g. imagery tiles, loads normally). */
export const isLiveData = (url) => /celestrak\.org|services\.swpc\.noaa\.gov/.test(url.hostname) || url.pathname === "/api/flights";

const keyOf = (url) => createHash("sha1").update(url).digest("hex").slice(0, 16);

export async function openPage({ site, scene, viewport = { width: WIDTH, height: PICTURE_HEIGHT } }) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.setDefaultTimeout(300_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push("JS " + error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push("console " + message.text().slice(0, 300)); });
  const url = site.replace(/\/?$/, "/") + "?record#scene=" + encodeURIComponent(JSON.stringify(scene));
  return { browser, page, errors, url };
}

/** Record live-data responses into `dir` (the plan). */
export async function recordData(page, dir, production) {
  mkdirSync(dir, { recursive: true });
  const index = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!isLiveData(url)) return route.continue();
    const target = url.pathname === "/api/flights" ? new URL("/api/flights", production).toString() : url.toString();
    // A feed can blip; retry a few times before the page sees a failure.
    let response;
    for (let attempt = 1; ; attempt++) {
      response = await route.fetch({ url: target, timeout: 120_000 }).catch((error) => ({ error }));
      if (!response.error && response.ok()) break;
      if (attempt === 4) { if (response.error) throw response.error; break; }
      console.log("retrying", target, response.error ? String(response.error) : "HTTP " + response.status());
      await new Promise((r) => setTimeout(r, 5_000));
    }
    const body = await response.body();
    const file = keyOf(url.toString()) + ".bin";
    writeFileSync(dir + "/" + file, body);
    index.push({ url: url.toString(), status: response.status(), contentType: response.headers()["content-type"] ?? "application/octet-stream", file, bytes: body.length, at: new Date().toISOString() });
    writeFileSync(dir + "/index.json", JSON.stringify(index, null, 2));
    await route.fulfill({ status: response.status(), headers: { "content-type": index.at(-1).contentType, "access-control-allow-origin": "*" }, body });
  });
  return index;
}

/** Replay the plan's responses; a live-data request missing from it fails the capture. */
export async function replayData(page, dir, missing) {
  const index = JSON.parse(readFileSync(dir + "/index.json", "utf8"));
  const byUrl = new Map(index.map((entry) => [entry.url, entry]));
  const byPath = new Map(index.map((entry) => { const u = new URL(entry.url); return [u.origin + u.pathname + "?" + [...u.searchParams.keys()].sort().join("&"), entry]; }));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!isLiveData(url)) return route.continue();
    const entry = byUrl.get(url.toString()) ?? byPath.get(url.origin + url.pathname + "?" + [...url.searchParams.keys()].sort().join("&"));
    if (!entry || !existsSync(dir + "/" + entry.file)) { missing.push(url.toString()); return route.abort(); }
    await route.fulfill({ status: entry.status, headers: { "content-type": entry.contentType, "access-control-allow-origin": "*" }, body: readFileSync(dir + "/" + entry.file) });
  });
}

/** Panel texts that say each layer has its real data. */
export const READY = {
  satellites: /已加载\s+[1-9]\d*\s+颗卫星/,
  starlink: /[1-9][\d,]*\s+颗卫星.*根数获取于/,
  flights: /[1-9][\d,]*\s+架航空器/,
  solarWind: /磁层顶距地心/,
  aurora: /预报时间|当前预报无明显极光/,
};
/** Panel texts that mean the data is missing: never film a layer without it. */
const FAILED = /暂不可用|加载失败|不会绘制虚构/;

export async function waitForLayers(page, keys, timeout = 240_000) {
  const started = Date.now();
  for (const key of keys) {
    const pattern = READY[key];
    for (;;) {
      const text = await page.locator("#earth-layer-panel").textContent();
      if (pattern.test(text)) break;
      // A failed feed is retried by the page on its next refresh: keep waiting,
      // and only give up (never film without the data) at the timeout.
      if (Date.now() - started > timeout) {
        const reason = FAILED.test(text) ? "live data unavailable (" + (text.match(/[^。]*(暂不可用|加载失败)[^。]*/)?.[0] ?? "") + ")" : "not ready";
        throw new Error(key + ": " + reason + " after " + timeout / 1000 + " s");
      }
      await page.waitForTimeout(500);
    }
  }
}
