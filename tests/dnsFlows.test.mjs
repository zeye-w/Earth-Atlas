import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ROOT_LETTERS} from '../src/internet/types.ts';
import {DNS_MEASUREMENTS,identifierParsers,matchInstance,buildSnapshot} from '../src/internet/dnsFlows.ts';
import {parseDnsFlowSnapshot} from '../src/internet/data.ts';
import {createDnsFlowsHandler} from '../worker/ripeAtlas.ts';
const fixtures=Object.fromEntries(ROOT_LETTERS.map(l=>[l,JSON.parse(readFileSync(new URL(`./fixtures/ripe-atlas/${l}.json`,import.meta.url)))]));
const probeFixture=JSON.parse(readFileSync(new URL('./fixtures/ripe-atlas/probes.json',import.meta.url)));
const identifiers=r=>r.result.answers.flatMap(a=>a.RDATA);
const expectedCodes={a:'lon',b:'fra',c:'fra',d:'amnl',e:'ams',f:'ams',g:null,h:'lcy',i:'amx',j:'elgva',k:'ams',l:'ham',m:'ory'};
const instance=(letter,id,values=[],city='')=>({letter,id,identifiers:values,city,position:[4.9,52.37],country:null,scope:null});
for(const l of ROOT_LETTERS)test(`${l}: recorded TXT response parsing and exact matching`,()=>{
 const r=fixtures[l][0],values=identifiers(r);
 assert.equal(r.af,4);assert.equal(r.msm_id,DNS_MEASUREMENTS[l]);
 assert.equal(identifierParsers[l](values[0]),expectedCodes[l]);
 const root=instance(l,l+'-test',values);
 assert.equal(matchInstance(l,values,[root])?.id,root.id);
 assert.equal(matchInstance(l,['unrecognized'],[root]),null);
 assert.equal(matchInstance(l,values,[root,{...root,id:'ambiguous'}]),null);
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
 const roots=ROOT_LETTERS.map(l=>instance(l,l,identifiers(fixtures[l][0])));
 const points=new Map(ROOT_LETTERS.map(l=>[fixtures[l][0].prb_id,[1,2]]));
 const now=Math.max(...ROOT_LETTERS.map(l=>fixtures[l][0].timestamp*1000));
 const s=buildSnapshot(results,points,roots,now);
 assert.equal(s.examined,13);assert.equal(s.matched,13);assert.equal(s.flows.length,13);
 assert.deepEqual(parseDnsFlowSnapshot(s),s);
 const invalid={...fixtures.k[0],timestamp:1};
 assert.equal(buildSnapshot({k:[invalid]},points,roots,now).matched,0);
 assert.equal(buildSnapshot({k:[{...fixtures.k[0],result:{rt:0}}]},points,roots,now).matched,0);
});
function harness(){
 let now=Math.max(...ROOT_LETTERS.map(l=>fixtures[l][0].timestamp*1000)),fail=false,calls=0;
 const roots=ROOT_LETTERS.map(l=>instance(l,l,identifiers(fixtures[l][0])));
 const network=async(url,options)=>{
 calls++;assert.equal(options.headers['User-Agent'],'Earth-Atlas (+https://github.com/zeye-w/Earth-Atlas)');
 if(fail)return new Response('',{status:502});
 if(url.includes('/probes/'))return Response.json({results:probeFixture});
 const id=Number(url.match(/measurements\/(\d+)/)[1]);
 assert.ok(new URL(url).searchParams.get('probe_ids'));
 const l=ROOT_LETTERS.find(l=>DNS_MEASUREMENTS[l]===id);
 return Response.json([fixtures[l][0]]);
 };
 const assets={fetch:async()=>Response.json({version:1,instances:roots})};
 const cacheValues=new Map();const edge={match:async r=>cacheValues.get(r.url)?.clone(),put:async(r,v)=>cacheValues.set(r.url,v.clone())};
 return {network,assets,edge,clock:()=>now,advance:n=>now+=n,fail:()=>fail=true,calls:()=>calls};
}
const request=()=>new Request('https://earth.example/api/internet/dns-flows');
test('single flight, memory cache, edge reuse, five-minute fallback and 503',async()=>{
 const h=harness(),handler=createDnsFlowsHandler(h.network,h.clock,h.edge);
 const responses=await Promise.all([handler(request(),h.assets),handler(request(),h.assets)]);
 assert.equal(responses[0].status,200);assert.equal(h.calls(),21);
 const s=await responses[0].json();assert.ok(s.flows.length);assert.equal(parseDnsFlowSnapshot(s).flows.length,s.flows.length);
 await handler(request(),h.assets);assert.equal(h.calls(),21);
 const fresh=createDnsFlowsHandler(h.network,h.clock,h.edge);assert.equal((await fresh(request(),h.assets)).status,200);assert.equal(h.calls(),21);
 h.advance(241000);h.fail();assert.equal((await handler(request(),h.assets)).status,200);
 h.advance(60000);assert.equal((await handler(request(),h.assets)).status,503);
 assert.equal((await createDnsFlowsHandler(h.network,h.clock)(request(),h.assets)).status,503);
});
test('missing roots and unsupported method fail without upstream traffic',async()=>{
 const h=harness(),handler=createDnsFlowsHandler(h.network,h.clock);
 assert.equal((await handler(request(),{fetch:async()=>new Response('',{status:404})})).status,503);
 assert.equal((await handler(new Request(request(),{method:'POST'}),h.assets)).status,405);
 assert.equal(h.calls(),0);
});
