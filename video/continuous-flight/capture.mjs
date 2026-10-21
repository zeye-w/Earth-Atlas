/**
 * Terrascope continuous-camera flight (one Chromium page, one Cesium Viewer).
 * Every source frame is recorded from real website WebGL with real data.
 * No fake data. The final edit interpolates between the measured source
 * frames only to produce a standard 30fps encoding.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { subsolarPoint } from "../../src/solar.ts";

const OUT=process.env.FLIGHT_OUT||"video/continuous-flight/out";
const SITE=process.env.FLIGHT_PRODUCTION_SITE||"https://earth-atlas.edwardlab.workers.dev/";
const LOCAL=process.env.FLIGHT_LOCAL_SITE||"http://127.0.0.1:4173/";
const RATE=Number(process.env.FLIGHT_SOURCE_FPS||"6");
const SECONDS=Number(process.env.FLIGHT_SECONDS||"27");
const W=1920,H=1080,R=6371000;
if(!Number.isInteger(RATE)||RATE<1||RATE>30||SECONDS<=0||SECONDS>27)throw Error("Invalid source frame contract");
mkdirSync(OUT+"/frames",{recursive:true});
const source={at:new Date().toISOString(),site:SITE,branch:process.env.GITHUB_REF_NAME||"",rate:RATE,duration:SECONDS,frames:[],chapters:[],failures:[],realData:true,method:"single Chromium/Cesium viewer; ECEF camera slerp with real WebGL capture; no mocked scientific data; 30fps output is interpolated between source frames"};
const save=()=>writeFileSync(OUT+"/manifest.json",JSON.stringify(source,null,2));
const normalize=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(a,k)=>a.map(v=>v*k);
const rad=d=>d*Math.PI/180;
const surf=(lon,lat,h=0)=>{
  const u=[Math.cos(rad(lat))*Math.cos(rad(lon)),Math.cos(rad(lat))*Math.sin(rad(lon)),Math.sin(rad(lat))];
  return mul(u,R+h);
};
const slerp=(a,b,t)=>{
  const na=normalize(a),nb=normalize(b),dot=Math.max(-1,Math.min(1,na.reduce((s,v,i)=>s+v*nb[i],0)));
  if(dot>0.9995)return normalize(na.map((v,i)=>v+(nb[i]-v)*t));
  const th=Math.acos(dot),s=Math.sin(th);
  return add(mul(na,Math.sin((1-t)*th)/s),mul(nb,Math.sin(t*th)/s));
};
const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const ease=t=>t*t*(3-2*t);
function waypoint(time,lon,lat,height,target=[0,0,0]){
  return {time,position:surf(lon,lat,height),target};
}
function flightPose(points,t){
  const j=Math.max(0,points.findIndex((p,i)=>i<points.length-1&&p.time<=t&&points[i+1].time>=t));
  if(t>=points.at(-1).time)return {position:points.at(-1).position,target:points.at(-1).target};
  const a=points[j],b=points[j+1],v=ease(Math.max(0,Math.min(1,(t-a.time)/(b.time-a.time))));
  const radius=Math.exp(Math.log(Math.hypot(...a.position))*(1-v)+Math.log(Math.hypot(...b.position))*v);
  return {position:mul(slerp(a.position,b.position,v),radius),target:lerp(a.target,b.target,v)};
}
const matchers={
  "satellites":/已加载\s+[1-9]\d*\s+颗卫星/,
  "starlink":/[1-9][\d,]*\s+颗卫星.*根数获取于/,
  "flights":/[1-9][\d,]*\s+架航空器/,
  "solar":/磁层顶距地心/,
  "aurora":/预报时间|当前预报无明显极光/
};
const stages=[
  {at:0,key:"satellites",on:{satellites:true,paths:true}},
  {at:5,key:"starlink",on:{starlink:true}},
  {at:10,key:"flights",on:{satellites:false,starlink:false,flights:true}},
  {at:16,key:"solar",on:{flights:false,solarWind:true}},
  {at:22,key:"aurora",on:{solarWind:false,aurora:true}}
];
const initialLayers={
  clouds:false,geology:false,dayNight:true,cities:false,atmosphere:true,aurora:false,
  lights:true,quakes:false,plates:false,volcanoes:false,satellites:true,paths:true,
  geoLabels:false,trueColor:false,starlink:false,solarWind:false,flights:false
};
const scene={v:1,camera:[58,19,17000000,0,-Math.PI/2+0.00001,0],layers:initialLayers,
  options:{cloudOpacity:65,opacity:90,mapMode:"raster",ageFilter:"all",rockFilter:"all",quakeRange:"week",atmosphereShells:0}};
const targetUrl=LOCAL+"?record#scene="+encodeURIComponent(JSON.stringify(scene));

const browser=await chromium.launch({headless:true,args:["--no-sandbox","--enable-webgl","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});
page.setDefaultTimeout(240000);
const errors=[];
page.on("pageerror",error=>errors.push("JS "+error.message));
page.on("requestfailed",req=>{
  if(!/ERR_ABORTED/.test(req.failure()?.errorText||""))errors.push("NET "+req.failure()?.errorText+" "+req.url());
});
page.on("response",res=>{
  if(res.status()>=400&&!/favicon|planetary_k_index/.test(res.url()))errors.push("HTTP "+res.status()+" "+res.url());
});
// Vite preview serves the modified recorder. Preserve the production
// Worker flight API without fabricating or manually substituting its payload.
await page.route("**/api/flights",async route=>{
  try{
    const response=await route.fetch({url:new URL("/api/flights",SITE).toString(),timeout:120000});
    await route.fulfill({response});
  }catch(e){console.error("Flight proxy failure",String(e));await route.abort();}
});
async function demand(key){
  const ready=matchers[key];
  await page.waitForFunction(pattern=>{
    const text=[...document.querySelectorAll(".satellite-status,.layer-status,.solar-wind-panel")].map(e=>e.textContent||"").join(" ");
    return new RegExp(pattern).test(text);
  },ready.source,{timeout:240000});
  const data=await page.locator("#earth-layer-panel").textContent();
  const item={id:key,utc:new Date().toISOString(),summary:data.slice(-2300)};
  source.chapters.push(item);
  if(/暂不可用|加载失败|未显示.*虚构/.test(data)&&!ready.test(data))throw Error(key+" has no current scientific data");
  console.log("DATA READY:",key,item.utc);
}
try{
  await page.goto(targetUrl,{waitUntil:"domcontentloaded",timeout:120000});
  await page.waitForFunction(()=>Boolean(window.__terrascope?.setCameraCartesian),null,{timeout:120000});
  await page.evaluate(async()=>{await window.__terrascope.ready();window.__terrascope.setUi("clean");window.__terrascope.setTime(null);});
  const iss=await page.evaluate(async()=> {
    for(let i=0;i<60;i++){
      const p=window.__terrascope.satellite("iss");
      if(p)return p;
      await new Promise(r=>setTimeout(r,500));
    }
    throw Error("ISS orbital data not ready");
  });
  const sun=subsolarPoint(new Date());
  const anti=(sun.longitude+180+540)%360-180;
  const hemisphere=55;
  const sunUnit=normalize(surf(sun.longitude,sun.latitude,0));
  let side=normalize([-sunUnit[1],sunUnit[0],0]);
  if(!Number.isFinite(side[0]))side=[1,0,0];
  const magnetPos=add(add(mul(side,49*R),mul([0,0,1],12*R)),mul(sunUnit,5*R));
  const magnetTarget=mul(sunUnit,5*R);
  const positions=[
    waypoint(0,iss.longitude,iss.latitude,1800000,surf(iss.longitude,iss.latitude,iss.altitudeKm*1000)),
    waypoint(3.3,iss.longitude+10,iss.latitude+6,4300000,surf(iss.longitude,iss.latitude,0)),
    waypoint(5.0,iss.longitude+20,iss.latitude+8,8500000,[0,0,0]),
    waypoint(8.7,iss.longitude+50,iss.latitude+8,14800000,[0,0,0]),
    waypoint(10.0,20,50,9400000,[0,0,0]),
    waypoint(12.9,12,49,4500000,surf(12,49,0)),
    waypoint(15.8,22,46,6000000,surf(17,47,0)),
    waypoint(18.2,34,30,24000000,[0,0,0]),
    {time:21.5,position:magnetPos,target:magnetTarget},
    {time:22,position:magnetPos,target:magnetTarget},
    waypoint(24.8,anti,62,1500000,surf(anti,61,0)),
    waypoint(27,anti+17,63,4800000,[0,0,0])
  ];
  let stageIndex=-1;
  let frame=0;
  for(let i=0;i<Math.ceil(SECONDS*RATE);i++){
    const t=i/RATE;
    const next=Math.max(0,stages.findLastIndex(s=>s.at<=t));
    if(next!==stageIndex){
      stageIndex=next;
      const stage=stages[stageIndex];
      if(stageIndex>0)await page.evaluate(patch=>window.__terrascope.setLayers(patch),stage.on);
      await demand(stage.key);
    }
    const pose=flightPose(positions,t);
    await page.evaluate(async({pose,t})=>{
      const api=window.__terrascope;
      api.setCameraCartesian(pose);
      api.setEffectsTime(t);
      if(!await api.idle(25000))throw Error("Tiles or pending work did not settle");
    },{pose,t});
    const image=OUT+"/frames/"+String(frame).padStart(4,"0")+".png";
    await page.screenshot({path:image,timeout:120000,animations:"disabled"});
    source.frames.push({frame,seconds:Number(t.toFixed(5)),file:"frames/"+String(frame).padStart(4,"0")+".png",data:stages[stageIndex].key});
    frame++;
    if(i%RATE===0){save();console.log("FRAME",frame,"/",Math.ceil(SECONDS*RATE),"TIME",t);}
  }
  source.completedAt=new Date().toISOString();
  source.networkErrors=errors.slice(-200);
  save();
}catch(e){
  source.failures.push({at:new Date().toISOString(),error:String(e?.stack||e)});
  source.networkErrors=errors.slice(-200);save();
  throw e;
}finally{await page.close().catch(()=>{});await browser.close();}
