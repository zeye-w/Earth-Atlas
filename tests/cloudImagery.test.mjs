import test from "node:test";
import assert from "node:assert/strict";
import { Event } from "cesium";
import { CloudImagery } from "../src/cloudImagery.ts";
import { hasPendingWork } from "../src/pendingWork.ts";
function setup(){
 const layers=[];let state;
 const viewer={isDestroyed:()=>false,imageryLayers:{addImageryProvider(provider){const layer={imageryProvider:provider,alpha:1};layers.push(layer);return layer;},remove(layer){const i=layers.indexOf(layer);if(i>=0)layers.splice(i,1);}},scene:{requestRender(){},postRender:new Event(),globe:{tilesLoaded:false}}};
 const manager=new CloudImagery(viewer,s=>{state=s;});
 const ready=()=>{viewer.scene.globe.tilesLoaded=true;viewer.scene.postRender.raiseEvent();viewer.scene.postRender.raiseEvent();};
 const load=(source,key,failed=()=>{})=>manager.load({source,key,time:source==="ssec"?123:null,sensors:source==="nasa"?["test"]:[],maximumLevel:3,tiles:[{url:"https://example.test/{z}/{x}/{y}.png",credit:"test"}]},failed);
 return {manager,viewer,layers,ready,load,state:()=>state};
}
test("fallback stays pending until real tiles settle and keeps error listeners after commit",()=>{
 const s=setup();try{
  s.load("nasa","nasa");assert.equal(s.state().loading,true);assert.equal(hasPendingWork(),true);assert.equal(s.state().source,null);
  s.ready();assert.equal(s.state().source,"nasa");assert.equal(hasPendingWork(),false);
  s.layers[0].imageryProvider.errorEvent.raiseEvent({});assert.equal(s.state().error,true);assert.equal(s.state().source,null);assert.equal(s.layers.length,0);
 }finally{s.manager.dispose();}
});
test("NASA atomically retires retained SSEC, and failed primary recovery keeps NASA",()=>{
 const s=setup();try{
  s.load("ssec","old");s.ready();const old=s.layers[0];
  s.viewer.scene.globe.tilesLoaded=false;s.load("nasa","nasa");assert.equal(s.layers.length,2);assert.equal(s.state().source,"ssec");assert.equal(s.state().time,123);
  s.ready();assert.equal(s.layers.includes(old),false);assert.equal(s.layers.length,1);assert.equal(s.state().time,null);
  const nasa=s.layers[0];s.viewer.scene.globe.tilesLoaded=false;s.load("ssec","recovery");assert.equal(s.layers.includes(nasa),true);assert.equal(s.state().source,"nasa");
  s.layers[1].imageryProvider.errorEvent.raiseEvent({});assert.equal(s.layers.length,1);assert.equal(s.layers[0],nasa);assert.equal(s.state().source,"nasa");assert.equal(s.state().error,false);
  s.load("ssec","recovery-2");s.ready();assert.equal(s.layers.includes(nasa),false);assert.equal(s.state().source,"ssec");assert.equal(s.layers.length,1);
 }finally{s.manager.dispose();}
});
test("failed loading group never becomes ready and disposal releases recording work",()=>{
 const s=setup();try{
  let failed=0;s.load("nasa","broken",()=>failed++);s.layers[0].imageryProvider.errorEvent.raiseEvent({});
  assert.equal(failed,1);assert.equal(s.state().error,true);assert.equal(hasPendingWork(),false);assert.equal(s.layers.length,0);
  s.load("ssec","pending");assert.equal(hasPendingWork(),true);s.manager.clear();assert.equal(hasPendingWork(),false);assert.equal(s.layers.length,0);
 }finally{s.manager.dispose();}
});
