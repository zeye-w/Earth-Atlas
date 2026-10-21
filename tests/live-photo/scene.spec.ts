import {expect, test} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {mockNetwork, sceneUrl, waitForGlobe} from "../e2e/mocks";

const requireTool = createRequire(new URL("../../tools/live-photo/package.json", import.meta.url));
const {unzipSync, strFromU8} = requireTool("fflate");
test.beforeEach(async ({page}) => {
  await mockNetwork(page);
  await page.goto(sceneUrl(100, 20, 17_000_000, {geoLabels: false}));
  await waitForGlobe(page);
});

test("current globe -> captured clip -> selected cover -> paired Live Photo ZIP", async ({page}) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const quality = (await page.locator(".app-shell").getAttribute("class"))?.match(/quality-\w+/)?.[0];
  await page.getByRole("button", {name: "录制 iPhone 实况图", exact: true}).click();
  const panel = page.getByRole("dialog", {name: "录制 iPhone 实况图"});
  await expect(panel.getByRole("status")).toContainText("已连接");
  await panel.getByRole("button", {name: "录制当前场景 · 3 秒", exact: true}).click();
  await expect(panel.getByLabel("录制片段预览")).toBeVisible({timeout: 30_000});
  await panel.getByRole("slider", {name: "封面时刻"}).fill("1.2");
  await expect.poll(() => panel.locator("video").evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", {name: "导出 iPhone 实况图资源包", exact: true}).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("terrascope-live-photo.zip");
  const files = unzipSync(await readFile((await download.path())!));
  const manifest = JSON.parse(strFromU8(files["scene.json"]));
  expect(manifest.coverTime).toBe(1.2);
  expect(manifest.scene.cameraMotion).toBe("slow-orbit");
  expect(manifest.scene.frames).toBeGreaterThan(14);
  expect(manifest.validation.iPhonePhotosTested).toBe(false);
  expect(files["TERRASCOPE.JPG"].length).toBeGreaterThan(1000);
  expect(files["TERRASCOPE.MOV"].length).toBeGreaterThan(1000);
  expect(await page.locator(".app-shell").getAttribute("class")).toContain(quality!);
  await panel.getByRole("button", {name: "关闭实况图录制", exact: true}).click();
  await page.getByRole("button", {name: "分享当前场景", exact: true}).click();
  const shared = JSON.parse(decodeURIComponent(new URL(await page.locator("#scene-share-url").inputValue()).hash.slice(7)));
  expect(shared.camera[0]).toBeCloseTo(100, 4); expect(shared.camera[1]).toBeCloseTo(20, 4);
  expect(errors).toEqual([]);
});

test("mobile layout and unsupported recording provide an accessible disabled state", async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate(() => Object.defineProperty(window, "MediaRecorder", {value: undefined, configurable: true}));
  const opener = page.getByRole("button", {name: "录制 iPhone 实况图", exact: true});
  await opener.click();
  const panel = page.getByRole("dialog", {name: "录制 iPhone 实况图"});
  await expect(panel.getByRole("alert")).toContainText("不支持");
  await expect(panel.getByRole("button", {name: "录制当前场景 · 3 秒", exact: true})).toBeDisabled();
  const box = await panel.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape"); await expect(panel).toHaveCount(0); await expect(opener).toBeFocused();
});

test("cancelling and closing release recording and permit another attempt", async ({page}) => {
  await page.getByRole("button", {name: "录制 iPhone 实况图", exact: true}).click();
  let panel = page.getByRole("dialog", {name: "录制 iPhone 实况图"});
  await panel.getByRole("button", {name: "录制当前场景 · 3 秒", exact: true}).click();
  await panel.getByRole("button", {name: "取消录制", exact: true}).click();
  await expect(panel.getByRole("button", {name: "录制当前场景 · 3 秒", exact: true})).toBeEnabled();
  await panel.getByRole("button", {name: "录制当前场景 · 3 秒", exact: true}).click();
  await panel.getByRole("button", {name: "关闭实况图录制", exact: true}).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", {name: "录制 iPhone 实况图", exact: true}).click();
  panel = page.getByRole("dialog", {name: "录制 iPhone 实况图"});
  await panel.getByRole("button", {name: "录制当前场景 · 3 秒", exact: true}).click();
  await expect(panel.getByLabel("录制片段预览")).toBeVisible();
});

test("offline packaging service leaves recording and original download available", async ({page}) => {
  await page.route("**/api/live-photo/health", route => route.fulfill({status: 503, contentType: "application/json", body: "{}"}));
  await page.getByRole("button", {name: "录制 iPhone 实况图", exact: true}).click();
  const panel = page.getByRole("dialog", {name: "录制 iPhone 实况图"});
  await expect(panel.getByRole("status")).toContainText("未连接");
  await panel.getByRole("checkbox", {name: "缓慢环绕地球"}).uncheck();
  await panel.getByRole("button", {name: "录制当前场景 · 3 秒", exact: true}).click();
  await expect(panel.getByLabel("录制片段预览")).toBeVisible();
  await expect(panel.getByRole("button", {name: "导出 iPhone 实况图资源包", exact: true})).toBeDisabled();
  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", {name: "保存录制片段", exact: true}).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/terrascope-capture\.(webm|mp4)/);
});
