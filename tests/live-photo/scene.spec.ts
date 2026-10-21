import {expect, test} from "@playwright/test";
import {execFileSync, spawnSync} from "node:child_process";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {strFromU8, unzipSync} from "fflate";
import {mockNetwork, sceneUrl, waitForGlobe} from "../e2e/mocks";
import {inspectKeyPhoto} from "../../tools/live-photo/movValidation.mjs";

// Needs H.264 in WebCodecs (Google Chrome / Safari). Writes the pair to
// LIVE_PHOTO_OUT when set, so it can be tried on a real iPhone.
test.beforeEach(async ({page}) => {
  await mockNetwork(page);
  await page.goto(sceneUrl(100, 20, 17_000_000, {geoLabels: false}));
  await waitForGlobe(page);
});

test("current globe -> H.264 clip -> chosen cover -> paired Live Photo, all in the browser", async ({page}) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const quality = (await page.locator(".app-shell").getAttribute("class"))?.match(/quality-\w+/)?.[0];
  await page.getByRole("button", {name: "录制 iPhone 实况图", exact: true}).click();
  const panel = page.getByRole("dialog", {name: "录制 iPhone 实况图"});
  const record = panel.getByRole("button", {name: "录制当前场景 · 3 秒", exact: true});
  await expect(record).toBeEnabled();
  await record.click();
  await expect(panel.getByLabel("录制片段预览")).toBeVisible({timeout: 60_000});
  await panel.getByRole("slider", {name: "封面时刻"}).fill("1.2");
  await panel.getByRole("button", {name: "生成实况图", exact: true}).click();
  await expect(panel.getByRole("status").filter({hasText: "已生成"})).toBeVisible({timeout: 60_000});
  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", {name: "下载实况图资源包（ZIP）", exact: true}).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("terrascope-live-photo.zip");
  const files = unzipSync(readFileSync((await download.path())!));
  expect(Object.keys(files).sort()).toEqual(["TERRASCOPE.JPG", "TERRASCOPE.MOV", "scene.json", "导入说明.txt"].sort());
  const manifest = JSON.parse(strFromU8(files["scene.json"]));
  expect(manifest.coverTime).toBeGreaterThan(1.1); expect(manifest.coverTime).toBeLessThan(1.25);
  expect(manifest.scene.cameraMotion).toBe("slow-orbit");
  expect(manifest.frames).toBeGreaterThan(14);
  // Both halves carry the same content identifier.
  const id: string = manifest.identifier;
  expect(id).toMatch(/^[0-9A-F-]{36}$/);
  expect(Buffer.from(files["TERRASCOPE.JPG"]).includes(Buffer.from(id))).toBe(true);
  expect(Buffer.from(files["TERRASCOPE.MOV"]).includes(Buffer.from(id))).toBe(true);
  const keyPhoto = inspectKeyPhoto(Buffer.from(files["TERRASCOPE.MOV"]));
  expect(keyPhoto.time).toBeCloseTo(manifest.coverTime, 5);
  if (process.env.LIVE_PHOTO_OUT) {
    mkdirSync(process.env.LIVE_PHOTO_OUT, {recursive: true});
    for (const name of ["TERRASCOPE.JPG", "TERRASCOPE.MOV", "scene.json"]) writeFileSync(process.env.LIVE_PHOTO_OUT + "/" + name, files[name]);
    if (spawnSync("ffprobe", ["-version"]).status === 0) {
      const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", process.env.LIVE_PHOTO_OUT + "/TERRASCOPE.MOV"], {encoding: "utf8"}));
      expect(info.format.tags["com.apple.quicktime.content.identifier"]).toBe(id);
      expect(info.streams.find((s: {codec_type: string}) => s.codec_type === "video").codec_name).toBe("h264");
      const decode = spawnSync("ffmpeg", ["-v", "error", "-i", process.env.LIVE_PHOTO_OUT + "/TERRASCOPE.MOV", "-f", "null", "-"], {encoding: "utf8"});
      expect(decode.stderr.trim()).toBe("");
    }
  }
  expect(await page.locator(".app-shell").getAttribute("class")).toContain(quality!);
  // The clip itself is a playable MP4.
  const clipPromise = page.waitForEvent("download");
  await panel.getByRole("button", {name: "保存录制片段", exact: true}).click();
  expect((await clipPromise).suggestedFilename()).toBe("terrascope-capture.mp4");
  await panel.getByRole("button", {name: "关闭实况图录制", exact: true}).click();
  expect(errors).toEqual([]);
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
  await expect(panel.getByLabel("录制片段预览")).toBeVisible({timeout: 60_000});
});
