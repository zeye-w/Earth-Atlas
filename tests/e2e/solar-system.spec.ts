import { expect, test, type Page } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe, showLayerGroup } from "./mocks";

const layerPanel = (page: Page) => page.locator("#earth-layer-panel");

test("the solar system lists the planets, flies out to them and fast-forwards", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockNetwork(page);
  await page.goto(sceneUrl(116, 30, 20_000_000, { solarSystem: true }));
  await waitForGlobe(page);
  await showLayerGroup(page, "SOLAR SYSTEM");
  const details = layerPanel(page).locator("details", { has: page.locator("summary", { hasText: "SOLAR SYSTEM" }) });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator(":scope > summary").click();
  const list = layerPanel(page).locator(".space-list.planets li");
  await expect(list).toHaveCount(8, { timeout: 30_000 });
  await expect(list.filter({ hasText: "木星" })).toContainText(/离太阳 5\.\d+ 天文单位/);
  // Out to the outer solar system: the planet names appear over the scene.
  await layerPanel(page).getByRole("button", { name: "外太阳系" }).click();
  await expect(page.locator(".solar-labels span", { hasText: "海王星" })).toBeVisible({ timeout: 20_000 });
  // Fast-forward moves the clock on.
  const clock = layerPanel(page).locator(".solar-clock output");
  const before = await clock.textContent();
  await layerPanel(page).getByRole("radio", { name: "100 天/秒" }).click();
  await layerPanel(page).getByRole("button", { name: "快进" }).click();
  await expect.poll(() => clock.textContent(), { timeout: 10_000 }).not.toBe(before);
  await layerPanel(page).getByRole("button", { name: "暂停" }).click();
  await layerPanel(page).getByRole("button", { name: "回到现在" }).click();
  await expect(clock).toHaveText(before!);
  expect(errors).toEqual([]);
});

test("in the solar system view the camera turns around the Sun, and reset gives it back to the Earth", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockNetwork(page);
  await page.goto(sceneUrl(116, 30, 20_000_000, { solarSystem: true }));
  await waitForGlobe(page);
  await showLayerGroup(page, "SOLAR SYSTEM");
  const details = layerPanel(page).locator("details", { has: page.locator("summary", { hasText: "SOLAR SYSTEM" }) });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator(":scope > summary").click();
  await layerPanel(page).getByRole("button", { name: "内太阳系" }).click();
  const sun = page.locator(".solar-labels span", { hasText: "太阳" }).first();
  const mars = page.locator(".solar-labels span", { hasText: "木星" });
  await expect(mars).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3_500);
  const at = async () => { const s = await sun.boundingBox(); const m = await mars.boundingBox(); return { sun: s!, other: m! }; };
  const before = await at();
  const canvas = (await page.locator(".cesium-widget canvas").boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width * 0.7, canvas.y + canvas.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.8, canvas.y + canvas.height * 0.45, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1_500);
  const after = await at();
  // The Sun stays put on screen; the planets swing around it.
  expect(Math.hypot(after.sun.x - before.sun.x, after.sun.y - before.sun.y)).toBeLessThan(12);
  expect(Math.hypot(after.other.x - before.other.x, after.other.y - before.other.y)).toBeGreaterThan(20);
  // Reset: back to the Earth, out of the far view.
  await page.getByRole("button", { name: "返回全球视角" }).click();
  await expect(page.locator(".far-view-note")).toHaveCount(0, { timeout: 20_000 });
  expect(errors).toEqual([]);
});

test("flying to a planet shows its mapped disc, its moons and its facts; maps load only then", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const maps: string[] = [];
  page.on("request", (request) => { const m = /\/planets\/([a-z-]+)\.(jpg|png)$/.exec(request.url()); if (m) maps.push(m[1]); });
  await mockNetwork(page);
  await page.goto(sceneUrl(116, 30, 20_000_000, { solarSystem: true }));
  await waitForGlobe(page);
  await showLayerGroup(page, "SOLAR SYSTEM");
  const details = layerPanel(page).locator("details", { has: page.locator("summary", { hasText: "SOLAR SYSTEM" }) });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator(":scope > summary").click();
  await layerPanel(page).getByRole("button", { name: "外太阳系" }).click();
  await expect(page.locator(".solar-labels span", { hasText: "海王星" })).toBeVisible({ timeout: 20_000 });
  // From out here every planet is a point: no maps fetched.
  expect(maps).toEqual([]);
  await layerPanel(page).getByRole("button", { name: /^土星/ }).click();
  const facts = layerPanel(page).locator(".planet-facts");
  await expect(facts).toContainText("已知卫星");
  await expect(facts).toContainText("274 颗");
  await expect(facts.locator(".planet-moons li", { hasText: "土卫六" })).toContainText("位置为近似");
  // Saturn and its ring (Titan's map too, once Titan is more than a pixel across).
  await expect.poll(() => ["saturn", "saturn-ring"].every((m) => maps.includes(m)), { timeout: 20_000 }).toBe(true);
  await expect(page.locator(".solar-labels span", { hasText: "土卫六" })).toBeVisible({ timeout: 20_000 });
  // Jupiter's four moons come from a real theory, not a circle.
  await layerPanel(page).getByRole("button", { name: /^木星/ }).click();
  await expect(facts.locator(".planet-moons li")).toHaveCount(4);
  await expect(facts.locator(".planet-moons em")).toHaveCount(0);
  await expect(page.locator(".solar-labels span", { hasText: "木卫一" })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => maps.includes("jupiter"), { timeout: 20_000 }).toBe(true);
  expect(errors).toEqual([]);
});

test("Pluto, Charon and the large moons are mapped spheres one can fly to; Uranus has its rings", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const maps: string[] = [];
  page.on("request", (request) => { const m = /\/planets\/([a-z-]+)\.(jpg|png)$/.exec(request.url()); if (m) maps.push(m[1]); });
  const shot = async (name: string) => { if (process.env.PLANET_SHOTS) { await page.waitForTimeout(3_000); await page.screenshot({ path: `${process.env.PLANET_SHOTS}/${name}.png` }); } };
  await mockNetwork(page);
  await page.goto(sceneUrl(116, 30, 20_000_000, { solarSystem: true }));
  await waitForGlobe(page);
  await showLayerGroup(page, "SOLAR SYSTEM");
  const details = layerPanel(page).locator("details", { has: page.locator("summary", { hasText: "SOLAR SYSTEM" }) });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator(":scope > summary").click();
  const facts = layerPanel(page).locator(".planet-facts");
  // Pluto: now a mapped sphere, with Charon over its prime meridian.
  await layerPanel(page).getByRole("button", { name: /^冥王星/ }).click();
  await expect(facts).toContainText("5 颗");
  const charon = facts.locator(".planet-moons li", { hasText: "冥卫一" });
  await expect(charon).toBeVisible();
  await expect.poll(() => maps.includes("pluto"), { timeout: 30_000 }).toBe(true);
  await shot("pluto");
  await charon.getByRole("button", { name: "飞过去" }).click();
  await expect.poll(() => maps.includes("charon"), { timeout: 30_000 }).toBe(true);
  await shot("charon");
  // Uranus: its narrow rings.
  await layerPanel(page).getByRole("button", { name: /^天王星/ }).click();
  await expect.poll(() => maps.includes("uranus-ring"), { timeout: 30_000 }).toBe(true);
  await shot("uranus");
  // Jupiter, then close to Io.
  await layerPanel(page).getByRole("button", { name: /^木星/ }).click();
  await expect(facts.locator(".planet-moons li button", { hasText: "飞过去" })).toHaveCount(4);
  await shot("jupiter");
  // The wheel zooms toward the planet, wherever the cursor is: it stays on screen.
  const jupiter = page.locator(".solar-labels span", { hasText: /^木星$/ });
  await expect(jupiter).toBeVisible({ timeout: 20_000 });
  await page.mouse.move(700, 300);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(200); }
  await expect(jupiter).toBeVisible({ timeout: 10_000 });
  const box = await jupiter.boundingBox();
  const view = page.viewportSize()!;
  expect(box && box.x > 0 && box.x < view.width && box.y > 0 && box.y < view.height).toBe(true);
  await facts.locator(".planet-moons li", { hasText: "木卫一" }).getByRole("button", { name: "飞过去" }).click();
  await expect.poll(() => maps.includes("io"), { timeout: 30_000 }).toBe(true);
  await shot("io");
  // Mars's two small moons stay points: no button.
  await layerPanel(page).getByRole("button", { name: /^火星/ }).click();
  await expect(facts.locator(".planet-moons li", { hasText: "火卫一" }).getByRole("button")).toHaveCount(0);
  await expect(page.locator(".cesium-widget-errorPanel")).toHaveCount(0);
  expect(errors).toEqual([]);
});
