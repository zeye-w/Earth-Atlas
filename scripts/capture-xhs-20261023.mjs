/**
 * Fresh, unmodified TerraScope browser screenshots for Xiaohongshu update 2026-10-23.
 * Built from main branch in a separate documentation branch. No mocked
 * satellite/weather/geology data and no AI-generated visuals.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE=process.env.XHS_SITE||"http://127.0.0.1:4173";
const OUT=resolve("docs/updates-20261023");
mkdirSync(OUT,{recursive:true});
const browser=await chromium.launch({headless:true,args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const records=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const OFF={
 clouds:false,geology:false,dayNight:true,cities:false,atmosphere:true,
 aurora:false,lights:false,quakes:false,plates:false,volcanoes:false,
 satellites:false,paths:false,geoLabels:false,trueColor:false,
 starlink:false,solarWind:false,flights:false,temperature:false
};
const opts={cloudOpacity:65,opacity:85,mapMode:"raster",ageFilter:"all",rockFilter:"all",quakeRange:"week"};
const cam=(lon,lat,h)=>[lon,lat,h,0,-Math.PI/2+0.000001,0];
function url(layers={},camera=cam(9,48,15000000),options={}){
 const data={v:1,camera,layers:{...OFF,...layers},options:{...opts,...options}};
 return BASE+"/#scene="+encodeURIComponent(JSON.stringify(data));
}
async function openScene(layers,camera,options) {
 const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
 page.setDefaultTimeout(75000);
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(url(layers,camera,options),{waitUntil:"domcontentloaded",timeout:90000});
 await page.locator("#splash").waitFor({state:"detached",timeout:90000});
 await page.locator(".cesium-widget canvas").waitFor({timeout:30000});
 return {page,errors};
}
async function save(name,page,description,errors,observed){
 await pause(4500);
 const filename=name+".jpg";
 const data=await page.screenshot({path:resolve(OUT,filename),quality:92,type:"jpeg",animations:"disabled",timeout:150000});
 if(data.byteLength<35000)throw Error("Screenshot too small to verify scene "+name);
 records.push({file:filename,description,source:"real application build and live sources",captured_utc:new Date().toISOString(),bytes:data.byteLength,observed:observed||"",page_errors:errors});
 console.log("SCREENSHOT",filename,"bytes",data.byteLength,"observation",observed||"",flush=true);
}
async function group(page,label){
 const panel=page.locator("#earth-layer-panel");
 if((await panel.getAttribute("class"))?.includes("is-collapsed"))await page.getByRole("button",{name:"图层",exact:true}).click();
 await panel.evaluate((el,target)=>{
   for(const d of el.querySelectorAll("details"))d.open=Boolean(d.querySelector("summary")?.textContent?.includes(target));
 },label);
}
async function shot(name,handler){
 let page;
 try{
   const obj=await handler();page=obj?.page;
 }catch(e){records.push({file:null,name,error:String(e),captured_utc:new Date().toISOString()});console.error("SHOT FAILED",name,String(e));}
 finally{if(page)await page.close().catch(()=>{});}
}
await shot("01-overview",async()=>{
 const {page,errors}=await openScene({dayNight:true,cities:true,lights:true,atmosphere:true,geoLabels:true},cam(15,32,17000000));
 await pause(6500);
 await save("01-overview",page,"新版首页视角及地球夜光",errors,"TerraScope live home UI");
 return {page};
});
await shot("02-global-temperature",async()=>{
 const {page,errors}=await openScene({dayNight:false,temperature:true},cam(58,21,20000000));
 await group(page,"WEATHER");
 const area=page.locator(".weather-info");
 await area.waitFor({timeout:90000});
 await page.waitForFunction(()=>Boolean(document.querySelector(".weather-info")?.textContent?.includes("有效时间：")),null,{timeout:70000});
 await save("02-global-temperature",page,"NOAA GFS 2m 气温热力图",errors,(await area.textContent()||"").slice(0,600));
 return {page};
});
await shot("03-terminator-tour",async()=>{
 const {page,errors}=await openScene({dayNight:true,lights:true,cities:true},cam(20,32,16500000));
 await page.getByRole("button",{name:"晨昏线旅行"}).click();
 await page.locator(".terminator-tour").waitFor({timeout:60000});
 await pause(8000);
 await page.getByRole("button",{name:"暂停旅行"}).click();
 await save("03-terminator-tour",page,"晨昏线日出日落旅行模式",errors,(await page.locator(".terminator-tour").textContent()||"").slice(0,500));
 return {page};
});
await shot("04-location-weather",async()=>{
 const {page,errors}=await openScene({dayNight:false,cities:true},cam(11,48,4300000));
 const panel=page.locator("#earth-layer-panel");
 if(!(await panel.getAttribute("class"))?.includes("is-collapsed"))await page.getByRole("button",{name:"收起图层面板"}).click();
 await pause(1500);
 await page.locator(".cesium-widget canvas").click({position:{x:800,y:450},force:true});
 await page.getByRole("tab",{name:"天气"}).waitFor({timeout:40000});
 await page.getByRole("tab",{name:"天气"}).click();
 await page.locator(".location-weather-heading").waitFor({timeout:75000});
 await save("04-location-weather",page,"点击地球查看地点天气、环境及地质分类",errors,(await page.locator("#earth-inspector-panel").textContent()||"").slice(0,700));
 return {page};
});
await shot("05-infrared-clouds",async()=>{
 const {page,errors}=await openScene({dayNight:false,clouds:true},cam(110,20,22000000));
 await group(page,"EARTH VIEW");
 const content=page.locator(".cloud-controls");
 await content.waitFor({timeout:60000});
 await page.waitForFunction(()=>{
   const s=document.querySelector(".cloud-controls")?.textContent||"";
   return s.includes("NASA GIBS 区域红外影像")||s.includes("观测时间 20");
 },null,{timeout:95000});
 await save("05-infrared-clouds",page,"卫星红外云图与 NASA 区域备用源",errors,(await content.textContent()||"").slice(0,650));
 return {page};
});
await shot("06-satellite-3d",async()=>{
 const {page,errors}=await openScene({satellites:true,paths:true,dayNight:true},cam(15,42,17000000));
 await group(page,"SATELLITES");
 const btn=page.getByRole("button",{name:"跟踪 ISS · 国际空间站"});
 await btn.waitFor({timeout:105000});
 await btn.click();
 await page.locator(".track-card").waitFor({timeout:35000});
 await page.getByRole("button",{name:"模型近景"}).click();
 await page.waitForFunction(()=>{
   const t=document.querySelector(".track-card")?.textContent||"";
   return t.includes("三维模型已显示");
 },null,{timeout:95000});
 await save("06-satellite-3d",page,"ISS 三维模型近景与真实 SGP4 轨道预测",errors,(await page.locator(".track-card").textContent()||"").slice(0,600));
 return {page};
});
await browser.close();
const report={branch:process.env.GITHUB_REF_NAME||"",version:"2026-10-23",method:"Playwright Chromium screenshots of true application; live third-party data; no mock",shots:records};
writeFileSync(resolve(OUT,"manifest.json"),JSON.stringify(report,null,2));
console.log("SUMMARY",JSON.stringify(records.map(x=>({name:x.file||x.name,result:x.error?"FAILED":"OK",bytes:x.bytes||0}))));
if(records.filter(x=>x.file).length<2)process.exitCode=1;
