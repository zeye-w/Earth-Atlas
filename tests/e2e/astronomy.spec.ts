import { expect, test, type Page } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe, showLayerGroup } from "./mocks";

const layerPanel = (page: Page) => page.locator("#earth-layer-panel");
async function openGroup(page: Page, name: string) {
  await showLayerGroup(page, name);
  const details = layerPanel(page).locator("details", { has: page.locator("summary", { hasText: name }) });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator(":scope > summary").click();
}

// Everything here is computed in the browser: no network beyond the usual mocks.
test.beforeEach(async ({ page }) => { await mockNetwork(page); });

test("the Moon layer shows the phase and the next principal phases", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sceneUrl(116, 30, 20_000_000, { moon: true }));
  await waitForGlobe(page);
  await openGroup(page, "ASTRONOMY");
  const section = layerPanel(page).locator(".astro-section").first();
  await expect(section.locator(".layer-status")).toContainText(/(新月|蛾眉月|上弦月|盈凸月|满月|亏凸月|下弦月|残月) · 亮面 \d+% · 距离 [\d,]+ 公里/, { timeout: 30_000 });
  await expect(section.locator(".astro-list li")).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("eclipses: the 2027 total eclipse opens its card, and the shadow clock runs", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sceneUrl(30, 25, 20_000_000, {}));
  await waitForGlobe(page);
  await openGroup(page, "ASTRONOMY");
  await layerPanel(page).getByRole("checkbox", { name: "日食与月食" }).check({ force: true });
  const item = layerPanel(page).getByRole("button", { name: /日全食 · 2027年8月2日/ });
  await expect(item).toBeVisible({ timeout: 30_000 });
  await expect(item).toContainText("食甚 25.5°N 33.2°E");
  await item.click();
  const card = page.locator(".eclipse-card");
  await expect(card).toContainText("日全食");
  await expect(card).toContainText(/全食带宽度\s*2[4-7]\d km/);
  const slider = card.getByRole("slider", { name: "日食进程" });
  const before = await slider.inputValue();
  await card.getByRole("button", { name: "播放月影" }).click();
  await expect.poll(() => slider.inputValue(), { timeout: 10_000 }).not.toBe(before);
  await card.getByRole("button", { name: "暂停" }).click();
  // Closing the card gives the globe back to the timeline.
  await card.getByRole("button", { name: "关闭" }).click();
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("meteor showers list the ten showers and pick one for the map", async ({ page }) => {
  await page.goto(sceneUrl(116, 30, 20_000_000, { meteors: true }));
  await waitForGlobe(page);
  await openGroup(page, "ASTRONOMY");
  const list = layerPanel(page).locator(".astro-section .astro-list").first();
  await expect(list.locator("li")).toHaveCount(10, { timeout: 30_000 });
  const geminids = list.getByRole("button", { name: /双子座流星雨/ });
  await geminids.click();
  await expect(geminids).toHaveClass(/selected/);
  await expect(geminids).toContainText("每小时约 150 颗");
});

test("tonight for my location lists darkness, the Moon and the next eclipse", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 39.9, longitude: 116.4 });
  await page.goto(sceneUrl(116, 30, 20_000_000, {}));
  await waitForGlobe(page);
  await openGroup(page, "ASTRONOMY");
  await layerPanel(page).locator(".tonight").getByRole("button", { name: "使用我的位置" }).click();
  const result = layerPanel(page).locator(".tonight-result");
  await expect(result).toContainText("我的位置", { timeout: 30_000 });
  for (const row of ["天黑", "月亮", "行星", "流星雨", "下次日月食"]) await expect(result).toContainText(row);
});
