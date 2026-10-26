import { expect, test } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { mockNetwork, sceneUrl, waitForGlobe } from "./mocks";

// Decode Chromium's 8-bit RGB/RGBA PNG screenshots with Node only (no new dependency).
// Count warm/pink spark pixels in the central view, excluding the panels and toolbar.
function centralSparkPixels(png: Buffer): number {
  return sparkScan(png).count;
}

// TEMPORARY CI diagnostic for PR #31: what do the matching pixels look like after stopping?
function sparkScan(png: Buffer) {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const channels = png[25] === 6 ? 4 : 3;
  expect(png[24]).toBe(8);
  expect([2, 6]).toContain(png[25]);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels;
  let previous = Buffer.alloc(stride), count = 0;
  const sum = [0, 0, 0], box = [Infinity, Infinity, -Infinity, -Infinity], map = new Map<string, number>(), samples: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(stride), start = y * (stride + 1), filter = raw[start];
    expect(filter).toBeLessThanOrEqual(4);
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels] : 0, above = previous[i], corner = i >= channels ? previous[i - channels] : 0;
      const p = left + above - corner;
      const paeth = Math.abs(p - left) <= Math.abs(p - above) && Math.abs(p - left) <= Math.abs(p - corner) ? left : Math.abs(p - above) <= Math.abs(p - corner) ? above : corner;
      const prediction = filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth : 0;
      row[i] = (raw[start + 1 + i] + prediction) & 255;
    }
    if (y > height * 0.2 && y < height * 0.75) for (let x = Math.ceil(width * 0.3); x < width * 0.7; x++) {
      const i = x * channels, r = row[i], g = row[i + 1], b = row[i + 2];
      if (r > 180 && b > 100 && r > g * 1.15) {
        count++; sum[0] += r; sum[1] += g; sum[2] += b;
        box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
        const cell = Math.floor(x / width * 24) + "," + Math.floor(y / height * 12); map.set(cell, (map.get(cell) ?? 0) + 1);
        if (samples.length < 8 && count % 7 === 1) samples.push([x, y, r, g, b]);
      }
    }
    previous = row;
  }
  return { count, mean: sum.map((v) => Math.round(v / Math.max(1, count))), box, cells: [...map.entries()].slice(0, 20), samples };
}

test("fireworks can be launched and stopped without changing scientific layers", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockNetwork(page);
  await page.goto("/");
  await waitForGlobe(page);
  const panel = page.locator("#earth-layer-panel");
  const group = panel.locator("details.layer-group", { has: page.locator("summary", { hasText: "EXPERIENCES" }) });
  await group.locator(":scope > summary").click();
  await expect(group).toContainText("烟花表演");
  await group.getByRole("radio", { name: "环形" }).click();
  await group.getByRole("button", { name: "东京" }).click();
  await expect(group).toContainText("地点：东京");
  await group.getByRole("button", { name: "开始烟花表演" }).click();
  await expect(group.getByRole("button", { name: "重新播放" })).toBeVisible();
  await group.getByRole("button", { name: "停止烟花表演" }).click();
  await expect(group.getByRole("button", { name: "开始烟花表演" })).toBeVisible();
  const tectonics = panel.locator("details.layer-group", { has: page.locator("summary", { hasText: "TECTONICS" }) });
  await tectonics.locator(":scope > summary").click();
  await expect(panel.getByRole("checkbox", { name: "实时地震" })).not.toBeChecked();
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`fireworks burst is visible inside the central ${viewport.width}px view`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mockNetwork(page);
    await page.goto(sceneUrl(116.4074, 39.9042, 2_000_000, {}));
    await waitForGlobe(page);
    const panel = page.locator("#earth-layer-panel");
    if (!(await panel.isVisible())) await page.getByRole("button", { name: "图层", exact: true }).click();
    const group = panel.locator("details.layer-group", { has: page.locator("summary", { hasText: "EXPERIENCES" }) });
    await group.locator(":scope > summary").click();
    await group.getByRole("button", { name: "开始烟花表演" }).click();
    if (viewport.width > 760) await panel.getByRole("button", { name: "收起图层面板" }).click();
    await expect(panel).toHaveCSS("opacity", "0");
    let screenshot!: Buffer;
    await expect.poll(async () => {
      screenshot = await page.screenshot();
      return centralSparkPixels(screenshot);
    }, { timeout: 30_000, intervals: [200, 300, 500], message: "Visible pink sparks must reach the central view, not only its bottom edge" }).toBeGreaterThan(20);
    await testInfo.attach(`fireworks-${viewport.width}`, { body: screenshot, contentType: "image/png" });
    await mkdir(".cache", { recursive: true });
    await writeFile(`.cache/fireworks-${viewport.width}.png`, screenshot);
    await page.getByRole("button", { name: "图层", exact: true }).click();
    await group.getByRole("button", { name: "停止烟花表演" }).click();
    await expect(group.getByRole("button", { name: "开始烟花表演" })).toBeVisible();
    await panel.getByRole("button", { name: "收起图层面板" }).click();
    for (const k of [0, 1, 2, 3, 4, 5]) {
      await page.waitForTimeout(1000);
      const shot = await page.screenshot();
      console.log("PR31-DIAG", viewport.width, k, JSON.stringify(sparkScan(shot)));
      await testInfo.attach(`after-stop-${viewport.width}-${k}`, { body: shot, contentType: "image/png" });
    }
    await expect.poll(async () => centralSparkPixels(await page.screenshot()), {
      timeout: 10_000, message: "Stopping removes sparks; the pixel check must not mistake the background for fireworks",
    }).toBeLessThanOrEqual(5);
  });
}
