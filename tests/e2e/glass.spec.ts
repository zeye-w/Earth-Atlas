import { expect, test } from "@playwright/test";
import { mockNetwork, waitForGlobe } from "./mocks";

test.beforeEach(async ({ page }) => { await mockNetwork(page); });

test("glass panels stay solid while the globe streams and blur again once it settles", async ({ page }) => {
  await page.goto("/");
  await waitForGlobe(page);
  const shell = page.locator(".app-shell");
  await expect(shell).not.toHaveClass(/is-busy/, { timeout: 30_000 });
  // Count every switch back to the blurred panels during and after a zoom.
  await page.evaluate(() => {
    const target = document.querySelector(".app-shell")!;
    const w = window as unknown as { blurReturns: number; solid: number };
    w.blurReturns = 0;
    w.solid = 0;
    let busy = target.classList.contains("is-busy");
    new MutationObserver(() => {
      const now = target.classList.contains("is-busy");
      if (busy && !now) w.blurReturns++;
      if (!busy && now) w.solid++;
      busy = now;
    }).observe(target, { attributes: true, attributeFilter: ["class"] });
  });
  // Zoom in over the globe: the camera moves and new tiles stream.
  const box = (await page.locator(".cesium-widget canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -600);
  await expect.poll(() => page.evaluate(() => (window as unknown as { solid: number }).solid)).toBeGreaterThan(0);
  // Settles: the blur comes back (the no-flicker timing itself is unit-tested in tests/glassCalm.test.mjs).
  await expect(shell).not.toHaveClass(/is-busy/, { timeout: 60_000 });
  await page.waitForTimeout(2_000);
  expect(await page.evaluate(() => (window as unknown as { blurReturns: number }).blurReturns)).toBeLessThanOrEqual(2);
  await expect(page.locator("#earth-layer-panel")).not.toHaveCSS("backdrop-filter", "none");
});
