import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boxesOverlap, layoutLabels } from '../src/labelLayout.ts';
const box=(id,x,y,priority=1,group)=>({id,x,y,width:100,height:30,priority,group});
test('geographic text never overlaps cities or higher priority labels',()=>{
  const candidates=[box('ocean',200,100,30),box('river',220,105,10),box('sea',400,200,20),box('city-overlap',600,300)];
  const reserved=[box('city',600,300,100)];
  const ids=layoutLabels(candidates,reserved,1000,700);
  assert.deepEqual([...ids],['ocean','sea']);
  const visible=candidates.filter(c=>ids.has(c.id));
  for(let i=0;i<visible.length;i++) for(const other of [...visible.slice(i+1),...reserved]) assert.equal(boxesOverlap(visible[i],other),false);
});
test('duplicate ocean names and labels outside viewport are suppressed',()=>{
  assert.deepEqual([...layoutLabels([box('a',200,200,30,'Pacific'),box('b',600,200,30,'Pacific'),box('edge',5,5)],[],1000,700)],['a']);
});
test('layout remains deterministic after resizing and dense regional clusters',()=>{
  const candidates=Array.from({length:172},(_,i)=>box(String(i),50+i%20*40,40+Math.floor(i/20)*25,i%3));
  for(const [w,h] of [[390,844],[1440,860],[800,600]]) {
    const ids=layoutLabels(candidates,[],w,h);
    assert.deepEqual(ids,layoutLabels([...candidates].reverse(),[],w,h));
    const accepted=candidates.filter(c=>ids.has(c.id));
    for(let i=0;i<accepted.length;i++) for(const other of accepted.slice(i+1)) assert.equal(boxesOverlap(accepted[i],other),false);
  }
});
