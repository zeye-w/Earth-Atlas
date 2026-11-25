import { expect, test, type Page } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe, showLayerGroup } from "./mocks";

const layerPanel = (page: Page) => page.locator("#earth-layer-panel");
async function openSky(page: Page) {
  await showLayerGroup(page, "SKY");
  const details = layerPanel(page).locator("details", { has: page.locator("summary", { hasText: "SKY" }) });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator(":scope > summary").click();
}

test.beforeEach(async ({ page }) => { await mockNetwork(page); });

test("the real sky replaces the built-in one after start, and the constellation figures load on demand", async ({ page }) => {
  let starCatalogue = 0;
  page.on("request", (request) => { if (request.url().endsWith("/sky/stars.bin")) starCatalogue++; });
  const faces: string[] = [];
  page.on("request", (request) => { const m = /\/sky\/(bg|bglines)-(1024|2048)-(px|mx|py|my|pz|mz)\.jpg$/.exec(request.url()); if (m) faces.push(m[1] + "-" + m[3]); });
  await page.goto(sceneUrl(116, 30, 40_000_000, {}));
  await waitForGlobe(page);
  // Six faces of the star map, a few seconds after the globe.
  await expect.poll(() => faces.filter((f) => f.startsWith("bg-")).length, { timeout: 20_000 }).toBe(6);
  expect(faces.some((f) => f.startsWith("bglines-"))).toBe(false);
  // The bright stars, drawn as points over the faces.
  expect(starCatalogue).toBe(1);
  await openSky(page);
  await expect(layerPanel(page).getByRole("checkbox", { name: "真实星空" })).toBeChecked();
  await layerPanel(page).getByRole("checkbox", { name: "星座连线" }).check({ force: true });
  await expect.poll(() => faces.filter((f) => f.startsWith("bglines-")).length, { timeout: 20_000 }).toBe(6);
  await expect(layerPanel(page).locator(".opened-layers")).toContainText("星座连线");
});

test("the live Sun shows the SDO image, the X-ray level and the week's big flares", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sceneUrl(116, 30, 20_000_000, { sun: true }));
  await waitForGlobe(page);
  await openSky(page);
  const section = layerPanel(page).locator(".sun-section");
  await expect(section.locator(".sdo img")).toHaveAttribute("src", /latest_1024_0171\.jpg/);
  await expect(section.locator(".layer-status")).toContainText("此刻 X 射线：C1.1", { timeout: 30_000 });
  await expect(section.locator(".layer-status")).toContainText("24 小时最强耀斑：M2.4");
  await expect(section.locator(".flare-list li")).toHaveCount(1);
  await expect(section.locator(".flare-list")).toContainText("短波通信中断 R1");
  await section.getByRole("button", { name: "可见光" }).click();
  await expect(section.locator(".sdo img")).toHaveAttribute("src", /latest_1024_HMIIC\.jpg/);
  expect(errors).toEqual([]);
});

test.describe("on a large screen", () => {
  // 2048 × 983 css px at 125%: 2560 device px across, about 39 px a degree.
  test.use({ viewport: { width: 2048, height: 983 }, deviceScaleFactor: 1.25 });

  test("the far view loads the 4096 px faces, and the constellation figures at 2048 px", async ({ page }) => {
    // A desktop's cores, so the app starts at "balanced" (a headless runner with few cores starts in eco).
    await page.addInitScript(() => Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 }));
    const faces: string[] = [];
    page.on("request", (request) => { const m = /\/sky\/(bg|bglines)-(1024|2048|4096)-(px|mx|py|my|pz|mz)\.jpg$/.exec(request.url()); if (m) faces.push(`${m[1]}-${m[2]}`); });
    await page.goto(sceneUrl(116, 30, 150_000_000, {}));
    await waitForGlobe(page);
    await expect(page.locator(".far-view-note")).toBeVisible();
    await expect.poll(() => faces.filter((f) => f === "bg-4096").length, { timeout: 30_000 }).toBe(6);
    if (process.env.SKY_SCREENSHOT) {
      await page.waitForTimeout(4_000);
      await page.screenshot({ path: process.env.SKY_SCREENSHOT });
    }
    await openSky(page);
    await layerPanel(page).getByRole("checkbox", { name: "星座连线" }).check({ force: true });
    await expect.poll(() => faces.filter((f) => f === "bglines-2048").length, { timeout: 20_000 }).toBe(6);
    expect(faces.some((f) => f === "bglines-4096")).toBe(false);
  });
});
