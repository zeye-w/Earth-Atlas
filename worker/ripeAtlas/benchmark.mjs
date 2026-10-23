/** Usage: node --experimental-strip-types worker/ripeAtlas/benchmark.mjs [ROOT-RESPONSES.json [RECORDING.json]]
 * ROOT-RESPONSES is a recording keyed a..m of the official per-letter JSON. With no recording, fetches live public data.
 * A recording has {probes:[{id,geometry}],all:{a:[AtlasResult],...}}.
 * CPU numbers are local Node measurements, not deployed Cloudflare billing metrics.
 */
import {readFile} from 'node:fs/promises';
import {buildSnapshot,DNS_MEASUREMENTS} from '../../src/internet/dnsFlows.ts';
import {parseDnsFlowSnapshot} from '../../src/internet/data.ts';
import {parseRootSites} from './roots.ts';
import {createDnsFlowsHandler} from '../ripeAtlas.ts';
let rawRoots;
if(process.argv[2])rawRoots=JSON.parse(await readFile(process.argv[2],'utf8'));
else{
 rawRoots={};
 for(const l of 'abcdefghijklm'){
 if(Object.keys(rawRoots).length)await new Promise(resolve=>setTimeout(resolve,1000));
 const r=await fetch(`https://root-servers.org/root/${l.toUpperCase()}/json/`,{headers:{'User-Agent':'Earth-Atlas (+https://github.com/zeye-w/Earth-Atlas)',Accept:'application/json'},redirect:'error'});
 if(!r.ok)throw Error('Root '+l+' HTTP '+r.status);rawRoots[l]=await r.json();
 }
}
const roots={instances:Object.entries(rawRoots).flatMap(([l,raw])=>parseRootSites(l,raw))};
const headers={'User-Agent':'Earth-Atlas (+https://github.com/zeye-w/Earth-Atlas)'};
let data;
if(process.argv[3])data=JSON.parse(await readFile(process.argv[3],'utf8'));
else{
 const pages=await Promise.all(['US','BR','ZA','DE','IN','JP','AU','NL'].map(async country=>{
 const r=await fetch(`https://atlas.ripe.net/api/v2/probes/?status=1&is_public=true&country_code=${country}&page_size=6`,{headers});if(!r.ok)throw Error(r.status);return (await r.json()).results.filter(p=>p.is_public!==false&&p.geometry?.coordinates);
 }));
 const probes=[];for(let n=0;n<6;n++)for(const p of pages)if(p[n])probes.push(p[n]);
 const all={};await Promise.all(Object.entries(DNS_MEASUREMENTS).map(async([l,id])=>{const r=await fetch(`https://atlas.ripe.net/api/v2/measurements/${id}/latest/?probe_ids=${probes.map(p=>p.id).join(',')}`,{headers});if(!r.ok)throw Error(r.status);all[l]=await r.json();}));
 data={probes,all};
}
data.probes=data.probes.slice(0,48);
const selected=new Set(data.probes.map(p=>p.id));
for(const l of Object.keys(data.all))data.all[l]=data.all[l].filter(r=>selected.has(r.prb_id));
const points=new Map(data.probes.map(p=>[p.id,p.geometry.coordinates.map(v=>Math.round(v*100)/100)]));
// For recordings evaluate at the newest recorded observation, making reruns stable.
const now=process.argv[3]?Math.max(...Object.values(data.all).flat().map(r=>r.timestamp*1000)):Date.now();
const snapshot=buildSnapshot(data.all,points,roots.instances,now);
if(parseDnsFlowSnapshot(snapshot).flows.length!==snapshot.flows.length)throw Error('Parser dropped flows');
for(const l of Object.keys(DNS_MEASUREMENTS)){const s=buildSnapshot({[l]:data.all[l]},points,roots.instances,now);console.log(`${l.toUpperCase()} ${DNS_MEASUREMENTS[l]} ${s.matched}/${s.examined}`);}
console.log(`total ${snapshot.matched}/${snapshot.examined}; ${roots.instances.length} sites; ${points.size} probes`);
for(let i=0;i<100;i++)buildSnapshot(data.all,points,roots.instances,now);
const batches=[];const wall=[];
for(let batch=0;batch<10;batch++){
 const start=process.cpuUsage(),time=performance.now();
 for(let n=0;n<100;n++){JSON.stringify(buildSnapshot(data.all,points,roots.instances,now));}
 const cpu=process.cpuUsage(start);batches.push((cpu.user+cpu.system)/100000);wall.push((performance.now()-time)/100);
}
console.log(JSON.stringify({runtime:process.version,cpuMsPerSnapshot:batches,wallMsPerSnapshot:wall,coldSubrequests:34,refreshSubrequests:13,cachedSubrequests:0},null,2));
// Replay the complete handler, including UTF-8 decode, JSON parse and serialization.
// Response bodies are recorded bytes; this measures CPU without network wait time.
const countries=['US','BR','ZA','DE','IN','JP','AU','NL'];
const bodies=new Map(Object.entries(DNS_MEASUREMENTS).map(([l,id])=>[id,JSON.stringify(data.all[l])]));
const rootBodies=Object.fromEntries(Object.entries(rawRoots).map(([l,r])=>[l,JSON.stringify(r,null,2)]));
const network=async url=>{
 const u=new URL(url);
 if(u.hostname==='root-servers.org')return new Response(rootBodies[u.pathname.split('/')[2].toLowerCase()]);
 if(u.pathname.includes('/probes/')){
 const n=countries.indexOf(u.searchParams.get('country_code'));
 return Response.json({results:data.probes.filter((_,i)=>i%8===n)});
 }
 return new Response(bodies.get(Number(u.pathname.split('/')[4])));
};
const assets={fetch:async()=>{throw Error('Unexpected ASSETS request');}};
const edge={match:async()=>undefined,put:async(_key,response)=>{await response.arrayBuffer();}};
const cpuStart=process.cpuUsage(),threadStart=process.threadCpuUsage(),wallStart=performance.now();
for(let n=0;n<100;n++){
 const r=await createDnsFlowsHandler(network,()=>now,edge,async()=>{})(new Request('https://benchmark.invalid/api/internet/dns-flows'),assets);
 if(r.status!==200)throw Error('Handler replay failed');await r.text();
}
const used=process.cpuUsage(cpuStart),threadUsed=process.threadCpuUsage(threadStart);
console.log(JSON.stringify({completeColdHandlerReplayProcessCpuMs:(used.user+used.system)/100000,completeColdHandlerReplayThreadCpuMs:(threadUsed.user+threadUsed.system)/100000,completeColdHandlerReplayWallMs:(performance.now()-wallStart)/100}));
