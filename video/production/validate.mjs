import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const spec=JSON.parse(readFileSync(new URL('../shots.json',import.meta.url),'utf8'));
assert.equal(spec.output.duration*spec.output.fps,900);
const active=spec.shots.filter(s=>!s.optional);
assert.equal(active[0].start,0);
for(let i=0;i<active.length;i++){
 const shot=active[i];assert.ok(shot.end>shot.start);
 if(i)assert.equal(shot.start,active[i-1].end);
 for(const caption of shot.captions??[])assert.ok(caption.in>=0&&caption.out<=shot.end-shot.start&&caption.out>caption.in,shot.id);
}
assert.equal(active.at(-1).end,spec.output.duration);
const cloud=spec.shots.find(s=>s.time?.mode==='hourly-stills');
assert.equal(Math.round(cloud.time.toHours-cloud.time.fromHours)+1,31);
const alternate=spec.shots.find(s=>s.id==='s4b-atmosphere');const aurora=spec.shots.find(s=>s.id==='s4-aurora');
assert.equal(alternate.start,aurora.start);assert.equal(alternate.end,aurora.end);
console.log('Video schedule validated: 900 output frames, 31 hourly cloud sources, captions within shots.');
