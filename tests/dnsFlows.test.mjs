import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ROOT_LETTERS} from '../src/internet/types.ts';
import {DNS_MEASUREMENTS,identifierParsers,matchInstance,buildSnapshot} from '../src/internet/dnsFlows.ts';
import {parseDnsFlowSnapshot} from '../src/internet/data.ts';
import {parseRootSites} from '../worker/ripeAtlas/roots.ts';
import {createDnsFlowsHandler} from '../worker/ripeAtlas.ts';
const fixtures=Object.fromEntries(ROOT_LETTERS.map(l=>[l,JSON.parse(readFileSync(new URL(`./fixtures/ripe-atlas/${l}.json`,import.meta.url)))]));
const rootFixtures=Object.fromEntries(ROOT_LETTERS.map(l=>[l,JSON.parse(readFileSync(new URL(`./fixtures/ripe-atlas/roots/${l}.json`,import.meta.url)))]));
const recordedRoots=ROOT_LETTERS.flatMap(l=>parseRootSites(l,rootFixtures[l]));
const probeFixture=JSON.parse(readFileSync(new URL('./fixtures/ripe-atlas/probes.json',import.meta.url)));
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
test('recorded output survives the frontend parser without dropping any flow',()=>{
 const results=Object.fromEntries(ROOT_LETTERS.map(l=>[l,[fixtures[l][0]]]));
 const roots=recordedRoots;
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
 const roots=ROOT_LETTERS.map(l=>instance(l,l,identifiers(fixtures[l][0])));
 const network=async(url,options)=>{
 calls++;assert.equal(options.headers['User-Agent'],'Earth-Atlas (+https://github.com/zeye-w/Earth-Atlas)');
 if(url.startsWith('https://root-servers.org/')){rootCalls++;return rootFail?new Response('',{status:502}):Response.json(rootFixtures[url.match(/root\/([A-M])/)[1].toLowerCase()]);}
 if(fail)return new Response('',{status:502});
 if(url.includes('/probes/'))return Response.json({results:probeFixture.filter((_,i)=>i%8===['US','BR','ZA','DE','IN','JP','AU','NL'].indexOf(new URL(url).searchParams.get('country_code')))});
 const id=Number(url.match(/measurements\/(\d+)/)[1]);
 assert.ok(new URL(url).searchParams.get('probe_ids'));
 const l=ROOT_LETTERS.find(l=>DNS_MEASUREMENTS[l]===id);
 return Response.json([fixtures[l][0]]);
 };
 const assets={fetch:async()=>{throw Error('ASSETS must never be called');}};
 const cacheValues=new Map();const edge={match:async r=>cacheValues.get(r.url)?.clone(),put:async(r,v)=>cacheValues.set(r.url,v.clone())};
 return {network,assets,edge,clock:()=>now,advance:n=>now+=n,fail:()=>fail=true,calls:()=>calls,rootCalls:()=>rootCalls,rootFail:()=>rootFail=true};
}
const request=()=>new Request('https://earth.example/api/internet/dns-flows');
test('single flight, memory cache, edge reuse, five-minute fallback and 503',async()=>{
 const h=harness(),handler=createDnsFlowsHandler(h.network,h.clock,h.edge,async()=>{});
 const responses=await Promise.all([handler(request(),h.assets),handler(request(),h.assets)]);
 assert.equal(responses[0].status,200);assert.equal(h.calls(),34);
 const s=await responses[0].json();assert.ok(s.flows.length);assert.equal(parseDnsFlowSnapshot(s).flows.length,s.flows.length);
 await handler(request(),h.assets);assert.equal(h.calls(),34);
 const fresh=createDnsFlowsHandler(h.network,h.clock,h.edge);assert.equal((await fresh(request(),h.assets)).status,200);assert.equal(h.calls(),34);
 h.advance(241000);h.fail();assert.equal((await handler(request(),h.assets)).status,200);
 h.advance(60000);assert.equal((await handler(request(),h.assets)).status,503);
 assert.equal((await createDnsFlowsHandler(h.network,h.clock,undefined,async()=>{})(request(),h.assets)).status,503);
});
test('missing roots and unsupported method',async()=>{
 const h=harness();h.rootFail();const handler=createDnsFlowsHandler(h.network,h.clock,undefined,async()=>{});
 assert.equal((await handler(request(),h.assets)).status,503);
 const calls=h.calls();assert.equal((await handler(new Request(request(),{method:'POST'}),h.assets)).status,405);assert.equal(h.calls(),calls);
});
test('recorded root fields, inactive and invalid sites, literal I site identifiers',()=>{
 for(const l of ROOT_LETTERS){const sites=parseRootSites(l,rootFixtures[l]);assert.ok(sites.length);for(const site of sites){assert.ok(site.id.startsWith(l+'-'));assert.ok(site.identifiers.every(id=>rootFixtures[l].Sites.some(s=>s.Identifiers?.includes(id))));}}
 const sample=rootFixtures.b.Sites[0];
 assert.throws(()=>parseRootSites('b',{Sites:[{...sample,Status:'suspended'}]}));
 assert.throws(()=>parseRootSites('b',{Sites:[{...sample,Longitude:181}]}));
 assert.throws(()=>parseRootSites('b',{Sites:[{...sample,Latitude:null}]}));
 assert.throws(()=>parseRootSites('b',{Sites:[sample,sample]}));
 const i=recordedRoots.find(s=>s.letter==='i'&&s.identifiers.includes('amx'));
 assert.ok(i);assert.equal(matchInstance('i',['s1.amx'],recordedRoots)?.id,i.id);
 assert.equal(matchInstance('i',['s1.unknown'],recordedRoots),null);
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
 assert.equal((await fresh(request(),h.assets)).status,200);assert.equal(h.rootCalls(),14);
 h.advance(3600000);
 assert.equal((await fresh(request(),h.assets)).status,503);
 assert.equal((await createDnsFlowsHandler(shifted,h.clock,h.edge,async()=>{})(request(),h.assets)).status,503);
});
