import { expect, test, type Page } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe, showLayerGroup } from "./mocks";

const layerPanel = (page: Page) => page.locator("#earth-layer-panel");
async function openGroup(page: Page) {
  await showLayerGroup(page, "NEAR-EARTH SPACE");
  const details = layerPanel(page).locator("details", { has: page.locator("summary", { hasText: "NEAR-EARTH SPACE" }) });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator(":scope > summary").click();
}

test("orbit bands, radiation belts, Lagrange points and geosynchronous satellites turn on without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockNetwork(page);
  await page.goto(sceneUrl(116, 30, 20_000_000, {}));
  await waitForGlobe(page);
  await openGroup(page);
  for (const name of ["卫星轨道带", "范艾伦辐射带", "地月拉格朗日点", "同步轨道卫星"]) {
    await layerPanel(page).getByRole("checkbox", { name }).check({ force: true });
  }
  await expect(layerPanel(page).locator(".near-earth-belts")).toContainText("内辐射带 1,274 km–9,557 km");
  await expect(layerPanel(page).getByRole("status").filter({ hasText: /颗地球同步卫星/ })).toBeVisible({ timeout: 30_000 });
  await expect(layerPanel(page).locator(".opened-layers")).toContainText("范艾伦辐射带");
  await layerPanel(page).getByRole("button", { name: "侧视剖面" }).click();
  await page.waitForTimeout(3000);
  await expect(page.locator(".cesium-widget-errorPanel")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the altitude ruler is ordered by height and a click turns on what it shows", async ({ page }) => {
  await mockNetwork(page);
  await page.goto(sceneUrl(116, 30, 20_000_000, {}));
  await waitForGlobe(page);
  await openGroup(page);
  const items = layerPanel(page).locator(".altitude-ruler .ruler-name");
  await expect(items.first()).toHaveText("国际空间站");
  await expect(items.last()).toHaveText(/日地 L2/);
  await layerPanel(page).locator(".altitude-ruler button", { hasText: "外辐射带" }).click();
  await expect(layerPanel(page).getByRole("checkbox", { name: "范艾伦辐射带" })).toBeChecked();
  await layerPanel(page).locator(".altitude-ruler button", { hasText: "月球" }).click();
  await expect(layerPanel(page).getByRole("checkbox", { name: "地月拉格朗日点" })).toBeChecked();
});
