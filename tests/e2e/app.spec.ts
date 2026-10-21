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

test("predicts satellite passes over my location and jumps the timeline to one", async ({ page }) => {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 39.9, longitude: 116.4 });
  await page.goto(sceneUrl(116.4, 39.9, 17_000_000, { satellites: true }));
  await waitForGlobe(page);
  await openGroup(page, "SATELLITES");
  await expect(layerPanel(page).locator(".satellite-status")).toContainText("已加载");
  await page.getByRole("button", { name: "使用我的位置" }).click();
  const predictions = layerPanel(page).locator(".pass-predictions");
  await expect(predictions.locator(".layer-status")).toContainText("我的位置（39.9°N 116.4°E）");
  // Synthetic low-Earth orbits pass over any mid-latitude site within a day.
  const first = predictions.locator(".pass-list button").first();
  await expect(first).toContainText("最高");
  await first.click();
  await expect(page.locator(".online-indicator")).toContainText("回看");
});

test("layer groups start collapsed", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  const groups = layerPanel(page).locator("details.layer-group");
  expect(await groups.count()).toBeGreaterThan(3);
  expect(await groups.evaluateAll((all) => all.filter((el) => (el as HTMLDetailsElement).open).length)).toBe(0);
});

test("tracking a satellite shows live telemetry next to it, including from my location", async ({ page }) => {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 39.9, longitude: 116.4 });
  await page.goto(sceneUrl(0, 0, 17_000_000, { satellites: true }));
  await waitForGlobe(page);
  // Permission already granted: the location is shown without asking.
  await expect(page.getByRole("button", { name: "显示我的位置" })).toContainText("我的位置");
  await openGroup(page, "SATELLITES");
  await expect(layerPanel(page).locator(".satellite-status")).toContainText("已加载");
  await page.getByRole("button", { name: "跟踪 ISS · 国际空间站" }).click();
  const card = page.locator(".track-card");
  await expect(card).toContainText("ISS · 国际空间站");
  await expect(card).toContainText(/高度\s*\d+\.\d km/);
  await expect(card).toContainText(/速度\s*7\.\d\d km\/s/);
  await expect(card).toContainText("从我的位置看");
  await card.getByRole("button", { name: "停止跟踪" }).click();
  await expect(card).toHaveCount(0);
});

test("clouds follow the timeline and say when a moment has no frame", async ({ page }) => {
  await page.goto(sceneUrl(0, 0, 17_000_000, { clouds: true }));
  await waitForGlobe(page);
  await openGroup(page, "EARTH VIEW");
  const note = layerPanel(page).locator(".cloud-controls .thematic-note").first();
  await expect(note).toContainText("观测时间");
  // The mocked catalog only has a frame from 30 minutes ago.
  await page.getByRole("button", { name: "打开时间轴" }).click();
  await page.getByRole("button", { name: "向前一步" }).click();
  await expect(note).toContainText("这一时刻没有云图");
});

test("the Starlink constellation loads and follows the timeline", async ({ page }) => {
  await page.goto(sceneUrl(0, 0, 17_000_000, { starlink: true }));
  await waitForGlobe(page);
  await openGroup(page, "SATELLITES");
  const status = layerPanel(page).locator(".layer-extra .layer-status").first();
  await expect(status).toContainText("240 颗卫星");
  await expect(layerPanel(page)).toContainText("53° 120 颗");
  // Far beyond the elements' validity, nothing is drawn rather than guessed.
  await page.getByRole("button", { name: "打开时间轴" }).click();
  await page.getByRole("radio", { name: "30 天" }).click();
  for (let i = 0; i < 12; i++) await page.getByRole("button", { name: "向前一步" }).click();
  await expect(status).toContainText("240 颗根数距所选时刻超过 10 天未显示");
});

test("live flights load, describe a clicked aircraft and hide away from live", async ({ page }) => {
  await page.goto(sceneUrl(0, 0, 8_000_000, { flights: true }));
  await waitForGlobe(page);
  await openGroup(page, "AVIATION");
  const status = layerPanel(page).getByRole("status").filter({ hasText: "航空器" });
  await expect(status).toContainText("42 架航空器 · 空中 41 架");
  await expect(layerPanel(page)).toContainText("来源：adsb.lol（ODbL）");
  // The cruising aircraft sits under the camera at the centre of the globe.
  const canvas = page.locator(".cesium-widget canvas");
  await expect(async () => {
    // Re-measure each time: a click that misses opens the inspector and resizes the globe.
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator(".toast")).toContainText("E2E101 · A20N B-E2E1 · 高度 10,973 m · 地速 833 km/h · 航向 90°", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  // No flight history: away from live the layer says so and draws nothing.
  await page.getByRole("button", { name: "打开时间轴" }).click();
  await page.getByRole("button", { name: "向前一步" }).click();
  await expect(layerPanel(page)).toContainText("航班数据只有实时位置");
});

test("solar wind drives the magnetopause and says when there is no data", async ({ page }) => {
  await page.goto(sceneUrl(0, 0, 17_000_000, { solarWind: true }));
  await waitForGlobe(page);
  await openGroup(page, "EARTH VIEW");
  const panel = layerPanel(page).locator(".solar-wind-panel");
  await expect(panel).toContainText("450 km/s");
  await expect(panel).toContainText("Bz -6.0 nT（南向）");
  // 6 cm^-3 at 450 km/s is 2.03 nPa; with Bz -6 nT the Shue standoff is ~9.2 Earth radii.
  await expect(panel).toContainText(/磁层顶距地心 9\.\d 个地球半径/);
  await panel.getByRole("button", { name: "拉远查看磁层" }).click();
  // The mocked feed covers two hours: a day earlier there is nothing to draw.
  await page.getByRole("button", { name: "打开时间轴" }).click();
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "向前一步" }).click();
  await expect(layerPanel(page)).toContainText("这一时刻没有太阳风数据");
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

test("recording mode exposes the capture API only with ?record", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  expect(await page.evaluate(() => "__terrascope" in window)).toBe(false);
  await page.goto("about:blank");
  await page.goto("/?record" + sceneUrl(10, 20, 17_000_000, {}).slice(1));
  await page.waitForFunction(() => "__terrascope" in window);
  const loaded = await page.evaluate(async () => {
    const api = (window as unknown as { __terrascope: { ready(): Promise<void>; setUi(m: string): void; setTime(t: number | null): void; setCamera(p: object): void; idle(ms?: number): Promise<boolean> } }).__terrascope;
    await api.ready();
    api.setUi("clean");
    api.setTime(Date.now() - 6 * 3_600_000);
    api.setCamera({ longitude: 30, latitude: 10, height: 15_000_000 });
    return api.idle(20_000);
  });
  expect(loaded).toBe(true);
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator("#earth-layer-panel")).toBeHidden();
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

test("Live Photo: without an H.264 encoder the panel says so, also on a phone", async ({ page }) => {
  await page.addInitScript(() => { delete (window as { VideoEncoder?: unknown }).VideoEncoder; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(sceneUrl(100, 20, 17_000_000, {}));
  await waitForGlobe(page);
  const opener = page.getByRole("button", { name: "录制 iPhone 实况图", exact: true });
  await opener.click();
  const panel = page.getByRole("dialog", { name: "录制 iPhone 实况图" });
  await expect(panel.getByRole("alert")).toContainText("不支持 H.264");
  await expect(panel.getByRole("button", { name: "录制当前场景 · 3 秒", exact: true })).toBeDisabled();
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(opener).toBeFocused();
});
