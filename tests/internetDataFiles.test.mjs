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
import { convertCables, convertFacilities, convertIxps, osmNumericId, rfsYear, OSM_LICENSE, WIKIDATA_LICENSE } from '../scripts/internet/open-sources.mjs';

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

test('default build requests only Overpass and Wikidata, never restricted adapters', async () => {
  const original = globalThis.fetch, urls = [];
  const cache = fileURLToPath(new URL('../.cache/', import.meta.url));
  await mkdir(cache, { recursive: true });
  const output = await mkdtemp(resolve(cache, 'internet-default-'));
  try {
    globalThis.fetch = async url => {
      const host = new URL(url).hostname; urls.push(host);
      assert.ok(['overpass-api.de', 'query.wikidata.org'].includes(host));
      return Response.json(host === 'overpass-api.de' ? { osm3s: { timestamp_osm_base: '2026-10-23T00:00:00Z' }, elements: [] } : { results: { bindings: [] } });
    };
    await assert.rejects(build({ args: ['--output-dir', output] }), /too few cables/);
    assert.deepEqual(urls, ['overpass-api.de', 'overpass-api.de', 'query.wikidata.org']);
  } finally { globalThis.fetch = original; await rm(output, { recursive: true, force: true }); }
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

test('restricted adapters require explicit recorded permissions', async () => {
  assert.equal(publicationAllowed({}), false);
  assert.equal(publicationAllowed({ INTERNET_DATA_PUBLICATION_APPROVED: 'true' }), false);
  assert.equal(publicationAllowed({ INTERNET_DATA_PUBLICATION_APPROVED: 'true', INTERNET_DATA_PERMISSION_REFERENCE: 'approval reference' }), true);
  const previous = process.env.INTERNET_DATA_PUBLICATION_APPROVED;
  delete process.env.INTERNET_DATA_PUBLICATION_APPROVED;
  try { await assert.rejects(build({ args: ['--restricted'] }), /Restricted adapters require/); }
  finally { if (previous !== undefined) process.env.INTERNET_DATA_PUBLICATION_APPROVED = previous; }
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
test('all three open-licensed production datasets are present, lossless and within size/count budgets', () => {
  assert.equal(present.length, 3, 'A partial data release is forbidden');
  assert.equal(existsSync(file('root-servers.json')), false, 'Root server data is now supplied live by the Worker');
  const bundle = Object.fromEntries(Object.keys(contracts).map(name => {
    assert.ok(statSync(file(name)).size <= contracts[name].limit, `${name}: file size`);
    return [name, JSON.parse(readFileSync(file(name), 'utf8'))];
  }));
  validateBundle(bundle);
  for (const name of ['cables.json', 'facilities.json']) assert.ok(bundle[name].sources.every(s => s.license === OSM_LICENSE));
  assert.ok(bundle['ixps.json'].sources.every(s => s.license === WIKIDATA_LICENSE));
  // Floors leave substantial room for normal edits, but reject empty/truncated upstream responses.
  assert.ok(bundle['cables.json'].cables.length >= 500);
  assert.ok(bundle['facilities.json'].facilities.length >= 2000);
  assert.ok(bundle['ixps.json'].ixps.length >= 10);
  // City-estimated exchanges must stay distinguishable from ones with their own coordinates.
  assert.ok(bundle['ixps.json'].ixps.every(i => i.positionSource === 'item' || i.positionSource === 'city'));
  assert.ok(bundle['ixps.json'].ixps.some(i => i.positionSource === 'city'));
});

test('OSM conversion merges route ways, keeps real names and rejects non-communication cables', () => {
  const way = (id, nodes, geometry, tags = {}) => ({ type: 'way', id, nodes, geometry: geometry.map(([lon, lat]) => ({ lon, lat })), tags: { communication: 'line', submarine: 'yes', ...tags } });
  const raw = { osm3s: { timestamp_osm_base: '2026-10-23T00:00:00Z' }, elements: [
    way(1, [1, 2], [[179, 0], [180, 1]], { name: 'Cable', start_date: '2028-03', operator: 'A;B' }),
    way(2, [2, 3], [[180, 1], [-179, 2]], { name: 'Cable', owner: 'C' }),
    way(3, [4, 5], [[1, 0], [2, 1]], { power: 'cable', name: 'Power' }),
    { type: 'relation', id: 5, tags: { name: 'Cable', type: 'route', route: 'communication' }, members: [{ type: 'way', ref: 1 }, { type: 'way', ref: 2 }] },
  ] };
  const { dataset } = convertCables(raw);
  assert.equal(dataset.cables.length, 1);
  assert.equal(dataset.cables[0].name, 'Cable');
  assert.equal(dataset.cables[0].rfsYear, 2028);
  assert.deepEqual(dataset.cables[0].owners, ['A', 'B', 'C']);
  // Loose ends of OSM ways are not landing stations.
  assert.deepEqual(dataset.cables[0].landingIds, []);
  assert.equal(dataset.landings.length, 0);
  assert.equal(rfsYear('unknown'), null);
  assert.throws(() => convertCables({ ...raw, remark: 'timeout' }), /Incomplete Overpass/);
});

test('OSM data center IDs cannot collide across types and areas use supplied centers', () => {
  assert.equal(new Set(['node', 'way', 'relation'].map(type => osmNumericId(type, 123))).size, 3);
  const { dataset } = convertFacilities({ osm3s: { timestamp_osm_base: '2026-10-23T00:00:00Z' }, elements: [{ type: 'way', id: 123, center: { lon: 10, lat: 20 }, tags: { name: 'DC', operator: 'Operator' } }] });
  assert.deepEqual(dataset.facilities[0].position, [10, 20]);
  assert.equal(dataset.facilities[0].networkCount, 0);
});

test('Wikidata uses direct coordinates first, city fallback second and preserves unknowns', () => {
  const binding = values => Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value }]));
  const { dataset, quality } = convertIxps({ results: { bindings: [
    binding({ item: 'http://www.wikidata.org/entity/Q1', itemLabel: 'IX A', coord: 'Point(10 20)', cityCoord: 'Point(30 40)', members: '123', website: 'https://example.com' }),
    binding({ item: 'http://www.wikidata.org/entity/Q2', itemLabel: 'IX B', cityCoord: 'Point(30 40)' }),
    binding({ item: 'http://www.wikidata.org/entity/Q3', itemLabel: 'IX C' }),
  ] } });
  assert.equal(dataset.ixps.length, 2);
  assert.deepEqual(dataset.ixps[0].position, [10, 20]);
  assert.equal(dataset.ixps[0].members, 123);
  assert.equal(dataset.ixps[1].members, null);
  assert.deepEqual(dataset.ixps.map(i => i.positionSource), ['item', 'city']);
  assert.equal(quality.cityFallback, 1);
  assert.equal(quality.missingCoordinates, 1);
});
