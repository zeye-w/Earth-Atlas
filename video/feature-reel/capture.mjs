/**
 * Capture genuine Terrascope browser frames of five live-data features.
 * No mocked telemetry or fabricated flight/aurora/solar-wind data.
 * Audio and editorial animation are added separately, with provenance preserved.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { subsolarPoint } from "../../src/solar.ts";

const WIDTH = 1920;
const HEIGHT = 1080;
const out = process.env.REEL_OUT || "video/feature-reel/out";
const base = (process.env.REEL_SITE || "https://earth-atlas.edwardlab.workers.dev/").replace(/\/?$/, "/");
const layers = {
  clouds: false, geology: false, dayNight: true, cities: false,
  atmosphere: true, aurora: false, lights: true, quakes: false,
  plates: false, volcanoes: false, satellites: false, paths: false,
  geoLabels: false, trueColor: false, starlink: false, solarWind: false,
  flights: false
};
const options = {
  cloudOpacity: 65, opacity: 90, mapMode: "raster", ageFilter: "all",
  rockFilter: "all", quakeRange: "week", atmosphereShells: 0
};
const angles = [
  {
    id: "01-satellites", title: "六颗精选卫星 / SGP4", enabled: { satellites: true, paths: true },
    ready: /已加载\s+[1-9]\d*\s+颗卫星/,
    cameras: [{follow:"iss",range:3700000,heading:12,pitch:-20},{follow:"iss",range:3100000,heading:35,pitch:-26},{follow:"iss",range:2750000,heading:55,pitch:-24}]
  },
  {
    id: "02-starlink", title: "Starlink / CelesTrak SGP4", enabled: { starlink: true },
    ready: /[1-9][\d,]*\s+颗卫星.*根数获取于/,
    cameras: [
      {longitude:15,latitude:25,height:19500000,pitch:-90},
      {longitude:45,latitude:24,height:17500000,pitch:-90},
      {longitude:68,latitude:27,height:17500000,pitch:-90}
    ]
  },
  {
    id: "03-flights", title: "实时航空器 / ADS-B 观测", enabled: { flights: true },
    ready: /[1-9][\d,]*\s+架航空器/,
    cameras: [
      {longitude:8,latitude:49,height:6000000,pitch:-90},
      {longitude:19,latitude:49,height:4800000,pitch:-90},
      {longitude:-80,latitude:38,height:4800000,pitch:-90}
    ]
  },
  {
    id: "04-magnetosphere", title: "太阳风与磁层 / NOAA + Shue (1998)", enabled: { solarWind: true },
    ready: /磁层顶距地心/,
    cameras: [{magnetosphere:true},{magnetosphere:true},{magnetosphere:true}]
  },
  {
    id: "05-aurora", title: "极光概率预报 / NOAA OVATION", enabled: { aurora: true },
    ready: /预报时间|当前预报无明显极光/,
    cameras: [{aurora:-8},{aurora:0},{aurora:8}]
  }
];
function sceneUrl(chapter) {
  const scene = {
    v:1, camera:[50,15,17000000,0,-Math.PI/2+0.00001,0],
    layers:{...layers,...chapter.enabled}, options
  };
  return base + "?record#scene=" + encodeURIComponent(JSON.stringify(scene));
}
async function readyText(page, chapter) {
  await page.waitForFunction((id) => Boolean(window.__terrascope), null, {timeout:120000});
  await page.evaluate(async () => {
    await window.__terrascope.ready();
    window.__terrascope.setUi("full");
    window.__terrascope.setTime(null);
  });
  await page.waitForFunction((pattern) => {
    const paragraphs = Array.from(document.querySelectorAll(".satellite-status, .layer-status, .solar-wind-panel, .kp-panel"));
    const text = paragraphs.map(p => p.textContent || "").join(" ");
    return new RegExp(pattern).test(text);
  }, chapter.ready.source, {timeout:180000});
  return page.locator("#earth-layer-panel").textContent();
}
function noFalseClaims(status, chapter) {
  if (chapter.id === "05-aurora" && /当前预报无明显极光/.test(status)) {
    return "quiet";
  }
  return "available";
}
async function capture() {
  mkdirSync(out,{recursive:true});
  const manifest = {title:"Terrascope · five scientific data layers",date:new Date().toISOString(),source:base,output:"1920x1080@30",note:"Website screenshots are genuine live-data WebGL frames; motion between recorded stills is editorial Ken Burns, not uninterrupted real-time screen capture.",chapters:[],errors:[]};
  const browser = await chromium.launch({headless:true,args:["--no-sandbox","--enable-webgl","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  try {
    for(const chapter of angles) {
      console.log("CAPTURE",chapter.id,chapter.title);
      const page = await browser.newPage({viewport:{width:WIDTH,height:HEIGHT},deviceScaleFactor:1});
      page.setDefaultTimeout(200000);
      const errors=[];
      page.on("pageerror",e=>errors.push("pageerror: "+e.message));
      page.on("requestfailed",r=>{
        if(!/ERR_ABORTED/.test(r.failure()?.errorText||""))
          errors.push("request: "+r.url()+" "+(r.failure()?.errorText||""));
      });
      const entry = {id:chapter.id,title:chapter.title,at:new Date().toISOString(),data:"",capture:[],errors};
      manifest.chapters.push(entry);
      try {
        await page.goto(sceneUrl(chapter),{waitUntil:"domcontentloaded",timeout:120000});
        const status=await readyText(page,chapter);
        entry.data = status.slice(0,1800);
        entry.dataAvailability=noFalseClaims(status,chapter);
        if(chapter.id==="04-magnetosphere") {
          const earth=page.locator("#earth-layer-panel details.layer-group").filter({has:page.locator("summary",{hasText:"EARTH VIEW"})});
          if(!await earth.evaluate(el=>el.open)) await earth.locator("summary").click();
          await page.getByRole("button",{name:"拉远查看磁层"}).click();
          await page.waitForTimeout(3100);
        }
        if(chapter.id==="01-satellites") {
          await page.waitForFunction(()=>window.__terrascope.satellite("iss")!==null,null,{timeout:60000});
        }
        await page.evaluate(()=>window.__terrascope.setUi("clean"));
        for(let i=0;i<chapter.cameras.length;i++){
          const pose=chapter.cameras[i];
          const result=await page.evaluate(async ({pose,id,idx})=>{
            const api=window.__terrascope;
            api.setEffectsTime(idx*1.8);
            if(pose.follow){
              const sat=api.satellite(pose.follow);
              if(!sat)throw Error("No current orbit available to frame the ISS");
              api.lookAt({longitude:sat.longitude,latitude:sat.latitude,height:sat.altitudeKm*1000,heading:sat.headingDeg+pose.heading,pitch:pose.pitch,range:pose.range});
            }else if(pose.aurora!==undefined){
              const sun=await (async()=>null)();
              // The antisolar longitude is provided by the outer capture process.
              api.setCamera({longitude:pose.antiLongitude,latitude:pose.antiLatitude,height:880000-idx*80000,heading:idx*3,pitch:-25});
            }else if(pose.magnetosphere){
              // Respect the app camera established by "拉远查看磁层".
              api.setEffectsTime(idx*1.9);
            }else{
              api.setCamera(pose);
            }
            const tilesReady=await api.idle(90000);
            return {tilesReady};
          },{pose: pose.aurora===undefined?pose:{...pose,antiLongitude:((((subsolarPoint(new Date()).longitude+180+pose.aurora+180)%360)+360)%360)-180,antiLatitude:56},id:chapter.id,idx:i});
          if(!result.tilesReady)throw Error("Unfinished Cesium tile/background work after 90 s on "+chapter.id);
          await page.waitForTimeout(i===0?1800:600);
          const path=out+"/"+chapter.id+"-"+i+".png";
          await page.screenshot({path,animations:"disabled",timeout:120000});
          entry.capture.push(path.replace(out+"/",""));
          console.log("SAVED",path);
        }
      }catch(e){
        entry.failure=String(e?.stack||e);
        manifest.errors.push({chapter:chapter.id,error:entry.failure});
        console.error("FAIL",chapter.id,entry.failure);
      }finally{
        await page.close().catch(()=>{});
        writeFileSync(out+"/manifest.json",JSON.stringify(manifest,null,2));
      }
    }
  }finally{
    await browser.close();
  }
  if(manifest.errors.length)throw Error("Real-data capture incomplete: "+manifest.errors.map(e=>e.chapter).join(", "));
}
await capture();
