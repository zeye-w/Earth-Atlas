import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {SATELLITE_MODELS,modelInRange} from "../src/satelliteModels.ts";
test("model LOD uses hysteresis and rejects missing or invalid positions",()=>{
 assert.equal(modelInRange(49_000,false),true);assert.equal(modelInRange(60_000,false),false);
 assert.equal(modelInRange(60_000,true),true);assert.equal(modelInRange(76_000,true),false);
 for(const d of [Infinity,NaN,-1])assert.equal(modelInRange(d,true),false);
});
test("delivered models match provenance, stay small and never require external textures",()=>{
 const manifest=JSON.parse(readFileSync(new URL("../public/models/satellites/manifest.json",import.meta.url)));
 assert.deepEqual(manifest.map(m=>m.id).sort(),Object.keys(SATELLITE_MODELS).sort());
 for(const m of manifest){
  const bytes=readFileSync(new URL("../public"+SATELLITE_MODELS[m.id].url,import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),m.sha256);
  assert.ok(bytes.length<3_000_000);assert.equal(bytes.readUInt32LE(8),bytes.length);
  const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  assert.equal(doc.asset.version,"2.0");
  for(const image of doc.images??[])assert.ok(!image.uri && image.bufferView!==undefined);
  for(const buffer of doc.buffers)assert.equal(buffer.uri,undefined);
  assert.equal(doc.scenes[doc.scene??0].nodes.length,1);
 }
 assert.equal(SATELLITE_MODELS.tiangong.schematic,true);
 assert.equal(SATELLITE_MODELS.noaa20,undefined);assert.equal(SATELLITE_MODELS.landsat9,undefined);
});

test("model resources are lazy, wait for GPU readiness, and release outside close-up",async()=>{
 const {Model,Event,Cartesian3,ConstantProperty}=await import("cesium");
 const {SatelliteModelOverlay}=await import("../src/satelliteModelOverlay.ts");
 const {hasPendingWork}=await import("../src/pendingWork.ts");
 const original=Model.fromGltfAsync;let resolve,calls=0,status;
 Model.fromGltfAsync=()=>{calls++;return new Promise(r=>{resolve=r;});};
 const here=new Cartesian3(6_800_000,0,0),ahead=new Cartesian3(6_800_000,10,0);
 const objects=new Set();
 const viewer={isDestroyed:()=>false,camera:{positionWC:new Cartesian3(7_800_000,0,0)},scene:{preRender:new Event(),requestRender(){},primitives:{add(x){objects.add(x);return x;},remove(x){objects.delete(x);x.destroy();}}}};
 const marker={billboard:{show:new ConstantProperty(true)}};
 const overlay=new SatelliteModelOverlay(viewer,s=>{status=s;});
 try{
  overlay.setTarget("iss",marker);overlay.update(here,ahead);assert.equal(calls,0);
  viewer.camera.positionWC=new Cartesian3(6_800_000,0,500);viewer.scene.preRender.raiseEvent();assert.equal(calls,1);assert.equal(hasPendingWork(),true);
  const model={ready:false,readyEvent:new Event(),errorEvent:new Event(),destroy(){this.destroyed=true;}};
  resolve(model);await new Promise(r=>setImmediate(r));assert.equal(status,"loading");assert.equal(marker.billboard.show.getValue(),true);
  model.ready=true;model.readyEvent.raiseEvent();assert.equal(status,"ready");assert.equal(hasPendingWork(),false);assert.equal(marker.billboard.show.getValue(),false);
  viewer.camera.positionWC=new Cartesian3(7_000_000,0,0);viewer.scene.preRender.raiseEvent();assert.equal(objects.size,0);assert.equal(model.destroyed,true);assert.equal(marker.billboard.show.getValue(),true);
  viewer.camera.positionWC=new Cartesian3(6_800_000,0,500);viewer.scene.preRender.raiseEvent();assert.equal(calls,2);
  overlay.setTarget(null);const late={destroy(){this.destroyed=true;}};resolve(late);await new Promise(r=>setImmediate(r));assert.equal(late.destroyed,true);assert.equal(objects.size,0);assert.equal(hasPendingWork(),false);
 }finally{overlay.dispose();Model.fromGltfAsync=original;}
});
