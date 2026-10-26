import { expect, test } from "@playwright/test";
import { mockNetwork, waitForGlobe } from "./mocks";

test("fireworks can be launched and stopped without changing scientific layers", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockNetwork(page);
  await page.goto("/");
  await waitForGlobe(page);
  const panel = page.locator("#earth-layer-panel");
  const group = panel.locator("details.layer-group", { has: panel.locator("summary", { hasText: "EXPERIENCES" }) });
  await group.locator(":scope > summary").click();
  await expect(group).toContainText("烟花表演");
  await group.getByRole("radio", { name: "环形" }).click();
  await group.getByRole("button", { name: "东京" }).click();
  await expect(group).toContainText("地点：东京");
  await group.getByRole("button", { name: "开始烟花表演" }).click();
  await expect(group.getByRole("button", { name: "重新播放" })).toBeVisible();
  await group.getByRole("button", { name: "停止烟花表演" }).click();
  await expect(group.getByRole("button", { name: "开始烟花表演" })).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: "实时地震" })).not.toBeChecked();
  expect(errors).toEqual([]);
});
