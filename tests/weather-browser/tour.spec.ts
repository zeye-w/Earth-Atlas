import { test, expect } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe } from "../e2e/mocks";

test("terminator travel can switch sides, pause, resume and exits on Escape", async ({
  page,
}) => {
  await mockNetwork(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(sceneUrl(110, 22, 18_000_000, { dayNight: false }));
  await waitForGlobe(page);
  await page.getByRole("button", { name: "晨昏线旅行", exact: true }).click();
  const tour = page.getByRole("region", { name: "晨昏线旅行", exact: true });
  await expect(tour).toBeVisible();
  await expect(page.getByText(/追逐日出/)).toBeVisible();
  await page.getByRole("button", { name: "暂停旅行", exact: true }).click();
  await expect(page.getByText(/镜头已暂停/)).toBeVisible();
  await page.getByRole("button", { name: "日落侧", exact: true }).click();
  await page.getByLabel("旅行速度", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "继续旅行", exact: true }).click();
  await expect(page.getByText(/追逐日落/)).toBeVisible();
  await page
    .locator(".cesium-widget canvas")
    .click({ position: { x: 720, y: 250 } });
  await expect(page.getByText(/镜头已暂停/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tour).toHaveCount(0);
  await page.getByRole("button", { name: "分享当前场景", exact: true }).click();
  const shared = new URL(await page.locator("#scene-share-url").inputValue());
  const scene = JSON.parse(
    new URLSearchParams(shared.hash.slice(1)).get("scene")!,
  );
  expect(scene.layers.dayNight).toBe(false);
  expect(errors).toEqual([]);
});
