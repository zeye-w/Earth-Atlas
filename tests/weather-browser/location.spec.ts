import { test, expect } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe } from "../e2e/mocks";

test("globe click shows location environment independently of geology and hides current weather in history", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.clipboard.writeText = async (text) => {
      (window as any).__copiedCoordinates = text;
    };
  });
  await mockNetwork(page);
  let requests = 0;
  await page.route("https://api.open-meteo.com/**", (route) => {
    requests++;
    const url = new URL(route.request().url());
    return route.fulfill({
      json: {
        latitude: Number(url.searchParams.get("latitude")),
        longitude: Number(url.searchParams.get("longitude")),
        timezone: "Asia/Shanghai",
        elevation: 47,
        current_units: {
          time: "unixtime",
          temperature_2m: "°C",
          apparent_temperature: "°C",
          relative_humidity_2m: "%",
          surface_pressure: "hPa",
          cloud_cover: "%",
          weather_code: "wmo code",
        },
        current: {
          time: Date.now() / 1000,
          temperature_2m: 14.6,
          apparent_temperature: 11.6,
          relative_humidity_2m: 50,
          surface_pressure: 1016.6,
          cloud_cover: 87,
          weather_code: 3,
        },
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    sceneUrl(116.4, 39.9, 3_000_000, { dayNight: false }).replace(
      "/#",
      "/?record#",
    ),
  );
  await waitForGlobe(page);
  expect(requests).toBe(0);
  await page
    .locator(".cesium-widget canvas")
    .click({ position: { x: 720, y: 450 } });
  await expect(page.getByRole("region", { name: "地点概览" })).toBeVisible();
  await expect(page.getByText("附近城市：北京")).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "复制坐标", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__copiedCoordinates))
    .toMatch(/^-?\d+\.\d{6}, -?\d+\.\d{6}$/);
  await page.getByRole("button", { name: "分享地点", exact: true }).click();
  const shared = new URL(await page.locator("#scene-share-url").inputValue());
  const scene = JSON.parse(
    new URLSearchParams(shared.hash.slice(1)).get("scene")!,
  );
  expect(scene.point.latitude).toBeCloseTo(39.9, 0);
  expect(scene.point.longitude).toBeCloseTo(116.4, 0);
  await page.getByRole("button", { name: "关闭分享", exact: true }).click();
  await page.getByRole("button", { name: "居中地点", exact: true }).click();
  await page.getByRole("tab", { name: "概览", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "天气", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("14.6 °C", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "地质", exact: true }).click();
  await expect(
    page.getByText("E2E Synthetic Formation", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "天气", exact: true }).click();
  await page.screenshot({ path: ".cache/location-overview.png" });
  await page.evaluate(() =>
    (window as any).__terrascope.setTime(Date.now() - 86400_000),
  );
  await expect(
    page.getByText("历史回放中不展示当前天气，请返回实时模式查看。"),
  ).toBeVisible();
  await expect(page.getByText("14.6 °C", { exact: true })).toHaveCount(0);
  // A shared scene is applied on initial load; reopen it as a fresh document.
  await page.goto(shared.toString());
  await page.reload();
  await waitForGlobe(page);
  await expect(
    page.getByRole("tab", { name: "概览", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("附近城市：北京")).toBeVisible();
  expect(errors).toEqual([]);
});

test("weather failure leaves geological data usable", async ({ page }) => {
  await mockNetwork(page);
  await page.route("https://api.open-meteo.com/**", (route) =>
    route.fulfill({ status: 503, body: "offline" }),
  );
  await page.goto(sceneUrl(116.4, 39.9, 3_000_000, { dayNight: false }));
  await waitForGlobe(page);
  await page
    .locator(".cesium-widget canvas")
    .click({ position: { x: 720, y: 450 } });
  await page.getByRole("tab", { name: "天气", exact: true }).click();
  await expect(page.getByText(/地点天气服务暂时不可用/)).toBeVisible();
  await page.getByRole("tab", { name: "地质", exact: true }).click();
  await expect(
    page.getByText("E2E Synthetic Formation", { exact: true }),
  ).toBeVisible();
});
