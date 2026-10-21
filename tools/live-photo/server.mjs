import {createServer} from 'node:http';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportPair, run} from './export.mjs';

const port = Number(process.env.LIVE_PHOTO_PORT || 4174);
let busy = false;
const server = createServer(async (request, response) => {
  const send = (status, value) => {response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); response.end(JSON.stringify(value));};
  // Access through the Vite same-origin proxy. Loopback binding + Origin check
  // prevent arbitrary websites from starting local ffmpeg jobs.
  const origin = request.headers.origin;
  if (origin) {
    try {if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) return send(403, {error: '仅允许本地网页'});} catch {return send(403, {error: 'Invalid origin'});}
  }
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(request.headers.host || '')) return send(403, {error: 'Invalid host'});
  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/api/live-photo/health') return send(200, {ready: true, busy, iPhonePhotosTested: false});
  if (request.method !== 'POST' || url.pathname !== '/api/live-photo/export') return send(404, {error: 'Not found'});
  if (Number(request.headers['content-length']) > 40 * 1024 * 1024) return send(413, {error: '录制文件超过 40 MB'});
  if (busy) return send(409, {error: '已有导出任务，请稍后重试'});
  if (!/^video\/(webm|mp4)(;|$)/i.test(request.headers['content-type'] || '')) return send(415, {error: '需要浏览器录制的视频'});
  const cover = Number(url.searchParams.get('cover'));
  if (!url.searchParams.has('cover') || !Number.isFinite(cover) || cover < 0 || cover > 2.95) return send(400, {error: '封面时间无效'});
  busy = true;
  let directory;
  try {
    const chunks = []; let size = 0;
    for await (const chunk of request) {size += chunk.length; if (size > 40 * 1024 * 1024) {send(413, {error: '录制文件超过 40 MB'}); return;} chunks.push(chunk);}
    if (!size) return send(400, {error: '空录制文件'});
    directory = await mkdtemp(join(tmpdir(), 'terrascope-live-'));
    const input = join(directory, 'capture'); await writeFile(input, Buffer.concat(chunks));
    let scene = {};
    try {scene = JSON.parse(decodeURIComponent(request.headers['x-terrascope-scene'] || '%7B%7D'));} catch {return send(400, {error: '场景记录无效'});}
    const {zip} = await exportPair(input, directory, cover, scene);
    response.writeHead(200, {'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="terrascope-live-photo.zip"', 'Content-Length': zip.length, 'Cache-Control': 'no-store'});
    response.end(zip);
  } catch (error) {if (!response.headersSent) send(422, {error: '实况图封装失败：' + String(error.message).slice(0, 500)});}
  finally {busy = false; if (directory) await rm(directory, {recursive: true, force: true});}
});
server.requestTimeout = 150_000;
await run(process.env.PYTHON_PATH || 'python', ['--version'], 10_000);
server.listen(port, '127.0.0.1', () => console.log(`Live Photo 封装服务 http://127.0.0.1:${port}（通过本地 Vite 页面使用）`));
