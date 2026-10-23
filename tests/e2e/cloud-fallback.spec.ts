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

// Synthetic fixture imagery below tests synchronization, never scientific appearance.
test("NASA probe success does not hide subsequent visible-tile failure or unblock recording", async ({ page }) => {
  await mockNetwork(page);
  await page.route("https://realearth.ssec.wisc.edu/**",route=>route.abort());
  const png=readFileSync(new URL("./fixtures/ocean.png",import.meta.url));
  const body=png.length>=100?png:Buffer.concat([png,Buffer.alloc(128)]);
  let release:()=>void=()=>{};
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route("https://gibs.earthdata.nasa.gov/**",async route=>{
    if(route.request().url().includes("Band13") && !route.request().url().endsWith("/0/0/0.png")) {await held;await route.abort();}
    else await route.fulfill({contentType:"image/png",body});
  });
  await page.goto(sceneUrl(120,25,9_000_000,{clouds:true}).replace("/#","/?record#"));await waitForGlobe(page);
  const panel=page.locator(".cloud-controls");
  await expect(panel).toContainText("正在尝试卫星云图数据源");
  await page.waitForFunction(()=>Boolean((window as any).__terrascope));
  expect(await page.evaluate(()=>(window as any).__terrascope.idle(200))).toBe(false);
  await expect(panel).not.toContainText("当前显示 NASA GIBS");
  release();await expect(panel).toContainText("卫星云图数据源暂不可用");
});

test("NASA remains visible until recovered SSEC tiles settle, then retires as a source", async ({ page }) => {
  await mockNetwork(page);
  const observed=Math.floor(Date.now()/3_600_000)*3_600_000;
  const stamp=new Date(observed).toISOString().replace(/[-:]/g,"").replace("T",".").slice(0,15);
  let recovered=false,requests=0,release:()=>void=()=>{};
  const held=new Promise<void>(resolve=>{release=resolve;});
  const png=readFileSync(new URL("./fixtures/ocean.png",import.meta.url));
  const body=png.length>=100?png:Buffer.concat([png,Buffer.alloc(128)]);
  await page.route("https://realearth.ssec.wisc.edu/**",async route=>{
    if(!recovered)return route.abort();
    if(new URL(route.request().url()).pathname.includes("products"))return route.fulfill({headers:{"access-control-allow-origin":"*"},json:[{id:"globalir",times:[stamp]}]});
    requests++;await held;await route.fulfill({contentType:"image/png",headers:{"access-control-allow-origin":"*"},body});
  });
  await page.route("https://gibs.earthdata.nasa.gov/**",route=>route.fulfill({contentType:"image/png",body}));
  await page.goto(sceneUrl(120,25,9_000_000,{clouds:true}));await waitForGlobe(page);
  const note=page.locator(".cloud-controls [role=status]");
  await expect(note).toContainText("当前显示 NASA GIBS");
  recovered=true;
  await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(()=>requests).toBeGreaterThan(0);
  await expect(note).toContainText("当前显示 NASA GIBS");
  release();
  await expect(note).toContainText("观测时间 "+new Date(observed).toISOString().slice(0,16).replace("T"," "));
  await expect(note).not.toContainText("NASA GIBS");
});
