import { test, expect, type Page } from "@playwright/test";
import { mockNetwork, sceneUrl, waitForGlobe } from "./mocks";

// Synthetic datasets (tests/e2e/fixtures/internet/), not real infrastructure.
const layerPanel = (page: Page) => page.locator("#earth-layer-panel");
async function openInternet(page: Page) {
  const details = layerPanel(page).locator("details", { has: page.locator("summary", { hasText: "INTERNET" }) });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator(":scope > summary").click();
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
  await expect(panel).toContainText("3 段光缆");
  await expect(panel.getByRole("slider", { name: "光缆投产年份" })).toBeVisible();
  await expect(panel).toContainText("2 个交换中心（其中 1 个位置按城市推算）");
  await expect(panel.getByRole("region", { name: "互联网图例" })).toContainText("不代表实际流量");
  await expect(panel.getByRole("region", { name: "互联网图例" })).toContainText("路径形状为示意");
  const sources = panel.getByRole("region", { name: "互联网数据来源" });
  await expect(sources.locator("details")).toHaveCount(4);
  await sources.locator("summary").filter({ hasText: "交换中心" }).click();
  await expect(sources.getByRole("link", { name: "SYNTHETIC TEST FIXTURE - not real infrastructure data" })).toBeVisible();
  await expect(sources).toContainText("抓取：");
  await expect(sources.locator("time").first()).toHaveAttribute("datetime", "2026-10-20T00:00:00Z");
  await expect(panel).toContainText("2 个设施");
  // Root instances come from the measured queries, not a published list.
  await expect(panel).toContainText("此刻实测命中 2 个实例 · 13 个根字母中的 2 个");
  await expect(panel).toContainText("2 次查询 · 匹配到实例 2 / 3");
  const canvas = page.locator(".cesium-widget canvas");
  await expect(async () => {
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole("region", { name: /互联网交换中心 E2E-IX Singapore/ })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  const card = page.getByRole("region", { name: /E2E-IX Singapore/ });
  await expect(card).toContainText("300");
  await expect(card).toContainText("○ 推算位置");
  await expect(card).toContainText("不是交换中心的实际地址");
  await expect(page.locator("body")).not.toContainText("登陆站");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(card.getByRole("button", { name: "关闭" })).toBeInViewport();
  expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const bounds = (await card.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
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
