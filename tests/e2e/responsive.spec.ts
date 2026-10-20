import { expect, test } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe } from "./mocks";

/** Desktop and phones share layer and panel defaults; only globe scale adapts. */
const CASES = [
  { label: "desktop", width: 1440, height: 900, minCameraHeight: 16_900_000, maxCameraHeight: 17_100_000 },
  { label: "phone-portrait", width: 390, height: 844, minCameraHeight: 29_000_000, maxCameraHeight: 38_000_000 },
  { label: "phone-landscape", width: 844, height: 390, minCameraHeight: 26_000_000, maxCameraHeight: 34_000_000 },
] as const;

for (const size of CASES) {
  test(size.label + " defaults, open/close satellite switch and home framing", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockNetwork(page);
    await page.goto("/");
    await waitForGlobe(page);

    const panel = page.locator("#earth-layer-panel");
    const toggle = page.getByRole("button", { name: "图层", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("aria-hidden", "false");
    const box = await panel.boundingBox();
    expect(box, "panel has viewport-sized placement").not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThan(55);
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
    if (size.label === "phone-portrait") {
      expect(box!.height).toBeLessThan(size.height * 0.34);
      expect(box!.y).toBeGreaterThan(size.height * 0.65);
    }

    // Capture the *actual initial state*, with the phone panel still open.
    await page.screenshot({ path: testInfo.outputPath("initial-" + size.label + ".png") });

    await panel.locator("summary", { hasText: "SATELLITES" }).click();
    const satellite = page.getByRole("checkbox", { name: "真实卫星轨道" });
    const paths = page.getByRole("checkbox", { name: "显示前后约 45 分钟预测轨迹" });
    await expect(satellite).toBeChecked();
    await expect(paths).toBeChecked();
    await expect(panel.locator(".satellite-status")).toContainText("已加载");

    // Panel toggle should close/reopen exactly like desktop, preserving toggles.
    await page.getByRole("button", { name: "收起图层面板" }).click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();
    await expect(satellite).toBeChecked();
    await satellite.uncheck({ force: true });
    await expect(satellite).not.toBeChecked();
    await satellite.check({ force: true });
    await expect(satellite).toBeChecked();

    // Share serializes current camera; compare projected home altitude, not
    // snapshots whose cloud/lighting textures may differ across CI runners.
    await page.getByRole("button", { name: "分享当前场景" }).click();
    const share = await page.locator("#scene-share-url").inputValue();
    const raw = new URL(share).hash.slice(1);
    const serialized = new URLSearchParams(raw).get("scene");
    expect(serialized).toBeTruthy();
    const saved = JSON.parse(serialized!);
    expect(saved.camera[0]).toBeCloseTo(58, 1);
    expect(saved.camera[1]).toBeCloseTo(19, 1);
    expect(saved.camera[2]).toBeGreaterThan(size.minCameraHeight);
    expect(saved.camera[2]).toBeLessThan(size.maxCameraHeight);
    expect(saved.layers.satellites).toBe(true);
    expect(saved.layers.paths).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("explicit shared-scene camera is preserved on mobile, and reset uses portrait framing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockNetwork(page);
  await page.goto(sceneUrl(116.4, 39.9, 4_000_000, { satellites: false }));
  await waitForGlobe(page);
  const toggle = page.getByRole("button", { name: "图层", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "分享当前场景" }).click();
  let raw = new URL(await page.locator("#scene-share-url").inputValue()).hash.slice(1);
  let shared = JSON.parse(new URLSearchParams(raw).get("scene")!);
  expect(shared.camera[0]).toBeCloseTo(116.4, 1);
  expect(shared.camera[1]).toBeCloseTo(39.9, 1);
  expect(shared.camera[2]).toBeCloseTo(4_000_000, -4);
  expect(shared.layers.satellites).toBe(false);

  await page.getByRole("button", { name: "关闭分享" }).click();
  await page.getByRole("button", { name: "重置视角" }).click();
  await page.waitForTimeout(2300);
  await page.getByRole("button", { name: "分享当前场景" }).click();
  raw = new URL(await page.locator("#scene-share-url").inputValue()).hash.slice(1);
  shared = JSON.parse(new URLSearchParams(raw).get("scene")!);
  expect(shared.camera[0]).toBeCloseTo(58, 1);
  expect(shared.camera[1]).toBeCloseTo(19, 1);
  expect(shared.camera[2]).toBeGreaterThan(29_000_000);
});
