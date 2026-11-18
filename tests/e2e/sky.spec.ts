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
  const faces: string[] = [];
  page.on("request", (request) => { const m = /\/sky\/(sky|lines)-(1024|2048)-(px|mx|py|my|pz|mz)\.jpg$/.exec(request.url()); if (m) faces.push(m[1] + "-" + m[3]); });
  await page.goto(sceneUrl(116, 30, 40_000_000, {}));
  await waitForGlobe(page);
  // Six faces of the star map, a few seconds after the globe.
  await expect.poll(() => faces.filter((f) => f.startsWith("sky-")).length, { timeout: 20_000 }).toBe(6);
  expect(faces.some((f) => f.startsWith("lines-"))).toBe(false);
  await openSky(page);
  await expect(layerPanel(page).getByRole("checkbox", { name: "真实星空" })).toBeChecked();
  await layerPanel(page).getByRole("checkbox", { name: "星座连线" }).check({ force: true });
  await expect.poll(() => faces.filter((f) => f.startsWith("lines-")).length, { timeout: 20_000 }).toBe(6);
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
