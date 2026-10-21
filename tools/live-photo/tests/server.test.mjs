import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {request} from 'node:http';

test('local service rejects foreign origins/hosts and invalid uploads without invoking an encoder', {timeout: 20_000}, async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {env: {...process.env, LIVE_PHOTO_PORT: '4176'}, windowsHide: true});
  try {
    await new Promise((resolve, reject) => {child.once('error', reject); child.once('exit', code => reject(Error('Server exited: ' + code))); child.stdout.once('data', resolve);});
    const base = 'http://127.0.0.1:4176/api/live-photo';
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/health', {headers: {Origin: 'https://evil.example'}})).status, 403);
    const forbiddenHost = await new Promise((resolve, reject) => {
      const req = request(base + '/health', {headers: {Host: 'evil.example'}}, res => {res.resume(); resolve(res.statusCode);});
      req.on('error', reject); req.end();
    });
    assert.equal(forbiddenHost, 403);
    assert.equal((await fetch(base + '/export?cover=1.5', {method: 'POST', headers: {'content-type': 'text/plain'}, body: 'not a clip'})).status, 415);
    assert.equal((await fetch(base + '/export?cover=NaN', {method: 'POST', headers: {'content-type': 'video/webm'}, body: 'x'})).status, 400);
    assert.equal((await fetch(base + '/export?cover=1.5', {method: 'POST', headers: {'content-type': 'video/webm'}, body: ''})).status, 400);
    const code = await new Promise((resolve, reject) => {
      const req = request(base + '/export?cover=1.5', {method: 'POST', headers: {'content-type': 'video/webm', 'content-length': String(41 * 1024 * 1024)}}, res => {res.resume(); resolve(res.statusCode);});
      req.on('error', reject); req.end();
    });
    assert.equal(code, 413);
    assert.equal((await fetch(base + '/health')).status, 200);
  } finally {child.kill();}
});
