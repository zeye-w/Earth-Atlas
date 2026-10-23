import { test, expect, type Page } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe } from "./mocks";

// Synthetic datasets (tests/e2e/fixtures/internet/), not real infrastructure.
const layerPanel = (page: Page) => page.locator("#earth-layer-panel");
async function openInternet(page: Page) {
  const details = layerPanel(page).locator("details", { has: page.locator("summary", { hasText: "INTERNET" }) });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator("summary").click();
}

test("internet layers load their datasets, report counts and open a card on click", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockNetwork(page);
  // Camera straight above the synthetic Singapore exchange.
  await page.goto(sceneUrl(103.85, 1.29, 2_000_000, { cables: true, ixps: true, dataCenters: true, rootServers: true, dnsFlows: true }));
  await waitForGlobe(page);
  await openInternet(page);
  const panel = layerPanel(page);
  await expect(panel).toContainText("3 条光缆 · 4 个登陆站");
  await expect(panel).toContainText("2 个交换中心");
  await expect(panel).toContainText("2 个设施");
  await expect(panel).toContainText("2 个实例");
  await expect(panel).toContainText("2 次查询 · 匹配到实例 2 / 3");
  const canvas = page.locator(".cesium-widget canvas");
  await expect(async () => {
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole("region", { name: /互联网交换中心 E2E-IX Singapore/ })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  const card = page.getByRole("region", { name: /E2E-IX Singapore/ });
  await expect(card).toContainText("300");
  await card.getByRole("button", { name: "关闭" }).click();
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a missing dataset or feed says so and draws nothing", async ({ page }) => {
  await mockNetwork(page);
  await page.route("**/data/internet/cables.json", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/api/internet/dns-flows", (route) => route.fulfill({ status: 503, body: "{}" }));
  await page.goto(sceneUrl(0, 20, 17_000_000, { cables: true, dnsFlows: true }));
  await waitForGlobe(page);
  await openInternet(page);
  await expect(layerPanel(page)).toContainText("数据暂不可用，未显示。");
  await expect(layerPanel(page)).toContainText("实测数据暂不可用，未显示；不会绘制虚构的查询。");
});
