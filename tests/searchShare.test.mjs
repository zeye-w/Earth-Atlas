import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYER_KEYS, readScene, sceneHash } from '../src/sceneState.ts';
import { coordinateSearch, localSearch, searchPlaces } from '../src/placeSearch.ts';
const scene = {v:1,camera:[116,39,1800000,0.3,-1.2,0],layers:Object.fromEntries(LAYER_KEYS.map(k=>[k,k==='clouds'])),point:{latitude:39.9,longitude:116.4},options:{cloudOpacity:45,opacity:75,mapMode:'age',ageFilter:'mesozoic',rockFilter:'all',quakeRange:'day'}};
test('scene round trip preserves camera, all disabled layers, filters and point',()=>assert.deepEqual(readScene(sceneHash(scene)),scene));
test('optional atmosphere shell scale round-trips and is validated',()=>{
  const withShells={...scene,options:{...scene.options,atmosphereShells:5}};
  assert.deepEqual(readScene(sceneHash(withShells)),withShells);
  assert.equal(readScene('#scene='+encodeURIComponent(JSON.stringify({...scene,options:{...scene.options,atmosphereShells:7}}))),null);
});
test('optional geographic labels flag round-trips and is validated',()=>{
  const withLabels={...scene,layers:{...scene.layers,geoLabels:true}};
  assert.deepEqual(readScene(sceneHash(withLabels)),withLabels);
  assert.equal(readScene('#scene='+encodeURIComponent(JSON.stringify({...scene,layers:{...scene.layers,geoLabels:'yes'}}))),null);
});
test('optional timeline moment and true-colour layer round-trip and are validated',()=>{
  const withTime={...scene,time:Date.UTC(2026,9,18,6),layers:{...scene.layers,trueColor:true}};
  assert.deepEqual(readScene(sceneHash(withTime)),withTime);
  assert.equal(readScene('#scene='+encodeURIComponent(JSON.stringify({...scene,time:'yesterday'}))),null);
  assert.equal(readScene('#scene='+encodeURIComponent(JSON.stringify({...scene,layers:{...scene.layers,trueColor:1}}))),null);
});
test('invalid or unsupported scene falls back without throwing',()=>{
  for(const hash of ['','#scene=garbage','#scene=null','#scene='+encodeURIComponent(JSON.stringify({...scene,v:2})),'#scene='+encodeURIComponent(JSON.stringify({...scene,camera:[0,91,1,0,0,0]})),'#scene='+encodeURIComponent(JSON.stringify({...scene,layers:{}})),'#scene='+encodeURIComponent(JSON.stringify({...scene,options:{...scene.options,opacity:900}}))]) assert.equal(readScene(hash),null);
});
test('latitude-first coordinates accept Chinese commas and validate ranges',()=>{
  assert.equal(coordinateSearch('39.9，116.4').longitude,116.4);
  assert.equal(coordinateSearch('-90, -180').latitude,-90);
  assert.throws(()=>coordinateSearch('91, 20'));
  assert.throws(()=>coordinateSearch('20, 181'));
  assert.equal(coordinateSearch('Paris'),null);
});
test('countries and cities resolve locally in Chinese and English',()=>{
  assert.ok(localSearch('中国').some(p=>p.id==='country:CN'));
  assert.ok(localSearch('France').some(p=>p.id==='country:FR'));
  assert.ok(localSearch('北京').some(p=>p.id==='beijing'));
});
test('city API is validated and duplicate local results removed',async()=>{
  const original = globalThis.fetch;
  globalThis.fetch = async()=>new Response(JSON.stringify({results:[{id:1,name:'Test',latitude:12,longitude:13,country:'Example'},{id:2,name:'Invalid',latitude:200,longitude:20}]}));
  try { const results=await searchPlaces('Test',new AbortController().signal); assert.equal(results.length,1); assert.equal(results[0].name,'Test'); }
  finally { globalThis.fetch=original; }
});
