import { expect, test } from "@playwright/test";
import { mockNetwork, waitForGlobe } from "./mocks";

const H = 3_600_000;
/** Synthetic feeds (not real events): a red-alert typhoon and a launch in five hours. */
function feeds() {
  const now = Date.now();
  return {
    hazards: { v: 1, fetched: now, events: [], storms: [{
      id: "gdacs-1", name: "CHAMPI", source: "JTWC", alert: "red", countries: ["Japan"], maxWindKmh: 222, advisory: now, cone: null, swaths: [], report: null,
      track: [{ time: now - 12 * H, latitude: 18, longitude: 132, windKt: 100 }, { time: now + H, latitude: 20, longitude: 130, windKt: 120 }], forecast: [],
    }] },
    launches: { v: 1, fetched: now, launches: [{ id: "L1", name: "E2E", mission: "E2E Mission", missionType: "", description: "", orbit: "", rocket: "Falcon 9", provider: "SpaceX",
      status: "go", statusName: "Go", net: now + 5 * H, precision: "time", windowStart: null, windowEnd: null, padId: "1", pad: "SLC-40", location: "Cape Canaveral", country: "US",
      latitude: 28.56, longitude: -80.58, webcast: false }] },
  };
}

async function setup(page: import("@playwright/test").Page, highlights: "open" | "closed") {
  await mockNetwork(page, { highlights });
  const data = feeds();
  await page.route("**/api/hazards", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data.hazards) }));
  await page.route("**/api/launches", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data.launches) }));
}

test("today's highlights rank live events and each one opens its layer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setup(page, "open");
  await page.goto("/");
  await waitForGlobe(page);
  const card = page.locator(".highlights");
  await expect(card).toContainText("今日看点");
  const items = card.locator("li");
  // Red-alert typhoon first, then the launch (the mocked USGS feed's M7.1 may sit between).
  await expect(items.first()).toContainText("超强台风 蔷琵（Champi）");
  await expect(items.first()).toContainText("红色预警");
  await expect(card.locator("li", { hasText: "E2E Mission" })).toContainText(/T−0?4:\d\d:\d\d|T−05:00:00/);
  await items.first().click();
  // The typhoon layer is on and its card is open.
  await expect(page.locator(".hazard-card")).toContainText("蔷琵（Champi）");
  await card.locator("li", { hasText: "E2E Mission" }).click();
  await expect(page.locator("#earth-layer-panel .launch-entry[aria-expanded=true]")).toContainText("E2E Mission");
  expect(errors).toEqual([]);
});

test("the card folds to a counter and remembers it; a dead feed only drops its items", async ({ page }) => {
  await setup(page, "open");
  await page.route("**/api/hazards", (route) => route.fulfill({ status: 502, body: "{}" }));
  await page.goto("/");
  await waitForGlobe(page);
  const card = page.locator(".highlights");
  await expect(card.locator("li", { hasText: "E2E Mission" })).toBeVisible();
  await expect(card).not.toContainText("蔷琵");
  await card.getByRole("button", { name: /今日看点/ }).click();
  await expect(card.locator("li")).toHaveCount(0);
  await expect(card.locator(".highlights-head b")).toHaveText(/\d/);
  await page.reload();
  await waitForGlobe(page);
  await expect(page.locator(".highlights li")).toHaveCount(0);
  await expect(page.locator(".highlights-head")).toHaveAttribute("aria-expanded", "false");
});
