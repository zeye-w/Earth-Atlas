import { expect, test, type Page } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe } from "./mocks";

const layerPanel = (page: Page) => page.locator("#earth-layer-panel");
async function openGroup(page: Page, name: string) {
  const details = layerPanel(page).locator("details", { has: page.locator("summary", { hasText: name }) });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator(":scope > summary").click();
}

const H = 3_600_000;
/** Synthetic /api/hazards snapshot (not real events): a typhoon centred at 130°E 20°N now. */
function snapshot() {
  const now = Date.now();
  const track = [-36, -30, -24, -18, -12, -6, 0].map((h, i) => ({ time: now + h * H, latitude: 17 + i * 0.5, longitude: 136 - i, windKt: [35, 45, 60, 80, 100, 115, 120][i] }));
  return {
    v: 1, fetched: now - 10 * 60_000,
    events: [
      { id: "E2E_FIRE", title: "E2E Wildfire", category: "wildfires", time: now - 2 * H, latitude: 22, longitude: 126, source: "E2E", url: "https://example.com/fire" },
      { id: "E2E_ICE", title: "E2E Iceberg", category: "seaLakeIce", time: now - 48 * H, latitude: -62, longitude: -40, source: "E2E", url: null },
    ],
    storms: [{
      id: "gdacs-1", name: "CHAMPI", source: "JTWC", alert: "red", countries: ["Philippines", "Japan"], maxWindKmh: 222, advisory: now,
      track, forecast: [{ time: now + 12 * H, latitude: 21.5, longitude: 128, windKt: null }, { time: now + 24 * H, latitude: 23, longitude: 126.5, windKt: null }],
      cone: [[130, 19.5], [126, 22], [126, 24], [130, 20.5], [130, 19.5]],
      swaths: [{ level: "green", ring: [[129, 19], [131, 19], [131, 21], [129, 21], [129, 19]] }],
      report: "https://www.gdacs.org/report.aspx?eventid=1",
    }],
  };
}

test.beforeEach(async ({ page }) => {
  await mockNetwork(page);
  await page.route("**/api/hazards", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot()) }));
});

test("natural events list by category and open their details", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sceneUrl(126, 22, 8_000_000, {}));
  await waitForGlobe(page);
  await openGroup(page, "HAZARDS");
  await layerPanel(page).getByRole("checkbox", { name: "全球自然事件" }).check({ force: true });
  const section = layerPanel(page).locator(".hazard-section").first();
  await expect(section.locator(".layer-status")).toContainText("2 个进行中的事件");
  await expect(section.locator(".hazard-list li")).toHaveCount(2);
  await section.locator(".hazard-chips").getByRole("button", { name: /海冰与冰山/ }).click();
  await expect(section.locator(".hazard-list li")).toHaveCount(1);
  await section.getByRole("button", { name: /E2E Wildfire/ }).click();
  const card = page.locator(".hazard-card");
  await expect(card).toContainText("E2E Wildfire");
  await expect(card).toContainText("山火");
  await expect(card.getByRole("link", { name: "查看来源" })).toHaveAttribute("href", "https://example.com/fire");
  expect(errors).toEqual([]);
});

test("a typhoon shows its Chinese name, grade and alert, and is picked on the globe", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && message.text().includes("rendering")) errors.push(message.text()); });
  await page.goto(sceneUrl(130, 20, 5_000_000, { storms: true }));
  await waitForGlobe(page);
  await openGroup(page, "HAZARDS");
  // Restored from the shared scene.
  await expect(layerPanel(page).getByRole("checkbox", { name: "台风路径" })).toBeChecked();
  const section = layerPanel(page).locator(".hazard-section");
  await expect(section.locator(".layer-status")).toContainText("1 个热带气旋");
  const entry = section.locator(".hazard-list li").first();
  await expect(entry).toContainText("蔷琵（Champi）");
  await expect(entry).toContainText("红色预警");
  // 120 kt ≈ 61.7 m/s: super typhoon on the CMA scale.
  await expect(entry).toContainText("超强台风");
  // Wind of the latest fix at or before the panel's ten-minute step (115 or 120 kt).
  await expect(entry).toContainText(/2(13|22) km\/h/);
  // The storm's marker sits under the camera.
  await page.getByRole("button", { name: "收起图层面板" }).click();
  const canvas = page.locator(".cesium-widget canvas");
  const card = page.locator(".hazard-card");
  await expect(async () => {
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(card).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(card).toContainText("热带气旋");
  await expect(card).toContainText("蔷琵（Champi）");
  await expect(card).toContainText("移动");
  await expect(card).toContainText("西北");
  await expect(card).toContainText("美国联合台风警报中心（JTWC）");
  await expect(page.locator(".cesium-widget-errorPanel")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("English readers get the Saffir–Simpson scale and English names", async ({ page }) => {
  await page.goto("/?lang=en" + sceneUrl(130, 20, 8_000_000, { storms: true }).slice(1));
  await waitForGlobe(page);
  await openGroup(page, "HAZARDS");
  const entry = layerPanel(page).locator(".hazard-section .hazard-list li").first();
  await expect(entry).toContainText("Champi");
  await expect(entry).not.toContainText("蔷琵");
  await expect(entry).toContainText("Category 4");
});

test("unavailable hazard data says so instead of showing events", async ({ page }) => {
  await page.route("**/api/hazards", (route) => route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"Hazard data unavailable"}' }));
  await page.goto("/");
  await waitForGlobe(page);
  await openGroup(page, "HAZARDS");
  await layerPanel(page).getByRole("checkbox", { name: "台风路径" }).check({ force: true });
  await expect(layerPanel(page).locator(".hazard-section .layer-status")).toContainText("灾害数据暂不可用");
});
