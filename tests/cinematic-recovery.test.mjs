import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedFrames, settleAfterTimeout } from '../video/cinematic/capture-policy.mjs';
import { validateRecoveredFrames } from '../video/cinematic/recover.mjs';

test('sparse recovery frames are bounded, unique and deterministic',()=>{
  assert.deepEqual(selectedFrames('546,516-517,516',900),[516,517,546]);
  for(const value of ['', '10-2', '900', '-1','1;2'])assert.throws(()=>selectedFrames(value,900));
  assert.ok(selectedFrames('preview',900).includes(357));
});
test('recovery preserves all good frames, camera and moment and requires zero unsettled frames',()=>{
  const original=[0,1,2].map(frame=>({frame,t:frame/30,camera:{height:123},settled:frame!==1}));
  const repaired={...original[1],settled:true};
  assert.equal(validateRecoveredFrames(original,[repaired],3).length,3);
  assert.throws(()=>validateRecoveredFrames(original,[],3),/Unsettled/);
  assert.throws(()=>validateRecoveredFrames(original,[{...original[0],settled:true}],3),/good frame/);
  assert.throws(()=>validateRecoveredFrames(original,[{...repaired,camera:{height:124}}],3),/camera/);
  assert.throws(()=>validateRecoveredFrames(original,[{...repaired,t:99}],3),/time/);
  assert.throws(()=>validateRecoveredFrames(original.slice(1),[repaired],3),/incomplete/);
});
test('settled scenes are not changed or waited again',async()=>{
  const result=await settleAfterTimeout(true,()=>{throw Error('should not wait');});
  assert.deepEqual(result,{settled:true,retries:0});
});
test('retry waits preserve readiness criterion and cannot convert failure to success',async()=>{
  const calls=[];
  const result=await settleAfterTimeout(false,async budget=>{calls.push(budget);return calls.length===2;});
  assert.deepEqual(calls,[90000,180000]);assert.deepEqual(result,{settled:true,retries:2});
  assert.deepEqual(await settleAfterTimeout(false,async()=>false),{settled:false,retries:2});
});
