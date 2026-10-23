import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { contracts, validateBundle } from '../scripts/internet/validate.mjs';
import { centroid, simplify, splitAntimeridian, position } from '../scripts/internet/geometry.mjs';
import { build, publicationAllowed } from '../scripts/internet/build.mjs';
import { getJson, peeringList, USER_AGENT } from '../scripts/internet/http.mjs';

test('an upstream failure preserves every old output and prevents later requests', async () => {
  const cache = fileURLToPath(new URL('../.cache/', import.meta.url));
  await mkdir(cache, { recursive: true });
  const folder = await mkdtemp(resolve(cache, 'internet-failure-'));
  try {
    for (const name of Object.keys(contracts)) await writeFile(resolve(folder, name), 'old data');
    let laterCalled = false;
    await assert.rejects(build({ args: ['--output-dir', folder], builders: [
      async () => ({ datasets: { 'cables.json': { cables: [] } }, quality: {} }),
      async () => { throw new Error('upstream failed'); },
      async () => { laterCalled = true; },
    ] }), /upstream failed/);
    assert.equal(laterCalled, false);
    for (const name of Object.keys(contracts)) assert.equal(await readFile(resolve(folder, name), 'utf8'), 'old data');
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('HTTP requests identify the project and never retry permanent errors', async () => {
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++; assert.equal(options.headers['User-Agent'], USER_AGENT);
      return new Response('forbidden', { status: 403 });
    };
    await assert.rejects(getJson('https://example.com/source'), /HTTP 403/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('PeeringDB pagination rejects foreign next links before forwarding API credentials', async () => {
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return Response.json({ data: [{ id: 1, status: 'ok' }], meta: { next: 'https://example.com/steal' } }); };
    await assert.rejects(peeringList('fac'), /Unexpected pagination origin/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('internet data publication requires explicit recorded permissions', () => {
  assert.equal(publicationAllowed({}), false);
  assert.equal(publicationAllowed({ INTERNET_DATA_PUBLICATION_APPROVED: 'true' }), false);
  assert.equal(publicationAllowed({ INTERNET_DATA_PUBLICATION_APPROVED: 'true', INTERNET_DATA_PERMISSION_REFERENCE: 'approval reference' }), true);
});

test('cable simplification preserves turns and splits the dateline in both directions', () => {
  assert.deepEqual(simplify([[0, 0], [1, 0.01], [2, 0]]), [[0, 0], [2, 0]]);
  assert.deepEqual(simplify([[0, 0], [1, 1], [2, 0]]), [[0, 0], [1, 1], [2, 0]]);
  assert.deepEqual(simplify([[-170, 0], [0, 0], [170, 0]]), [[-170, 0], [0, 0], [170, 0]]);
  assert.deepEqual(splitAntimeridian([[179, 0], [-179, 2]]), [[[179, 0], [180, 1]], [[-180, 1], [-179, 2]]]);
  assert.deepEqual(splitAntimeridian([[-179, 0], [179, 2]]), [[[-179, 0], [-180, 1]], [[180, 1], [179, 2]]]);
  assert.deepEqual(splitAntimeridian([[179, 0], [180, 1], [-180, 1], [-179, 2]]), [[[179, 0], [180, 1]], [[-180, 1], [-179, 2]]]);
  assert.equal(Math.abs(centroid([[179, 0], [-179, 0]])[0]), 180);
  assert.equal(position(null, 1), null);
  assert.equal(position(181, 1), null);
});

const folder = process.env.INTERNET_DATA_TEST_DIR ? resolve(process.env.INTERNET_DATA_TEST_DIR) : new URL('../public/data/internet/', import.meta.url);
const file = name => typeof folder === 'string' ? resolve(folder, name) : new URL(name, folder);
const present = Object.keys(contracts).filter(name => existsSync(file(name)));
test('production files are complete and lossless, or publication is explicitly withheld', () => {
  if (!present.length && !process.env.INTERNET_DATA_TEST_DIR) {
    const policy = readFileSync(new URL('../scripts/internet/README.md', import.meta.url), 'utf8');
    assert.match(policy, /PUBLICATION WITHHELD/);
    assert.equal(publicationAllowed({}), false);
    return;
  }
  assert.equal(present.length, 4, 'A partial data release is forbidden');
  const bundle = Object.fromEntries(Object.keys(contracts).map(name => {
    assert.ok(statSync(file(name)).size <= contracts[name].limit, `${name}: file size`);
    return [name, JSON.parse(readFileSync(file(name), 'utf8'))];
  }));
  validateBundle(bundle);
});
