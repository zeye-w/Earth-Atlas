import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {sha256,treeHash,reusableFrame,atomicJson} from "../video/cinematic/checkpoint.mjs";
test("resume rejects partial, modified, missing and unsettled frame files",()=>{
 const dir=mkdtempSync(join(tmpdir(),"cine-checkpoint-"));
 try {
  const bytes=Buffer.from([255,216,1,2,255,217]);
  const entry={file:"0001.jpg",settled:true,sha256:sha256(bytes)};
  assert.equal(reusableFrame(entry,dir),false);
  writeFileSync(join(dir,entry.file),bytes);
  assert.equal(reusableFrame(entry,dir),true);
  assert.equal(reusableFrame({...entry,settled:false},dir),false);
  writeFileSync(join(dir,entry.file),Buffer.from([255,216,8,9,255,217]));
  assert.equal(reusableFrame(entry,dir),false);
  writeFileSync(join(dir,entry.file),bytes.subarray(0,4));
  assert.equal(reusableFrame({...entry,sha256:sha256(bytes.subarray(0,4))},dir),false);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test("checkpoint replaces atomically and fingerprints snapshot changes",()=>{
 const dir=mkdtempSync(join(tmpdir(),"cine-inputs-"));
 try {
  atomicJson(join(dir,"plan.json"),{T0:1});const first=treeHash(dir);
  atomicJson(join(dir,"plan.json"),{T0:1});assert.equal(treeHash(dir),first);
  atomicJson(join(dir,"plan.json"),{T0:2});assert.notEqual(treeHash(dir),first);
  assert.equal(JSON.parse(readFileSync(join(dir,"plan.json"))).T0,2);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
