/**
 * Reference capture for video/shots.json using the site's recording mode
 * (src/recording.ts). It defines the protocol; the Remotion project may
 * reuse or replace it.
 *
 *   node --experimental-strip-types video/production/capture.mjs \
 *     --base http://localhost:4173/ --mode stills --out video/preview [--shot s5-iss]
 *
 * --mode stills  first / middle / last frame of each shot (framing review)
 * --mode frames  every frame at the output fps (PNG sequence per shot)
 * --shot a,b     only these shot ids
 * --anchor 2026-10-18  override the anchor day D (default: two days ago, UTC)
 *
 * Set PW_CHROMIUM_PATH to use a preinstalled Chromium.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { parseOvation, hemisphereMax, OVATION_URL } from "../../src/auroraData.ts";
import { cloudTimes, cloudFrameAt, CLOUD_METADATA_URL } from "../../src/cloudData.ts";
import { subsolarPoint } from "../../src/solar.ts";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1]]] : pairs), []));
const specText=readFileSync(new URL("../shots.json", import.meta.url), "utf8");
const spec=JSON.parse(specText);
const specSha256=createHash("sha256").update(specText).digest("hex");
const MANIFEST = args.out ?? "video/production/public/captures";
const BASE = args.base ?? spec.site.baseUrl;
const MODE = args.mode ?? "frames";
if(!["frames","stills"].includes(MODE))throw Error("mode must be frames or stills");
if(args["max-frames"]&&(!Number.isInteger(Number(args["max-frames"]))||Number(args["max-frames"])<1))throw Error("max-frames must be a positive integer");
const OUT = MANIFEST;
const { width, height, fps } = spec.output;
const HOUR = 3_600_000;

const DAY = 86_400_000;
const previous = existsSync(OUT + "/manifest.json") ? JSON.parse(readFileSync(OUT + "/manifest.json", "utf8")) : null;
const captureDate = new Date().toISOString().slice(0,10);
const anchor = args.anchor ? Date.parse(args.anchor + "T00:00:00Z") : previous ? Date.parse(previous.anchor) : Math.floor(Date.now() / DAY) * DAY - 2 * DAY;

if (!Number.isFinite(anchor)) throw Error('Invalid anchor');
const manifest = previous ?? {version:1, anchor:new Date(anchor).toISOString(),captureDate,specSha256,mode:MODE,baseUrl:BASE,shots:[]};
if(manifest.specSha256!==specSha256 || manifest.mode!==MODE || manifest.baseUrl!==BASE || manifest.anchor!==new Date(anchor).toISOString())throw Error('Output parameters changed; use new --out');
manifest.siteCommit ??= execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const save=()=>{mkdirSync(OUT,{recursive:true});writeFileSync(OUT+'/manifest.json.tmp',JSON.stringify(manifest,null,2));renameSync(OUT+'/manifest.json.tmp',OUT+'/manifest.json');};
const easings = {
  linear: (t) => t,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
};
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;
const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Keyframe values at shot progress t (0..1). */
function keyframeAt(keyframes, t, easing) {
  const e = easings[easing](t);
  let i = 0;
  while (i < keyframes.length - 2 && keyframes[i + 1].t < e) i++;
  const [a, b] = [keyframes[i], keyframes[i + 1] ?? keyframes[i]];
  const local = b.t === a.t ? 0 : (e - a.t) / (b.t - a.t);
  const out = {};
  for (const key of Object.keys(a)) {
    if (key === "t") continue;
    out[key] = key === "longitude" || key === "heading" || key === "headingOffset" ? lerpAngle(a[key], b[key], local) : lerp(a[key], b[key], local);
  }
  return out;
}

function sceneTime(shot, t) {
  if (shot.time.mode === "live") return null;
  const hours = lerp(shot.time.fromHours, shot.time.toHours, t);
  // Hourly stills land exactly on the hour (cloud frames are hourly).
  return anchor + (shot.time.mode === "hourly-stills" ? Math.round(hours) : hours) * HOUR;
}

function sceneUrl(shot) {
  const layers = { ...spec.defaults.layers, ...(shot.layers ?? {}), ...(shot.atmosphereShells ? { shells:true } : {}) };
  const options = { ...spec.defaults.options, ...(shot.options ?? {}), ...(shot.atmosphereShells ? { atmosphereShells: shot.atmosphereShells } : {}) };
  // The first pose seeds the page; the script sets the camera per frame anyway.
  const first=shot._indices?.[0]??0;
  const count=shot.time.mode==='hourly-stills'?Math.round(shot.time.toHours-shot.time.fromHours)+1:Math.round((shot.end-shot.start)*fps);
  const pose=keyframeAt(shot.camera.keyframes,first/(count-1),shot.camera.easing??spec.defaults.easing);
  const seed=shot.camera.type==='pose'?[pose.longitude,pose.latitude,pose.height,(pose.heading??0)*Math.PI/180,Math.max(-Math.PI/2+1e-6,(pose.pitch??-90)*Math.PI/180),0]:[0,0,20_000_000,0,-Math.PI/2+1e-6,0];
  const time=sceneTime(shot,first/(count-1));
  const scene = { v:1, camera:seed, layers, options, ...(time===null?{}:{time}) };
  return BASE + spec.site.recordQuery + "#scene=" + encodeURIComponent(JSON.stringify(scene));
}

async function applyFrame(page, shot, t, shotSeconds) {
  const time = sceneTime(shot, t);
  const easing = shot.camera.easing ?? spec.defaults.easing;
  const pose = keyframeAt(shot.camera.keyframes, t, easing);
  return page.evaluate(async ({ shot, time, pose, shotSeconds }) => {
    const api = window.__terrascope;
    api.setTime(time);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if (shot.effects?.auroraShimmer) api.setEffectsTime(shotSeconds * shot.effects.auroraShimmer.secondsPerSecond);
    if (shot.camera.type === "lookAtSatellite") {
      const sat = api.satellite(shot.camera.satellite);
      if (!sat) throw new Error("satellite " + shot.camera.satellite + " unavailable at this time");
      api.lookAt({ longitude: sat.longitude, latitude: sat.latitude, height: sat.altitudeKm * 1000, heading: sat.headingDeg + pose.headingOffset, pitch: pose.pitch, range: pose.range });
    } else {
      api.setCamera(pose);
    }
    return api.idle(shot.layers?.clouds ? 300_000 : 120_000);
  }, { shot, time, pose: shot.camera.longitudeRef === "antisolar" ? { ...pose, longitude: wrap(subsolarPoint(new Date()).longitude + 180 + pose.longitude) } : pose, shotSeconds });
}

async function captureShot(browser, shot) {
  let entry=manifest.shots.find(s=>s.requestedId===(shot.requestedId??shot.id));
  const duration=shot.end-shot.start;
  const count=shot.time.mode==='hourly-stills'?Math.round(shot.time.toHours-shot.time.fromHours)+1:MODE==='frames'?Math.round(duration*fps):3;
  if(!entry){entry={id:shot.id,requestedId:shot.requestedId??shot.id,expectedFrames:count,status:'pending',captureDate,frames:[],sources:[],auroraDecision:shot.auroraDecision};manifest.shots.push(entry);}
  if(entry.id!==shot.id)throw Error('Fallback changed; new output required');
  if(entry.status==='complete'&&entry.frames.length===count&&entry.frames.every(f=>existsSync(OUT+'/'+f.path)))return;
  if(shot.time.mode==='live'&&entry.captureDate!==captureDate)throw Error('Live aurora cannot resume across days');
  entry.status='capturing';save();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(600000);
  const errors=[];
  let cloudCatalog;
  let expectedCloudTime=null;let frameIndex=null;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('requestfailed',r=>{if(!/ERR_ABORTED/.test(r.failure()?.errorText??'')&&!/favicon|planetary_k_index/.test(r.url()))errors.push(r.failure()?.errorText+' '+r.url());});
  page.on('response',r=>{entry.sources.push({url:r.url(),status:r.status(),at:new Date().toISOString()});if(r.status()>=400&&!/favicon|planetary_k_index/.test(r.url()))errors.push('HTTP '+r.status()+' '+r.url());});
  if(shot.id==='s4-aurora')await page.route(OVATION_URL,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(auroraPayload)}));
  try {
  await page.goto("about:blank");
  await page.goto(sceneUrl(shot), {timeout:120000});
  await page.waitForFunction(() => window.__terrascope, null, { timeout: 60_000 });
  await page.evaluate(async ({ ui, track }) => {
    const api = window.__terrascope;
    await api.ready();
    api.setUi(ui);
    api.showTrackCard(track ?? null);
  }, { ui: shot.ui ?? spec.defaults.ui, track: shot.trackCard });
  if (shot.camera.type === "lookAtSatellite") {
    await page.waitForFunction((id) => window.__terrascope.satellite(id) !== null, shot.camera.satellite, { timeout: 60_000 });
  }
  if(shot.layers?.clouds){const response=await page.request.get(CLOUD_METADATA_URL,{timeout:120000});if(!response.ok())throw Error("Cloud metadata unavailable");const payload=await response.json();cloudCatalog=cloudTimes(payload);writeFileSync(OUT+"/"+shot.id+"-cloud-catalog.json",JSON.stringify(payload));}
  // Warm-up: the first pose of a shot loads most of its tiles; give it longer.
  const firstIndex=shot._indices?.find(i=>!entry.frames.some(f=>f.index===i&&existsSync(OUT+'/'+f.path)))??0;
  console.log(shot.id,'warmup hour/frame',firstIndex,new Date().toISOString());
  if(!await applyFrame(page,shot,firstIndex/(count-1),firstIndex/(count-1)*duration)){
    const diagnostic=await page.evaluate(()=>({statuses:Array.from(document.querySelectorAll('[role=status]')).map(e=>e.textContent),resources:performance.getEntriesByType('resource').slice(-50).map(r=>({name:r.name,duration:r.duration,responseEnd:r.responseEnd}))}));
    writeFileSync(OUT+'/'+shot.id+'-timeout-'+firstIndex+'.json',JSON.stringify({diagnostic,errors,sources:entry.sources.slice(-100)},null,2));
    await page.screenshot({path:OUT+'/'+shot.id+'-timeout-'+firstIndex+'.png',timeout:180000});
    throw Error('Warmup tile load timeout');
  }
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.layer-status,.thematic-note,.satellite-status')).some(e=>/正在读取/.test(e.textContent??'')),null,{timeout:120000});
  if(!await page.evaluate(()=>window.__terrascope.idle(300_000)))throw Error("Warmup final idle timeout");

  const sequence=MODE==="frames"||shot.time.mode==="hourly-stills";
  const dir = OUT + (sequence ? "/" + shot.id : "");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < Math.min(count,Number(args["max-frames"]??count)); i++) {
    if(shot._indices&&!shot._indices.includes(i))continue;
    const existing=entry.frames.find(f=>f.index===i);if(existing&&existsSync(OUT+'/'+existing.path))continue;
    if(shot.time.mode==='live'&&new Date().toISOString().slice(0,10)!==captureDate)throw Error('Aurora crossed UTC midnight');
    const t = count === 1 ? 0 : i / (count - 1);
    frameIndex=i;
    const started = Date.now();
    const loaded = await applyFrame(page, shot, t, t * duration);
    if(shot.layers?.clouds){
      const expected=cloudFrameAt(cloudCatalog,sceneTime(shot,t)+HOUR-1);if(!expected)throw Error('No cloud observation for requested hour');
      const label=expected.toISOString().slice(0,16).replace('T',' ')+' UTC';expectedCloudTime=label;console.log(shot.id,'hour',i,'expected',label);
      await page.waitForFunction(label=>Array.from(document.querySelectorAll('.thematic-note')).some(e=>(e.textContent??'').includes(label)),label,{timeout:120000});
    }
    if(!loaded)throw Error('Tile load timeout frame '+i);
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.layer-status,.thematic-note,.satellite-status')).some(e=>/正在读取/.test(e.textContent??'')),null,{timeout:120000});
    const status=await page.locator('.layer-status,.thematic-note,.satellite-status').allTextContents();
    if(status.some(s=>/加载失败|暂不可用|这一时刻没有|暂无.*云图/.test(s)))throw Error('Missing data: '+status.join('; '));
    if(errors.length)throw Error(errors.join('; '));
    if(!await page.evaluate(()=>window.__terrascope.idle(300000)))throw Error('Data tile load timeout');
    const name = sequence ? dir + "/" + String(i).padStart(4, "0") + ".png" : dir + "/" + shot.id + "-" + ["a", "b", "c"][i] + ".jpg";
    await page.screenshot({ path: name, ...(sequence ? {} : { type: "jpeg", quality: 85 }), timeout: 180_000 });
    entry.frames.push({index:i,path:name.slice(OUT.length+1),sceneTime:sceneTime(shot,t)===null?null:new Date(sceneTime(shot,t)).toISOString(),capturedAt:new Date().toISOString()});save();
    console.log("  frame", i, "in", ((Date.now() - started) / 1000).toFixed(1) + " s", loaded ? "" : "(tiles still loading at timeout)");
  }
  console.log("captured", shot.id, entry.frames.length, "frame(s)");
  entry.finishedAt=new Date().toISOString();delete entry.error;
  entry.frames.sort((a,b)=>a.index-b.index);entry.status=entry.frames.length===count?'complete':'partial';save();
   }catch(error){
    entry.status='failed';entry.error=String(error);save();
    try{const diagnostic=await page.evaluate(()=>({statuses:Array.from(document.querySelectorAll('[role=status],.thematic-note')).map(e=>e.textContent),resources:performance.getEntriesByType('resource').slice(-80).map(r=>({name:r.name,duration:r.duration,responseEnd:r.responseEnd}))}));
    const filename=OUT+'/'+shot.id+'-failure-'+(shot._indices?.[0]??0);
    writeFileSync(filename+'.json',JSON.stringify({error:String(error),frameIndex,expectedCloudTime,diagnostic,errors,sources:entry.sources.slice(-100)},null,2));await page.screenshot({path:filename+'.png',timeout:180000});}catch(diagnosticError){console.error('Diagnostic failed',String(diagnosticError));}
    throw error;
  }finally{await page.close();}

}

const wanted=args.shot?args.shot.split(','):null;
let shots=spec.shots.filter(s=>s.type!=='remotion-only'&&(wanted?wanted.includes(s.id):!s.optional));
if(wanted?.some(id=>!shots.some(s=>s.id===id)))throw Error('Unknown shot');
if(args['dry-run']){console.log(JSON.stringify({anchor:new Date(anchor).toISOString(),shots:shots.map(s=>({id:s.id,frames:s.time.mode==='hourly-stills'?31:MODE==='frames'?Math.round((s.end-s.start)*fps):3}))},null,2));process.exit(0);}
if(args['frame-indices']){const indices=args['frame-indices'].split(',').map(Number);if(indices.some(i=>!Number.isInteger(i)||i<0))throw Error('Invalid frame indices');shots=shots.map(s=>({...s,_indices:indices}));}
let auroraPayload;
if(shots.some(s=>s.id==='s4-aurora')){
 const path=OUT+'/noaa-ovation.json';
 const prior=manifest.shots.find(s=>s.requestedId==='s4-aurora');
 if(prior&&prior.captureDate!==captureDate)throw Error('Aurora must be captured same day; use new output');
 if(prior&&existsSync(path))auroraPayload=JSON.parse(readFileSync(path,'utf8'));
 else{const r=await fetch(OVATION_URL,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('NOAA HTTP '+r.status);auroraPayload=await r.json();mkdirSync(OUT,{recursive:true});writeFileSync(path,JSON.stringify(auroraPayload));}
 const grid=parseOvation(auroraPayload);
 if(!grid.forecastTime||Math.abs(Date.now()-grid.forecastTime.getTime())>DAY)throw Error('NOAA forecast stale');
 const north=hemisphereMax(grid,'north'),south=hemisphereMax(grid,'south');
 const decision={north,south,selected:north>=8?'north':south>=8?'south':'atmosphere',source:OVATION_URL,forecastTime:grid.forecastTime.toISOString(),capturedAt:new Date().toISOString()};
 shots=shots.map(s=>{if(s.id!=='s4-aurora')return s;if(decision.selected==='atmosphere')return {...spec.shots.find(s=>s.id==='s4b-atmosphere'),requestedId:s.id,auroraDecision:decision};const copy=structuredClone(s);if(decision.selected==='south')copy.camera.keyframes.forEach((k,i)=>Object.assign(k,{latitude:[-55,-56][i],heading:[180,174][i]}));return {...copy,auroraDecision:decision};});
}
const browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM_PATH||undefined,args:args.hardware?['--use-angle=d3d11']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
let cursor=0;const failed=[];
const cloudWorkers=Number(args['cloud-workers']??2);
if(!Number.isInteger(cloudWorkers)||cloudWorkers<1||cloudWorkers>3)throw Error('cloud-workers must be1..3');
// Every cloud observation owns a fresh page: no old/pending cloud layer can leak across hours.
shots=shots.flatMap(shot=>shot.time.mode!=='hourly-stills'?[shot]:(shot._indices??Array.from({length:Math.round(shot.time.toHours-shot.time.fromHours)+1},(_,i)=>i)).filter(i=>!manifest.shots.find(s=>s.id===shot.id)?.frames.some(f=>f.index===i&&existsSync(OUT+'/'+f.path))).map(i=>({...shot,_indices:[i]})));
const concurrency=Number(args.concurrency??(shots.every(s=>s.time.mode==='hourly-stills')?cloudWorkers:2));if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw Error('concurrency must be 1..4');
try{await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<shots.length){const s=shots[cursor++];try{await captureShot(browser,s);}catch(e){failed.push(s.id);console.error(s.id,e);}}}));}finally{await browser.close();}
if(failed.length){for(const id of new Set(failed)){const entry=manifest.shots.find(s=>s.id===id);if(entry&&entry.frames.length<entry.expectedFrames)entry.status='failed';}save();process.exitCode=1;}
