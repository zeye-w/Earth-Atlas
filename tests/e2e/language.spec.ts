import { expect, test } from "@playwright/test";
import { mockNetwork, waitForGlobe } from "./mocks";

// Not in app.spec.ts: its beforeEach pins Chinese for the whole file.
test("a first visit opens in English behind an English loading screen", async ({ page }) => {
  await mockNetwork(page, { locale: null });
  await page.goto("/");
  const splash = page.locator("#splash");
  await expect(splash).toHaveAttribute("aria-label", "Loading TerraScope");
  await expect(splash).toContainText("Real-time satellites, weather and geology on a 3D Earth");
  await waitForGlobe(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("TerraScope | Digital Earth");
  await expect(page.getByRole("button", { name: "Layers", exact: true })).toBeVisible();
});

test("the loading screen stays English for a visitor who chose Chinese", async ({ page }) => {
  await mockNetwork(page);
  await page.goto("/");
  await expect(page.locator("#splash")).toHaveAttribute("aria-label", "Loading TerraScope");
  await waitForGlobe(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});
