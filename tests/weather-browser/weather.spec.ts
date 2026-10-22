import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockNetwork, sceneUrl, waitForGlobe } from "../e2e/mocks";
const snapshot = JSON.parse(
  readFileSync(
    new URL("../../public/data/weather/latest.json", import.meta.url),
    "utf8",
  ),
);
test("weather stays lazy, renders, shares and hides during history", async ({
  page,
}) => {
  await mockNetwork(page);
  let requests = 0;
  await page.route("**/data/weather/latest.json", (route) => {
    requests++;
    return route.fulfill({
      json: { ...snapshot, validTime: new Date().toISOString() },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    sceneUrl(110, 22, 18_000_000, { dayNight: false, windVectors: true }).replace(
      "/#",
      "/?record#",
    ),
  );
  await waitForGlobe(page);
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__terrascope))
    .toBe(true);
  expect(requests).toBe(0);
  await page.locator("summary").filter({ hasText: "全球气温" }).click();
  await page.getByRole("checkbox", { name: "全球气温", exact: true }).check();
  await expect(page.getByText(/有效时间：/)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__terrascope.idle(1000)))
    .toBe(true);
  await page.getByRole("button", { name: "分享当前场景", exact: true }).click();
  const shared = new URL(await page.locator("#scene-share-url").inputValue());
  const scene = JSON.parse(
    new URLSearchParams(shared.hash.slice(1)).get("scene")!,
  );
  expect(scene.layers.temperature).toBe(true);
  expect(scene.layers.windVectors).toBeUndefined();
  await page.getByRole("button", { name: "关闭分享", exact: true }).click();
  await page.screenshot({ path: ".cache/weather-browser.png" });
  await page.evaluate(() =>
    (window as any).__terrascope.setCamera({
      longitude: 179,
      latitude: 45,
      height: 10_000_000,
      heading: 45,
      pitch: -60,
    }),
  );
  await page.evaluate(() => (window as any).__terrascope.render());
  await page.screenshot({ path: ".cache/weather-dateline.png" });
  await page.evaluate(() =>
    (window as any).__terrascope.setTime(Date.now() - 86400_000),
  );
  await expect(
    page.getByText("仅提供最新分析场；历史回放中已隐藏"),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "全球气温", exact: true }).uncheck();
  await expect(page.getByRole("checkbox", { name: "风向与风速", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("expired weather shows an explanation instead of drawing", async ({
  page,
}) => {
  await mockNetwork(page);
  await page.route("**/data/weather/latest.json", (route) =>
    route.fulfill({ json: { ...snapshot, validTime: "2000-01-01T00:00:00Z" } }),
  );
  await page.goto(sceneUrl(0, 0, 18_000_000, { temperature: true }));
  await waitForGlobe(page);
  await page.locator("summary").filter({ hasText: "全球气温" }).click();
  await expect(page.getByText("气象数据已过期，等待下一次更新")).toBeVisible();
});
