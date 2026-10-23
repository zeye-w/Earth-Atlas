import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectProbes,probeContinent,PROBE_LIMIT} from '../worker/ripeAtlas/probes.ts';
import {ROOT_LETTERS} from '../src/internet/types.ts';
import {DNS_MEASUREMENTS,identifierParsers,matchInstance,buildSnapshot,parseALocation,parseJLocation,parseE} from '../src/internet/dnsFlows.ts';
import {parseDnsFlowSnapshot} from '../src/internet/data.ts';
import {parseRootSites} from '../worker/ripeAtlas/roots.ts';
import {createDnsFlowsHandler} from '../worker/ripeAtlas.ts';
const fixtures=Object.fromEntries(ROOT_LETTERS.map(l=>[l,JSON.parse(readFileSync(new URL(`./fixtures/ripe-atlas/${l}.json`,import.meta.url)))]));
const rootFixtures=Object.fromEntries(ROOT_LETTERS.map(l=>[l,JSON.parse(readFileSync(new URL(`./fixtures/ripe-atlas/roots/${l}.json`,import.meta.url)))]));
const syntheticRoots=ROOT_LETTERS.flatMap(l=>parseRootSites(l,rootFixtures[l]));
const probeFixture=JSON.parse(readFileSync(new URL('./fixtures/ripe-atlas/probes.json',import.meta.url)));
const syntheticResult=l=>({...fixtures[l][0],result:{...fixtures[l][0].result,answers:[{TYPE:'TXT',NAME:'hostname.bind',RDATA:rootFixtures[l].Sites[0].Identifiers}]}});
const identifiers=r=>r.result.answers.flatMap(a=>a.RDATA);
const expectedCodes={a:'lon',b:'fra',c:'fra',d:'amnl',e:'ams',f:'ams',g:null,h:'lcy',i:'amx',j:'elgva',k:'ams',l:'ham',m:'ory'};
const instance=(letter,id,values=[],city='')=>({letter,id,identifiers:values,city,position:[4.9,52.37],country:null,scope:null});
for(const l of ROOT_LETTERS)test(`${l}: recorded TXT response parsing and exact matching`,()=>{
 const r=fixtures[l][0],values=identifiers(r);
 assert.equal(r.af,4);assert.equal(r.msm_id,DNS_MEASUREMENTS[l]);
 assert.equal(identifierParsers[l](values[0]),expectedCodes[l]);
 const sites=parseRootSites(l,rootFixtures[l]);
 const root=sites.find(s=>s.identifiers.length)??sites[0];
 if(root.identifiers.length)assert.equal(matchInstance(l,root.identifiers,sites)?.id,root.id);
 assert.equal(matchInstance(l,['unrecognized'],[root]),null);
 if(root.identifiers.length)assert.equal(matchInstance(l,root.identifiers,[root,{...root,id:'ambiguous'}]),null);
});
test('unique city fallback, explicit globs, different letters, ambiguity',()=>{
 const k=instance('k','ams',[],'Amsterdam');
 assert.equal(matchInstance('k',['ns2.nl-ams.k.ripe.net'],[k])?.id,'ams');
 assert.equal(matchInstance('k',['ns2.nl-ams.k.ripe.net'],[k,{...k,id:'second'}]),null);
 assert.equal(matchInstance('f',['ns2.nl-ams.k.ripe.net'],[k]),null);
 assert.equal(matchInstance('k',['ns2.nl-ams.k.ripe.net'],[instance('k','glob',['ns*.nl-ams.k.ripe.net'])])?.id,'glob');
 assert.equal(matchInstance('g',['groot-eur1-2'],[instance('g','region',[],'London')]),null);
});
test('synthetic root matching output survives the frontend parser without dropping any flow',()=>{
 const results=Object.fromEntries(ROOT_LETTERS.map(l=>[l,[syntheticResult(l)]]));
 const roots=syntheticRoots;
 const points=new Map(ROOT_LETTERS.map(l=>[fixtures[l][0].prb_id,[1,2]]));
 const now=Math.max(...ROOT_LETTERS.map(l=>fixtures[l][0].timestamp*1000));
 const s=buildSnapshot(results,points,roots,now);
 assert.equal(s.examined,13);assert.ok(s.matched>0);assert.equal(s.flows.length,s.matched);
 assert.deepEqual(parseDnsFlowSnapshot(s),s);
 const invalid={...fixtures.k[0],timestamp:1};
 assert.equal(buildSnapshot({k:[invalid]},points,roots,now).matched,0);
 assert.equal(buildSnapshot({k:[{...fixtures.k[0],result:{rt:0}}]},points,roots,now).matched,0);
});
function harness(){
 let now=Math.max(...ROOT_LETTERS.map(l=>fixtures[l][0].timestamp*1000)),fail=false,rootFail=false,calls=0,rootCalls=0;

 const network=async(url,options)=>{
 calls++;assert.equal(options.headers['User-Agent'],'Earth-Atlas (+https://github.com/zeye-w/Earth-Atlas)');
 if(url.startsWith('https://root-servers.org/')){rootCalls++;return rootFail?new Response('',{status:502}):Response.json(rootFixtures[url.match(/root\/([A-M])/)[1].toLowerCase()]);}
 if(fail)return new Response('',{status:502});
 if(url.includes('/probes/'))return Response.json({results:probeFixture.map(p=>({...p,is_public:true,is_anchor:true,country_code:'NL',status:{id:1}})),next:null});
 const id=Number(url.match(/measurements\/(\d+)/)[1]);
 assert.ok(new URL(url).searchParams.get('probe_ids'));
 const l=ROOT_LETTERS.find(l=>DNS_MEASUREMENTS[l]===id);
 return Response.json([syntheticResult(l)]);
 };
 const assets={fetch:async()=>{throw Error('ASSETS must never be called');}};
 const cacheValues=new Map();const edge={match:async r=>cacheValues.get(r.url)?.clone(),put:async(r,v)=>cacheValues.set(r.url,v.clone())};
 return {network,assets,edge,clock:()=>now,advance:n=>now+=n,fail:()=>fail=true,calls:()=>calls,rootCalls:()=>rootCalls,rootFail:()=>rootFail=true};
}
const request=()=>new Request('https://earth.example/api/internet/dns-flows');
test('single flight, memory cache, edge reuse, five-minute fallback and 503',async()=>{
 const h=harness(),handler=createDnsFlowsHandler(h.network,h.clock,h.edge,async()=>{});
 const responses=await Promise.all([handler(request(),h.assets),handler(request(),h.assets)]);
 assert.equal(responses[0].status,200);assert.equal(h.calls(),27);
 const s=await responses[0].json();assert.ok(s.flows.length);assert.equal(parseDnsFlowSnapshot(s).flows.length,s.flows.length);
 await handler(request(),h.assets);assert.equal(h.calls(),27);
 const fresh=createDnsFlowsHandler(h.network,h.clock,h.edge);assert.equal((await fresh(request(),h.assets)).status,200);assert.equal(h.calls(),27);
 h.advance(241000);h.fail();assert.equal((await handler(request(),h.assets)).status,200);
 h.advance(60000);assert.equal((await handler(request(),h.assets)).status,503);
 assert.equal((await createDnsFlowsHandler(h.network,h.clock,undefined,async()=>{})(request(),h.assets)).status,503);
});
test('missing roots and unsupported method',async()=>{
 const h=harness();h.rootFail();const handler=createDnsFlowsHandler(h.network,h.clock,undefined,async()=>{});
 assert.equal((await handler(request(),h.assets)).status,503);
 const calls=h.calls();assert.equal((await handler(new Request(request(),{method:'POST'}),h.assets)).status,405);assert.equal(h.calls(),calls);
});
test('synthetic root fields, inactive and invalid sites, literal I site identifiers',()=>{
 for(const l of ROOT_LETTERS){const sites=parseRootSites(l,rootFixtures[l]);assert.ok(sites.length);for(const site of sites){assert.ok(site.id.startsWith(l+'-'));assert.ok(site.identifiers.every(id=>rootFixtures[l].Sites.some(s=>s.Identifiers?.includes(id))));}}
 const sample=rootFixtures.b.Sites[0];
 assert.throws(()=>parseRootSites('b',{Sites:[{...sample,Status:'suspended'}]}));
 assert.throws(()=>parseRootSites('b',{Sites:[{...sample,Longitude:181}]}));
 assert.throws(()=>parseRootSites('b',{Sites:[{...sample,Latitude:null}]}));
 assert.throws(()=>parseRootSites('b',{Sites:[sample,sample]}));
 const i=syntheticRoots.find(s=>s.letter==='i'&&s.identifiers.includes('qzx'));
 assert.ok(i);assert.equal(matchInstance('i',['s1.qzx'],syntheticRoots)?.id,i.id);
 assert.equal(matchInstance('i',['s1.unknown'],syntheticRoots),null);
});
test('root memory and edge cache survive outage only before 24-hour expiry',async()=>{
 const h=harness(),handler=createDnsFlowsHandler(h.network,h.clock,h.edge,async()=>{});
 assert.equal((await handler(request(),h.assets)).status,200);assert.equal(h.rootCalls(),13);
 h.rootFail();h.advance(241000);
 // Reset observation age using recorded replies, so this tests roots rather than DNS expiry.
 const shifted=async(url,options)=>{const r=await h.network(url,options);if(!url.includes('/measurements/')||!r.ok)return r;const data=await r.json();return Response.json(data.map(v=>({...v,timestamp:h.clock()/1000})));};
 const fresh=createDnsFlowsHandler(shifted,h.clock,h.edge,async()=>{});
 assert.equal((await fresh(request(),h.assets)).status,200);assert.equal(h.rootCalls(),13);
 h.advance(23*3600000);
 const jobs=[];const ctx={waitUntil:p=>jobs.push(p)};
 assert.equal((await fresh(request(),h.assets,ctx)).status,200);await Promise.all(jobs);assert.equal(h.rootCalls(),14);
 h.advance(3600000);
 assert.equal((await fresh(request(),h.assets)).status,503);
 assert.equal((await createDnsFlowsHandler(shifted,h.clock,h.edge,async()=>{})(request(),h.assets)).status,503);
});

test('23h roots return before background completion, coalesce refreshes and publish renewal', {timeout:3000}, async()=>{
 const h=harness();let gated=false,release;
 const gate=new Promise(resolve=>release=resolve);
 const jobs=[];const ctx={waitUntil:p=>jobs.push(p)};
 const network=async(url,options)=>{
  if(gated&&url.startsWith('https://root-servers.org/'))await gate;
  const response=await h.network(url,options);
  if(!url.includes('/measurements/')||!response.ok)return response;
  return Response.json((await response.json()).map(r=>({...r,timestamp:h.clock()/1000})));
 };
 const handler=createDnsFlowsHandler(network,h.clock,h.edge,async()=>{});
 assert.equal((await handler(request(),h.assets)).status,200);
 h.advance(23*3600000);gated=true;
 assert.equal((await handler(request(),h.assets,ctx)).status,200);
 assert.equal(jobs.length,1);assert.equal(h.rootCalls(),13);
 h.advance(241000);
 assert.equal((await handler(request(),h.assets,ctx)).status,200);
 assert.equal(jobs.length,2);assert.equal(h.rootCalls(),13);
 release();await Promise.all(jobs);assert.equal(h.rootCalls(),26);
 h.advance(241000);
 assert.equal((await handler(request(),h.assets,ctx)).status,200);
 assert.equal(h.rootCalls(),26);assert.equal(jobs.length,2);
});
test('23h roots without waitUntil remain available without starting unmanaged work',async()=>{
 const h=harness();const shifted=async(url,options)=>{
  const r=await h.network(url,options);if(!url.includes('/measurements/')||!r.ok)return r;
  return Response.json((await r.json()).map(v=>({...v,timestamp:h.clock()/1000})));
 };
 const handler=createDnsFlowsHandler(shifted,h.clock,h.edge,async()=>{});
 assert.equal((await handler(request(),h.assets)).status,200);
 h.advance(23*3600000);h.rootFail();
 assert.equal((await handler(request(),h.assets)).status,200);assert.equal(h.rootCalls(),13);
 h.advance(3600000);
 assert.equal((await handler(request(),h.assets)).status,503);assert.equal(h.rootCalls(),14);
});

test('global sampler is permutation-stable, country/continent diverse, bounded and validates anchors',()=>{
 const nations={AF:['AO','BF','CM','GH','KE','TZ','ZA','UG'],AS:['AE','IN','JP','SG','TH','VN','ID','IL'],EU:['DE','FR','NL','GB','PL','RO','UA','SE'],NA:['US','CA','MX','CR','PA','DO','GT','TT'],SA:['AR','BR','CL','CO','EC','PE','UY','VE'],OC:['AU','NZ','FJ','FM','GU','NC','PW','TV']};
 let id=1;const rows=[];
 for(const countries of Object.values(nations))for(const country_code of countries)for(const lon of[-130,-20,100])rows.push({id:id++,country_code,is_public:true,is_anchor:true,status:{id:1},geometry:{coordinates:[lon,20]}});
 const s=selectProbes(rows,48);
 assert.deepEqual(s,selectProbes([...rows].reverse(),48));
 assert.equal(s.length,48);assert.equal(new Set(s.map(p=>p.country)).size,48);assert.equal(new Set(s.map(p=>probeContinent(p.country))).size,6);
 assert.equal(selectProbes(rows,1000).length,144);
 assert.equal(selectProbes([...rows,...rows.map(r=>({...r,id:r.id+1000}))],1000).length,200);assert.equal(selectProbes(rows,-1).length,0);
 const invalid=[{...rows[0],id:900,status:{id:2}},{...rows[0],id:901,is_public:false},{...rows[0],id:902,is_anchor:false},{...rows[0],id:903,geometry:{coordinates:[181,0]}}];
 assert.deepEqual(selectProbes([...rows,...invalid,...rows],48),s);
 const conflict={...rows[0],country_code:'ZZ'};
 assert.deepEqual(selectProbes([...rows,conflict],48),selectProbes([conflict,...rows].reverse(),48));
});
test('grid rounds spread a country across cells before reusing one cell',()=>{
 const row=(id,lon)=>({id,country_code:'AU',is_public:true,is_anchor:true,status:{id:1},geometry:{coordinates:[lon,-20.12345]}});
 const s=selectProbes([row(1,10),row(2,10.1),row(3,80)],3);
 assert.deepEqual(s.map(p=>p.id),[1,3,2]);assert.deepEqual(s[0].position,[10,-20.12]);
});
test('recorded global anchor projection spans six continents with stable bounded sampling',()=>{
 const rows=JSON.parse(readFileSync(new URL('./fixtures/ripe-atlas/global-anchors.json',import.meta.url)));
 const sample=selectProbes(rows);
 assert.equal(sample.length,12);assert.equal(new Set(sample.map(p=>probeContinent(p.country))).size,6);
 assert.deepEqual(selectProbes(rows.reverse()),sample);
});
for(const letter of ['a','j'])test(`${letter}: documented UN/LOCODE matches one official synthetic site, rejects ambiguity and legacy guesses`,()=>{
 const parse=letter==='a'?parseALocation:parseJLocation;
 assert.equal(parse('NNN1-ZZQZX-1a.'),'zz-qzx');assert.equal(parse('rootns-zzqzx-2b'),'zz-qzx');assert.equal(parse('rootns-elgva1'),null);
 const root={...instance(letter,letter+'-fictional',['a1.zz-qzx.root','n1.zz-qzx.root']),country:'ZZ'};
 assert.equal(matchInstance(letter,['nnn1-zzqzx-1a'],[root])?.id,root.id);
 assert.equal(matchInstance(letter,['nnn1-zzqzx-1a'],[root,{...root,id:'another-site'}]),null);
 assert.equal(matchInstance(letter,['rootns-elgva1'],[root]),null);
 assert.equal(matchInstance(letter,['nnn1-zzqzx-1a'],[{...root,country:'AA'}]),null);
});
test('E prefix forms use the same city rule and never select one of several co-located sites',()=>{
 for(const value of ['p06.fra.eroot','c01.FRA.eroot','n01.fra.eroot']){
  assert.equal(parseE(value),'fra');const root=instance('e','fictional-e',[],'Frankfurt');
  assert.equal(matchInstance('e',[value],[root])?.id,root.id);
  assert.equal(matchInstance('e',[value],[root,{...root,id:'second-e'}]),null);
 }
 assert.equal(matchInstance('e',['c01.XYZ.eroot'],[instance('e','unknown')]),null);
});
test('real global DNS recordings survive the output parser without losing flows',()=>{
 const results=Object.fromEntries(ROOT_LETTERS.map(l=>[l,JSON.parse(readFileSync(new URL(`./fixtures/ripe-atlas/coverage-${l}.json`,import.meta.url)))]));
 // Explicitly synthetic sites/probe positions isolate output validation from real root redistribution.
 const roots=ROOT_LETTERS.map(l=>instance(l,'synthetic-'+l,identifiers(results[l][0])));
 const first=Object.fromEntries(ROOT_LETTERS.map(l=>[l,[results[l][0]]]));
 const points=new Map(ROOT_LETTERS.map(l=>[results[l][0].prb_id,[1,2]]));
 const now=Math.max(...Object.values(first).flat().map(r=>r.timestamp*1000));
 const snapshot=buildSnapshot(first,points,roots,now);
 assert.equal(snapshot.flows.length,13);assert.deepEqual(parseDnsFlowSnapshot(snapshot),snapshot);
});
test('anchor pagination is bounded and old probe-cache keys are not reused',async()=>{
 const h=harness();let pages=0;
 const network=async(url,options)=>{
  if(url.includes('/probes/')){pages++;assert.ok(url.includes('is_anchor=true'));assert.ok(url.includes('fields='));return Response.json({results:[],next:'https://untrusted.invalid/next'});}
  return h.network(url,options);
 };
 const keys=[];const edge={...h.edge,match:async r=>{keys.push(r.url);return h.edge.match(r);}};
 const r=await createDnsFlowsHandler(network,h.clock,edge,async()=>{})(request(),h.assets);
 assert.equal(r.status,503);assert.equal(pages,4);
 assert.ok(keys.some(k=>k.endsWith('/probes-v3')));assert.ok(keys.every(k=>!k.endsWith('/probes-v2')));
});

test('bounded upstream decoding preserves UTF-8 split across chunks',async()=>{
 const h=harness();const network=async(url,options)=>{
  if(!url.endsWith('/root/A/json/'))return h.network(url,options);
  const raw=structuredClone(rootFixtures.a);raw.Sites[0].Town='试验城市';
  const encoded=new TextEncoder().encode(JSON.stringify(raw));const first=encoded.indexOf(0xe8);
  return new Response(new ReadableStream({start(c){c.enqueue(encoded.subarray(0,first+1));c.enqueue(encoded.subarray(first+1));c.close();}}));
 };
 assert.equal((await createDnsFlowsHandler(network,h.clock,h.edge,async()=>{})(request(),h.assets)).status,200);
 const cache=await h.edge.match(new Request('https://earth.example/__atlas-cache/root-sites-v2'));
 assert.equal((await cache.json()).instances.find(i=>i.letter==='a').city,'试验城市');
});
test('oversized upstream bodies remain rejected before JSON parsing',async()=>{
 const handler=createDnsFlowsHandler(async()=>new Response(' '.repeat(1500001)),Date.now,undefined,async()=>{});
 assert.equal((await handler(request())).status,503);
});
