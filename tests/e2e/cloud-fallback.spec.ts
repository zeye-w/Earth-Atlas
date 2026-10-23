import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockNetwork, sceneUrl, waitForGlobe } from "./mocks";

/**
 * A hermetic regression test: primary SSEC API fails, NASA returns fixture
 * PNGs. The fixture is NOT an observation; it solely verifies failover
 * wiring and truthful status text.
 */
test("NASA regional infrared fallback appears when SSEC global composite fails", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await mockNetwork(page);
  await page.route("https://realearth.ssec.wisc.edu/**", (route) => route.abort("failed"));
  const png = readFileSync(new URL("./fixtures/ocean.png", import.meta.url));
  const safePng = png.length >= 100 ? png : Buffer.concat([png, Buffer.alloc(128)]);
  await page.route("https://gibs.earthdata.nasa.gov/**", (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    headers: { "access-control-allow-origin": "*" },
    body: safePng,
  }));
  await page.goto(sceneUrl(120, 25, 9_000_000, { clouds: true }));
  await waitForGlobe(page);
  const panel = page.locator(".cloud-controls");
  await expect(panel).toContainText("NASA GIBS 区域红外影像", { timeout: 45_000 });
  await expect(panel).toContainText("非全球覆盖");
  await expect(panel).toContainText("GOES-East");
  await expect(panel).toContainText("Himawari");
  expect(errors).toEqual([]);
});
