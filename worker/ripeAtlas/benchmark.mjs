/** Local-only benchmark: node --experimental-strip-types worker/ripeAtlas/benchmark.mjs ROOTS.json RECORDING.json [48,80,100,128,160,200]
 * ROOTS: full official per-letter root JSON, never commit it. RECORDING contains
 * all projected anchor candidates and real results for up to 200 selected probes.
 * Measurements are evaluated at the newest recorded observation, not today's time.
 */
import {readFile} from 'node:fs/promises';
import {buildSnapshot,DNS_MEASUREMENTS} from '../../src/internet/dnsFlows.ts';
import {parseDnsFlowSnapshot} from '../../src/internet/data.ts';
import {parseRootSites} from './roots.ts';
import {selectProbes,probeContinent,PROBE_LIMIT,ANCHOR_PAGE_SIZE} from './probes.ts';
import {createDnsFlowsHandler} from '../ripeAtlas.ts';
const rawRoots=JSON.parse(await readFile(process.argv[2],'utf8'));
const data=JSON.parse(await readFile(process.argv[3],'utf8'));
const sizes=(process.argv[4]??String(PROBE_LIMIT)).split(',').map(Number);
const roots=Object.entries(rawRoots).flatMap(([l,r])=>parseRootSites(l,r));
const rootBodies=Object.fromEntries(Object.entries(rawRoots).map(([l,r])=>[l,JSON.stringify(r,null,2)]));
const anchorBodies=[];
for(let i=0;i<data.probes.length;i+=ANCHOR_PAGE_SIZE)anchorBodies.push(JSON.stringify({results:data.probes.slice(i,i+ANCHOR_PAGE_SIZE),next:i+ANCHOR_PAGE_SIZE<data.probes.length?'next':null}));
const now=Math.max(...Object.values(data.all).flat().map(r=>r.timestamp*1000));
const request=()=>new Request('https://benchmark.invalid/api/internet/dns-flows');
const assets={fetch:async()=>{throw Error('Unexpected ASSETS request');}};
const edge={match:async()=>undefined,put:async(_key,response)=>{await response.arrayBuffer();}};
for(const size of sizes){
 const sample=selectProbes(data.probes,size),ids=new Set(sample.map(p=>p.id)),points=new Map(sample.map(p=>[p.id,p.position]));
 const results=Object.fromEntries(Object.entries(data.all).map(([l,rows])=>[l,rows.filter(r=>ids.has(r.prb_id))]));
 const snapshot=buildSnapshot(results,points,roots,now);
 if(parseDnsFlowSnapshot(snapshot).flows.length!==snapshot.flows.length)throw Error('Dropped flow');
 const measurementBodies=new Map(Object.entries(DNS_MEASUREMENTS).map(([l,id])=>[id,JSON.stringify(results[l])]));
 let calls=0,cacheReads=0,cacheWrites=0;
 const network=async url=>{
  calls++;const u=new URL(url);
  if(u.hostname==='root-servers.org')return new Response(rootBodies[u.pathname.split('/')[2].toLowerCase()]);
  if(u.pathname.includes('/probes/'))return new Response(anchorBodies[Number(u.searchParams.get('page'))-1]);
  return new Response(measurementBodies.get(Number(u.pathname.split('/')[4])));
 };
 const countedEdge={match:async(...a)=>{cacheReads++;return edge.match(...a);},put:async(...a)=>{cacheWrites++;return edge.put(...a);}};
 const iterations=100;
 // Warm V8 separately, then measure a complete cold-cache handler each iteration.
 for(let n=0;n<10;n++)await(await createDnsFlowsHandler(network,()=>now,countedEdge,async()=>{},size)(request(),assets)).arrayBuffer();
 const start=process.threadCpuUsage(),proc=process.cpuUsage(),wall=performance.now();
 for(let n=0;n<iterations;n++){
  const response=await createDnsFlowsHandler(network,()=>now,countedEdge,async()=>{},size)(request(),assets);
  if(response.status!==200)throw Error('Cold replay failed');await response.arrayBuffer();
 }
 const thread=process.threadCpuUsage(start),processTime=process.cpuUsage(proc);
 const cold={threadMs:(thread.user+thread.system)/1000/iterations,processMs:(processTime.user+processTime.system)/1000/iterations,wallMs:(performance.now()-wall)/iterations};
 const byLetter=Object.fromEntries(Object.keys(DNS_MEASUREMENTS).map(l=>{const s=buildSnapshot({[l]:results[l]},points,roots,now);return[l,`${s.matched}/${s.examined}`];}));
 const totalCalls=110;
 console.log(JSON.stringify({size:sample.length,countries:new Set(sample.map(p=>p.country)).size,continents:Object.fromEntries(['AF','AS','EU','NA','SA','OC'].map(c=>[c,sample.filter(p=>probeContinent(p.country)===c).length])),flows:snapshot.flows.length,byLetter,cold,coldHttp:calls/totalCalls,coldCacheReads:cacheReads/totalCalls,coldCacheWrites:cacheWrites/totalCalls,coldTotal:(calls+cacheReads+cacheWrites)/totalCalls,normalRefreshTotal:14,rootRefreshTotal:28,maxResultBytes:Math.max(...[...measurementBodies.values()].map(s=>Buffer.byteLength(s))),totalResultBytes:[...measurementBodies.values()].reduce((n,s)=>n+Buffer.byteLength(s),0),maxUrlChars:`https://atlas.ripe.net/api/v2/measurements/10309/latest/?probe_ids=${sample.map(p=>p.id).join(',')}`.length,anchorPages:anchorBodies.length,anchorBytes:anchorBodies.reduce((n,s)=>n+Buffer.byteLength(s),0)}));
}
