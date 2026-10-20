import test from 'node:test';
import assert from 'node:assert/strict';
import { latestCloudObservation, cloudTileUrl } from '../src/cloudData.ts';
const now = Date.parse('2026-10-19T06:00:00Z');
test('chooses latest nonfuture observation and pins tile time', () => {
  const date = latestCloudObservation([{id:'globalir', times:['20261019.050000','bad','20261019.040000','20261019.070000']}], now);
  assert.equal(date.toISOString(), '2026-10-19T05:00:00.000Z');
  assert.match(cloudTileUrl(date), /globalir_20261019_050000&x=\{x\}&y=\{y\}&z=\{z\}/);
});
test('rejects absent, stale, malformed and calendar-normalized observations', () => {
  for (const payload of [null, [], [{id:'other',times:['20261019.050000']}], [{id:'globalir',times:['20261018.000000','20260230.050000','20261019.250000']}]] ) {
    assert.throws(() => latestCloudObservation(payload, now));
  }
});
test('timeline frames: latest observation not after the moment, within tolerance', async () => {
  const { cloudTimes, cloudFrameAt } = await import('../src/cloudData.ts');
  const times = cloudTimes([{id:'globalir', times:['20261019.030000','20261019.010000','20261019.020000','20261019.050000']}], now);
  assert.deepEqual(times.map((d) => d.toISOString().slice(11, 13)), ['01', '02', '03', '05']);
  assert.equal(cloudFrameAt(times, Date.parse('2026-10-19T02:40:00Z')).toISOString(), '2026-10-19T02:00:00.000Z');
  assert.equal(cloudFrameAt(times, Date.parse('2026-10-19T04:59:00Z')).toISOString(), '2026-10-19T03:00:00.000Z', 'gap: previous frame within 2 h');
  assert.equal(cloudFrameAt(times, Date.parse('2026-10-19T00:30:00Z')), null, 'before the archive');
  assert.equal(cloudFrameAt(times, Date.parse('2026-10-19T08:00:00Z')), null, 'more than 2 h after the newest frame');
});
