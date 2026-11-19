import { expect, test, type Page } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe, showLayerGroup } from "./mocks";

const layerPanel = (page: Page) => page.locator("#earth-layer-panel");

test("the solar system lists the planets, flies out to them and fast-forwards", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockNetwork(page);
  await page.goto(sceneUrl(116, 30, 20_000_000, { solarSystem: true }));
  await waitForGlobe(page);
  await showLayerGroup(page, "SOLAR SYSTEM");
  const details = layerPanel(page).locator("details", { has: page.locator("summary", { hasText: "SOLAR SYSTEM" }) });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator(":scope > summary").click();
  const list = layerPanel(page).locator(".space-list.planets li");
  await expect(list).toHaveCount(8, { timeout: 30_000 });
  await expect(list.filter({ hasText: "木星" })).toContainText(/离太阳 5\.\d+ 天文单位/);
  // Out to the outer solar system: the planet names appear over the scene.
  await layerPanel(page).getByRole("button", { name: "外太阳系" }).click();
  await expect(page.locator(".solar-labels span", { hasText: "海王星" })).toBeVisible({ timeout: 20_000 });
  // Fast-forward moves the clock on.
  const clock = layerPanel(page).locator(".solar-clock output");
  const before = await clock.textContent();
  await layerPanel(page).getByRole("radio", { name: "100 天/秒" }).click();
  await layerPanel(page).getByRole("button", { name: "快进" }).click();
  await expect.poll(() => clock.textContent(), { timeout: 10_000 }).not.toBe(before);
  await layerPanel(page).getByRole("button", { name: "暂停" }).click();
  await layerPanel(page).getByRole("button", { name: "回到现在" }).click();
  await expect(clock).toHaveText(before!);
  expect(errors).toEqual([]);
});
