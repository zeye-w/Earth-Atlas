import {test,expect} from "@playwright/test";
import {mockNetwork,sceneUrl,waitForGlobe} from "./mocks";
// Orbital positions are synthetic test fixtures; the working must update live.
test("tracking card opens the live working: formulas, substituted numbers, location step",async({page,context})=>{
 const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 await mockNetwork(page);
 await page.goto(sceneUrl(0,0,17_000_000,{satellites:true}));await waitForGlobe(page);
 const group=page.locator("#earth-layer-panel details",{has:page.locator("summary",{hasText:"SATELLITES"})});
 if(!(await group.evaluate(el=>(el as HTMLDetailsElement).open)))await group.locator("summary").click();
 await page.getByRole("button",{name:"跟踪 ISS · 国际空间站",exact:true}).click();
 const card=page.locator(".track-card");await expect(card).toBeVisible();
 await card.getByRole("button",{name:"查看实时计算公式"}).click();
 const panel=page.getByRole("region",{name:/实时计算/});
 await expect(panel).toBeVisible();
 await expect(panel.locator(".formula-steps > li")).toHaveCount(7); // six steps + the location prompt
 await expect(panel.locator(".katex").first()).toBeVisible();
 const speed=panel.locator(".formula-steps > li").nth(2).locator(".formula-live");
 const before=await speed.innerText();await page.waitForTimeout(1200);
 expect(await speed.innerText()).not.toBe(before);
 await context.grantPermissions(["geolocation"]);await context.setGeolocation({latitude:31.23,longitude:121.47});
 await panel.getByRole("button",{name:/加上我的位置/}).click();
 await expect(panel.locator(".formula-steps > li")).toHaveCount(7); // six steps + the look angles
 await expect(panel).toContainText("从我的位置看");
 await page.locator("#earth-layer-panel").evaluate(el=>(el as HTMLElement).style.display="none");
 await page.waitForTimeout(1000);
 await page.screenshot({path:".cache/formula-panel/panel.png"});
 await panel.getByRole("button",{name:"关闭实时计算"}).click();await expect(panel).toHaveCount(0);
 await card.getByRole("button",{name:"查看实时计算公式"}).click();await expect(panel).toBeVisible();
 await card.getByRole("button",{name:"停止跟踪"}).click();await expect(panel).toHaveCount(0);
 expect(errors).toEqual([]);
});
