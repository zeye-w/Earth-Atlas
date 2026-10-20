import { expect, test, type Page } from "@playwright/test";
import { ETNA, QUAKE_POINT, mockNetwork, sceneUrl, waitForGlobe } from "./mocks";

let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mockNetwork(page);
});

test.afterEach(() => {
  expect(pageErrors, "uncaught page errors").toEqual([]);
});

const layerPanel = (page: Page) => page.locator("#earth-layer-panel");
const inspector = (page: Page) => page.locator("#earth-inspector-panel");
const groupSummary = (page: Page, name: string) => layerPanel(page).locator("summary", { hasText: name });

async function openGroup(page: Page, name: string) {
  const details = layerPanel(page).locator("details", { has: page.locator("summary", { hasText: name }) });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await groupSummary(page, name).click();
}

test("starts up, dismisses the splash and shows the main controls", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  await expect(page.locator(".brand-name")).toHaveText("TERRASCOPE");
  await expect(page.getByRole("button", { name: "图层", exact: true })).toBeVisible();
  await expect(layerPanel(page)).toBeVisible();
  await expect(page.locator(".globe-attribution")).toContainText("USGS");
});

test("toggling a layer never scrolls the glass card itself", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  await openGroup(page, "GEOLOGY");
  await page.getByRole("checkbox", { name: "全球地质图" }).check({ force: true });
  await expect.poll(() => layerPanel(page).evaluate((el) => el.scrollTop)).toBe(0);
  const box = await layerPanel(page).boundingBox();
  expect(box?.y).toBeGreaterThan(60);
});

test("earthquakes load, report status and open details on click", async ({ page }) => {
  await page.goto(sceneUrl(QUAKE_POINT.longitude, QUAKE_POINT.latitude, 3_000_000, { quakes: true }));
  await waitForGlobe(page);
  await openGroup(page, "TECTONICS");
  await expect(layerPanel(page).locator(".layer-extra .layer-status").first()).toContainText("21 次地震");
  await page.getByRole("button", { name: "收起图层面板" }).click();
  await page.mouse.click(720, 430);
  await expect(inspector(page).locator(".inspect-status")).toHaveText("EARTHQUAKE");
  await expect(inspector(page)).toContainText("M7.1 E2E synthetic event");
});

test("volcanoes load from the bundled catalogue and open details on click", async ({ page }) => {
  await page.goto(sceneUrl(ETNA.longitude, ETNA.latitude, 1_500_000, { volcanoes: true }));
  await waitForGlobe(page);
  await openGroup(page, "TECTONICS");
  await expect(layerPanel(page)).toContainText("座火山");
  await page.getByRole("button", { name: "收起图层面板" }).click();
  await page.mouse.click(720, 430);
  await expect(inspector(page).locator(".inspect-status")).toHaveText("VOLCANO");
  await expect(inspector(page).locator("h2")).toHaveText("Etna");
});

test("clicking the ground queries geology", async ({ page }) => {
  await page.goto(sceneUrl(-100, 40, 3_000_000, {}));
  await waitForGlobe(page);
  await page.getByRole("button", { name: "收起图层面板" }).click();
  await page.mouse.click(720, 430);
  await expect(inspector(page).locator(".inspect-status")).toHaveText("RECORD FOUND");
  await expect(inspector(page)).toContainText("E2E Synthetic Formation");
  await expect(inspector(page)).toContainText("沉积岩");
});

test("aurora and Kp panels show live-data status", async ({ page }) => {
  await page.goto(sceneUrl(0, 70, 17_000_000, { aurora: true }));
  await waitForGlobe(page);
  await openGroup(page, "EARTH VIEW");
  await expect(layerPanel(page)).toContainText("最高可见概率 30%");
  await expect(layerPanel(page).locator(".kp-value")).toHaveText("Kp 2.3");
});

test("satellites load from the orbital catalogue", async ({ page }) => {
  await page.goto(sceneUrl(0, 0, 17_000_000, { satellites: true, paths: true }));
  await waitForGlobe(page);
  await openGroup(page, "SATELLITES");
  await expect(layerPanel(page).locator(".satellite-status")).toContainText("已加载");
  await page.getByRole("radio", { name: "60×" }).click();
  await expect(layerPanel(page).locator(".satellite-preview-note")).toBeVisible();
});

test("clouds show the observation time", async ({ page }) => {
  await page.goto(sceneUrl(0, 0, 17_000_000, { clouds: true }));
  await waitForGlobe(page);
  await openGroup(page, "EARTH VIEW");
  await expect(layerPanel(page).locator(".cloud-controls .thematic-note").first()).toContainText("观测时间");
});

test("atmosphere shells expose the exaggeration warning", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  await openGroup(page, "EARTH VIEW");
  await page.getByRole("checkbox", { name: "大气分层" }).check({ force: true });
  await expect(layerPanel(page).locator(".shell-legend li")).toHaveCount(5);
  await page.getByRole("radio", { name: "放大 20×" }).click();
  await expect(layerPanel(page)).toContainText("高度已放大 20 倍");
});

test("geographic labels are on by default and can be turned off", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  await openGroup(page, "EARTH VIEW");
  const toggle = page.getByRole("checkbox", { name: "地理标注" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck({ force: true });
  await expect(toggle).not.toBeChecked();
});

test("the timeline moves the scene time and replays earthquakes", async ({ page }) => {
  await page.goto(sceneUrl(QUAKE_POINT.longitude, QUAKE_POINT.latitude, 3_000_000, { quakes: true }));
  await waitForGlobe(page);
  await page.getByRole("button", { name: "打开时间轴" }).click();
  await page.getByRole("button", { name: "向前一步" }).click();
  await expect(page.locator(".online-indicator")).toContainText("回看");
  await openGroup(page, "TECTONICS");
  await expect(layerPanel(page).locator(".layer-extra .layer-status").first()).toContainText(/回放：截至所选时刻 1?\d 次地震/);
  await page.getByRole("button", { name: "回到实时", exact: true }).click();
  await expect(page.locator(".online-indicator")).toContainText("LIVE");
  await expect(layerPanel(page).locator(".layer-extra .layer-status").first()).toContainText("21 次地震");
});

test("manual quality choice turns off automatic quality", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  await page.getByRole("button", { name: "显示设置" }).click();
  const auto = page.locator(".settings-toggle input");
  await expect(auto).toBeChecked();
  await page.getByRole("radio", { name: "高清" }).click();
  await expect(auto).not.toBeChecked();
  await expect(page.locator(".app-shell")).toHaveClass(/quality-high/);
});

test("search flies to a place and shared links restore layers", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  await page.getByRole("button", { name: "搜索地点" }).click();
  await page.locator("#place-query").fill("北京");
  await page.locator("#place-query").press("Enter");
  await page.locator(".search-results button").first().click();
  await expect(inspector(page).locator(".coordinate-values")).toContainText("39.9");

  // A hash-only change does not reload the app; start a fresh document.
  await page.goto("about:blank");
  await page.goto(sceneUrl(116, 40, 2_000_000, { quakes: true, plates: true }, { atmosphereShells: 5 }));
  await waitForGlobe(page);
  await openGroup(page, "TECTONICS");
  await expect(page.getByRole("checkbox", { name: "实时地震" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "板块边界" })).toBeChecked();
  await openGroup(page, "EARTH VIEW");
  await expect(page.getByRole("checkbox", { name: "大气分层" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "放大 5×" })).toHaveAttribute("aria-checked", "true");
});
