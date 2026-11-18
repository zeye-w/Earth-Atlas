import { expect, test, type Page } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe, showLayerGroup } from "./mocks";

const layerPanel = (page: Page) => page.locator("#earth-layer-panel");
async function openDeepSpace(page: Page) {
  await showLayerGroup(page, "DEEP SPACE");
  const details = layerPanel(page).locator("details", { has: page.locator("summary", { hasText: "DEEP SPACE" }) });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator(":scope > summary").click();
}

test("asteroids and probes list from /api/space, and an asteroid opens the cislunar view", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockNetwork(page);
  await page.goto(sceneUrl(116, 30, 20_000_000, {}));
  await waitForGlobe(page);
  await openDeepSpace(page);
  await layerPanel(page).getByRole("checkbox", { name: "近地小行星" }).check({ force: true });
  await layerPanel(page).getByRole("checkbox", { name: "深空探测器" }).check({ force: true });
  const section = layerPanel(page).locator(".deep-space");
  await expect(section).toContainText("1 颗小行星将从 10 倍地月距离以内飞过", { timeout: 30_000 });
  const rock = section.getByRole("button", { name: /E2E AB1/ });
  await expect(rock).toContainText("0.80 倍地月距离");
  await expect(rock).toContainText("11.2 km/s");
  await expect(section.locator(".probes li")).toHaveCount(2);
  await expect(section.locator(".probes")).toContainText("詹姆斯·韦布空间望远镜");
  await expect(section.locator(".probes")).toContainText(/旅行者 1 号.*天文单位.*信号单程 2\d 小时/);
  // Picking it selects it (and flies the camera out to the cislunar view).
  await rock.click();
  await expect(rock).toHaveClass(/selected/);
  expect(errors).toEqual([]);
});

test("a close flyby shows in today's highlights and selects the asteroid", async ({ page }) => {
  await mockNetwork(page, { highlights: "open" });
  await page.goto("/");
  await waitForGlobe(page);
  // The mocks hold a red-alert typhoon, a launch, a big quake and more: the flyby still makes the four.
  const item = page.locator(".highlights li", { hasText: "E2E AB1" });
  await expect(item).toContainText("小行星 E2E AB1 掠过地球", { timeout: 30_000 });
  await item.getByRole("button").click();
  await expect(layerPanel(page).getByRole("button", { name: /E2E AB1/ })).toHaveClass(/selected/, { timeout: 20_000 });
});
