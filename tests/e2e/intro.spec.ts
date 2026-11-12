import { expect, test } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe } from "./mocks";

// The intro video itself is an asset (public/intro/intro.mp4); these tests
// cover the flow around it with the video absent or replaced.
test("first visit: home page over the loading globe, Enter opens the app and is remembered", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockNetwork(page, { intro: true });
  await page.route("**/intro/intro.mp4", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  const intro = page.locator("#intro");
  // No video: the home page appears at once, in the pinned language.
  await expect(intro).toHaveClass(/home/);
  await expect(intro.locator(".intro-tagline")).toHaveText(/三维地球/);
  const enter = intro.getByRole("button", { name: "进入" });
  await expect(enter).toBeFocused();
  // The app loads underneath, but the loading screen waits for Enter.
  await page.locator(".cesium-widget canvas").waitFor();
  await page.waitForTimeout(1500);
  await expect(page.locator("#splash")).toBeAttached();
  await enter.click();
  await expect(intro).toHaveCount(0);
  await waitForGlobe(page);
  // A second visit goes straight in.
  await page.reload();
  await expect(page.locator("#intro")).toBeHidden();
  await waitForGlobe(page);
  expect(errors).toEqual([]);
});

test("the home page switches language for itself and the app", async ({ page }) => {
  await mockNetwork(page, { intro: true, locale: null });
  await page.route("**/intro/intro.mp4", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  const intro = page.locator("#intro");
  await expect(intro.getByRole("button", { name: "Enter" })).toBeVisible();
  await intro.getByRole("button", { name: "中文" }).click();
  await expect(intro.locator(".intro-tagline")).toHaveText(/三维地球/);
  await intro.getByRole("button", { name: "进入" }).click();
  await waitForGlobe(page);
  await expect(page.getByRole("button", { name: "图层", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("lang")).toBe("zh");
});

test("the video plays first, can be skipped, and Settings replays the intro", async ({ page }) => {
  await mockNetwork(page, { intro: true });
  // Held open: the request neither fails nor plays, as on a slow connection.
  let asked = 0;
  await page.route("**/intro/intro.mp4", () => { asked++; });
  // Do not wait for the whole app: a video that has not started within 5 s gives way to the home page.
  await page.goto("/", { waitUntil: "commit" });
  const intro = page.locator("#intro");
  await intro.getByRole("button", { name: "跳过" }).click();
  expect(asked).toBeGreaterThan(0);
  await expect(intro).toHaveClass(/home/);
  await intro.getByRole("button", { name: "进入" }).click();
  await waitForGlobe(page);
  await page.getByRole("button", { name: "显示设置" }).click();
  await page.getByRole("button", { name: "重看开场" }).click();
  await expect(page.locator("#intro")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("intro")).toBe("1");
});

test("no intro for shared scenes, and phones get the home page without the video", async ({ page }) => {
  await mockNetwork(page, { intro: true });
  let asked = 0;
  await page.route("**/intro/intro.mp4", (route) => { asked++; return route.fulfill({ status: 404, body: "" }); });
  await page.goto(sceneUrl(0, 20, 17_000_000, {}));
  await expect(page.locator("#intro")).toBeHidden();
  await waitForGlobe(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#intro")).toHaveClass(/home/);
  expect(asked).toBe(0);
});
