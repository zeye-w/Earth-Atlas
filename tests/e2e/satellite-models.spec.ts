import {test,expect} from "@playwright/test";
import {mockNetwork,sceneUrl,waitForGlobe} from "./mocks";
// Orbital positions are synthetic test fixtures; model files are the shipped assets.
for(const target of [{id:"iss",title:"ISS · 国际空间站"},{id:"hubble",title:"Hubble · 哈勃望远镜"},{id:"terra",title:"Terra · 对地观测"},{id:"tiangong",title:"天宫空间站（天和核心舱）"}]) {
 test(target.id+" tracking opens its model immediately and orbit view releases it",async({page})=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await mockNetwork(page);let requests=0;
  page.on("request",request=>{if(request.url().includes("/models/satellites/"))requests++;});
  await page.goto(sceneUrl(0,0,17_000_000,{satellites:true}));await waitForGlobe(page);
  const group=page.locator("#earth-layer-panel details",{has:page.locator("summary",{hasText:"SATELLITES"})});
  if(!(await group.evaluate(el=>(el as HTMLDetailsElement).open)))await group.locator("summary").click();
  expect(requests).toBe(0);
  await page.getByRole("button",{name:"跟踪 "+target.title,exact:true}).click();
  const card=page.locator(".track-card");await expect(card).toBeVisible();
  await expect(card).toContainText("三维模型已显示",{timeout:60000});
  expect(requests).toBe(1);await expect(card).toContainText("姿态近似");
  await page.screenshot({path:".cache/satellite-models/"+target.id+"-close.png"});
  await card.getByRole("button",{name:"轨道远景",exact:true}).click();
  await expect(card).toContainText("拉近后按需加载");
  await card.getByRole("button",{name:"停止跟踪",exact:true}).click();await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
 });
}

test("failed model keeps the marker and can retry without restarting satellite tracking",async({page})=>{
 await mockNetwork(page);let fail=true;
 await page.route("**/models/satellites/iss.glb",route=>fail?route.abort():route.fallback());
 await page.goto(sceneUrl(0,0,17_000_000,{satellites:true}));await waitForGlobe(page);
 const group=page.locator("#earth-layer-panel details",{has:page.locator("summary",{hasText:"SATELLITES"})});
 if(!(await group.evaluate(el=>(el as HTMLDetailsElement).open)))await group.locator("summary").click();
 await page.getByRole("button",{name:"跟踪 ISS · 国际空间站",exact:true}).click();
 const card=page.locator(".track-card");
 await expect(card).toContainText("模型加载失败，已保留卫星图标");
 fail=false;await card.getByRole("button",{name:"重试模型",exact:true}).click();
 await expect(card).toContainText("三维模型已显示",{timeout:60000});
});
