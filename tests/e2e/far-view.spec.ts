import { expect, test } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe } from "./mocks";

test("zooming far out pauses ground detail and says so; coming back restores it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const faces: string[] = [];
  page.on("request", (request) => { const m = /\/sky\/bg-(1024|2048)-px\.jpg$/.exec(request.url()); if (m) faces.push(m[1]); });
  await mockNetwork(page);
  // Shared scenes may start far out (up to 600,000 km).
  await page.goto(sceneUrl(116, 30, 150_000_000, { satellites: true, starlink: true, cities: true }));
  await waitForGlobe(page);
  const note = page.locator(".far-view-note");
  await expect(note).toHaveText("远景模式 · 已暂停地表细节");
  // The sky uses the sharper faces in the far view (balanced quality would otherwise load 1024 px).
  await expect.poll(() => faces.includes("2048"), { timeout: 20_000 }).toBe(true);
  // Back near the Earth: the note goes and the layers are as they were.
  await page.getByRole("button", { name: "返回全球视角" }).click();
  await expect(note).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator("#earth-layer-panel .opened-layers")).toContainText("星链星座");
  expect(errors).toEqual([]);
});

test("with the default layers the wheel zooms out far enough for the far view", async ({ page }) => {
  await mockNetwork(page);
  await page.goto(sceneUrl(116, 30, 20_000_000));
  await waitForGlobe(page);
  const note = page.locator(".far-view-note");
  await expect(note).toHaveCount(0);
  const canvas = page.locator(".cesium-widget canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await expect.poll(async () => {
    await page.mouse.wheel(0, 2_000);
    return note.count();
  }, { timeout: 30_000, intervals: [300] }).toBe(1);
});
