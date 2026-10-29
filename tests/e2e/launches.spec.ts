import { expect, test, type Page } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe } from "./mocks";

const layerPanel = (page: Page) => page.locator("#earth-layer-panel");
async function openGroup(page: Page, name: string) {
  const details = layerPanel(page).locator("details", { has: page.locator("summary", { hasText: name }) });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator(":scope > summary").click();
}

const CAPE = { latitude: 28.5619, longitude: -80.5774 };

/** Synthetic /api/launches snapshot (not real launches). */
function snapshot() {
  const now = Date.now();
  const launch = (id: string, net: number, extra: Record<string, unknown>) => ({
    id, name: "E2E Rocket | " + id, mission: "E2E " + id, missionType: "Test", description: "Synthetic launch for tests.", orbit: "Low Earth Orbit",
    rocket: "E2E Rocket", provider: "E2E Space", status: "go", statusName: "Go for Launch", net, precision: "time",
    windowStart: net, windowEnd: net + 3_600_000, padId: "1", pad: "E2E Pad 1", location: "E2E Cape", country: "US", ...CAPE, webcast: false, ...extra,
  });
  return {
    v: 1, fetched: now - 30 * 60_000,
    launches: [
      launch("Alpha", now + 2 * 86_400_000 + 3_600_000, {}),
      launch("Beta", now + 5 * 86_400_000, { status: "tbd", statusName: "To Be Determined", precision: "day", padId: "2", pad: "E2E Pad 2", location: "E2E Desert", latitude: 40.96, longitude: 100.29 }),
    ],
  };
}

test.beforeEach(async ({ page }) => {
  await mockNetwork(page);
  // Registered last, so it wins over the catch-all router.
  await page.route("**/api/launches", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot()) }));
});

test("the launch calendar lists launches, counts down and plays a virtual launch at the pad", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sceneUrl(CAPE.longitude, CAPE.latitude, 6_000_000, {}));
  await waitForGlobe(page);
  await openGroup(page, "LAUNCHES");
  await layerPanel(page).getByRole("checkbox", { name: "火箭发射日历" }).check({ force: true });
  await expect(layerPanel(page).locator(".launch-calendar .layer-status")).toContainText("2 次发射 · 数据更新于");
  const entries = layerPanel(page).locator(".launch-entry");
  await expect(entries).toHaveCount(2);
  await expect(entries.first()).toContainText("确认发射");
  await expect(entries.first().locator(".launch-clock")).toHaveText(/^T−2d \d\d:\d\d:\d\d$/);
  // Day precision: a date, not a ticking clock.
  await expect(entries.nth(1).locator(".launch-clock")).not.toContainText("T−");
  const first = await entries.first().locator(".launch-clock").textContent();
  await expect(entries.first().locator(".launch-clock")).not.toHaveText(first!, { timeout: 15_000 });

  // Picking the pad marker under the camera selects its next launch.
  const canvas = page.locator(".cesium-widget canvas");
  await expect(async () => {
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(entries.first()).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  const detail = layerPanel(page).locator(".launch-detail");
  await expect(detail).toContainText("Low Earth Orbit");
  await expect(detail).toContainText("E2E Pad 1");

  await detail.getByRole("button", { name: "观看虚拟发射" }).click();
  await openGroup(page, "EXPERIENCES");
  await expect(layerPanel(page).locator(".fireworks-site").first()).toContainText("E2E Cape·28.56°,-80.58°");
  await expect(layerPanel(page).getByRole("button", { name: "停止火箭表演" })).toBeEnabled();
  // The launch details can stop the show they started.
  await detail.getByRole("button", { name: "停止虚拟发射" }).click();
  await expect(layerPanel(page).getByRole("button", { name: "停止火箭表演" })).toBeDisabled();
  await expect(detail.getByRole("button", { name: "观看虚拟发射" })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("reset view ends a virtual launch instead of being pulled back to the rocket", async ({ page }) => {
  await page.goto(sceneUrl(CAPE.longitude, CAPE.latitude, 6_000_000, {}));
  await waitForGlobe(page);
  await openGroup(page, "LAUNCHES");
  await layerPanel(page).getByRole("checkbox", { name: "火箭发射日历" }).check({ force: true });
  await layerPanel(page).locator(".launch-entry").first().click();
  const detail = layerPanel(page).locator(".launch-detail");
  await detail.getByRole("button", { name: "观看虚拟发射" }).click();
  await expect(detail.getByRole("button", { name: "停止虚拟发射" })).toBeVisible();
  // Let the camera reach the pad and start following the rocket.
  await page.waitForTimeout(6_000);
  await page.getByRole("button", { name: "返回全球视角" }).click();
  await expect(detail.getByRole("button", { name: "观看虚拟发射" })).toBeVisible();
  await openGroup(page, "EXPERIENCES");
  await expect(layerPanel(page).getByRole("button", { name: "停止火箭表演" })).toBeDisabled();
});

/** Earth-fixed position (metres) of a point on the WGS84 ellipsoid. */
function ecef(latitude: number, longitude: number) {
  const a = 6_378_137, e2 = 6.69437999014e-3, lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [n * Math.cos(lat) * Math.cos(lon), n * Math.cos(lat) * Math.sin(lon), n * (1 - e2) * Math.sin(lat)];
}

test("selecting a launch shows its region and Fly to the pad then closes in on the pad", async ({ page }) => {
  // ?record exposes project() to measure the view; the UI stays as normal.
  await page.goto("/?record" + sceneUrl(0, 20, 17_000_000, {}).slice(1));
  await waitForGlobe(page);
  await page.waitForFunction(() => "__terrascope" in window);
  // On screen, how far apart are the pad and a point 0.3° (about 30 km) east of it?
  const spread = () => page.evaluate(([pad, east]) => {
    const [a, b] = (window as unknown as { __terrascope: { project(points: unknown[]): { x: number; y: number }[] } }).__terrascope.project([pad, east]);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }, [ecef(CAPE.latitude, CAPE.longitude), ecef(CAPE.latitude, CAPE.longitude + 0.3)]);
  await openGroup(page, "LAUNCHES");
  await layerPanel(page).getByRole("checkbox", { name: "火箭发射日历" }).check({ force: true });
  await layerPanel(page).locator(".launch-entry").first().click();
  // From 1,500 km the two points are a few pixels apart...
  await expect.poll(spread, { timeout: 20_000 }).toBeLessThan(40);
  await layerPanel(page).locator(".launch-detail").getByRole("button", { name: "飞到发射场" }).click();
  // ...and from about 30 km they are hundreds apart.
  await expect.poll(spread, { timeout: 20_000 }).toBeGreaterThan(300);
});

test("an unavailable launch calendar says so instead of showing launches", async ({ page }) => {
  await page.route("**/api/launches", (route) => route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"Launch calendar unavailable"}' }));
  await page.goto(sceneUrl(0, 20, 17_000_000, {}));
  await waitForGlobe(page);
  await openGroup(page, "LAUNCHES");
  await layerPanel(page).getByRole("checkbox", { name: "火箭发射日历" }).check({ force: true });
  await expect(layerPanel(page).locator(".launch-calendar .layer-status")).toContainText("发射日历暂不可用");
  await expect(layerPanel(page).locator(".launch-entry")).toHaveCount(0);
});
