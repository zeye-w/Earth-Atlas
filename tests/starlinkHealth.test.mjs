import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStarlink } from '../scripts/starlink-health.mjs';
const now = Date.parse('2026-11-20T12:00:00Z');
const header='OBJECT_NAME,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT';
const csv=(epoch='2026-11-20T11:00:00')=>header+'\n'+Array.from({length:1000},(_,i)=>`TEST-${i},${epoch},15,0.001,53,0,0,0,0,${90000+i},1,1,0,0,0`).join('\n');
test('nearby scheduler ticks reuse validated download without a network request',async()=>{
 let saved, requests=0;
 const options={now,read:()=>saved,write:v=>{saved=v;},request:async()=>{requests++;return new Response(csv());}};
 assert.match(await checkStarlink(options),/fresh download/);
 assert.match(await checkStarlink({...options,now:now+15*60000}),/validated cache/);
 assert.equal(requests,1);
});
test('expired cache does not hide HTTP 403 and is not replaced',async()=>{
 await assert.rejects(checkStarlink({now,read:()=>({at:now-7200000,text:csv()}),write:()=>{},request:async()=>new Response('Denied',{status:403})}),/HTTP 403/);
});
test('corrupt and future-dated cache cannot produce a pass',async()=>{
 for(const value of [{at:now,text:'bad'},{at:now+1,text:csv()}])
 await assert.rejects(checkStarlink({now,read:()=>value,write:()=>{},request:async()=>new Response('Denied',{status:403})}),/403/);
});
test('old elements and HTML error pages are rejected even with HTTP 200',async()=>{
 for(const text of [csv('2026-10-01T00:00:00'),'<html>Error</html>'])
 await assert.rejects(checkStarlink({now,read:()=>null,write:()=>{},request:async()=>new Response(text)}));
});

test('a denied download is not repeated by the other scheduler', async()=>{
 let stored, requests=0;
 const options={now,read:()=>stored,write:v=>{stored=v;},request:async()=>{requests++;return new Response('Denied',{status:403});}};
 await assert.rejects(checkStarlink(options),/403/);
 await assert.rejects(checkStarlink({...options,now:now+15*60000}),/cooldown/);
 assert.equal(requests,1);
});
