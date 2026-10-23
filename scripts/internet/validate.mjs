import assert from 'node:assert/strict';
import { parseCableDataset, parseFacilityDataset, parseIxpDataset, parseRootServerDataset } from '../../src/internet/data.ts';

export const contracts = {
  'cables.json': { parse: parseCableDataset, lists: { cables: 499, landings: -1 }, limit: 2500000 },
  'ixps.json': { parse: parseIxpDataset, lists: { ixps: 9 }, limit: 400000 },
  'facilities.json': { parse: parseFacilityDataset, lists: { facilities: 1999 }, limit: 1200000 },
};
const restrictedRoot = { parse: parseRootServerDataset, lists: { servers: 12, instances: 1000 }, limit: 500000 };

export function validate(name, raw) {
  const { parse, lists, limit } = contracts[name] ?? (name === 'root-servers.json' ? restrictedRoot : {}), parsed = parse(raw);
  assert.ok(Number.isFinite(Date.parse(raw.generatedAt)), `${name}: generatedAt`);
  assert.ok(raw.sources.length > 0, `${name}: sources`);
  assert.deepEqual(parsed.sources, raw.sources, `${name}: lost sources`);
  for (const source of raw.sources) {
    assert.ok(Number.isFinite(Date.parse(source.retrievedAt)));
    assert.ok(source.url.startsWith('https://'));
  }
  assert.ok(Buffer.byteLength(JSON.stringify(raw) + '\n') <= limit, `${name}: size exceeds ${limit}`);
  for (const [key, minimum] of Object.entries(lists)) {
    assert.equal(parsed[key].length, raw[key].length, `${name}: dropped ${key}`);
    assert.deepEqual(parsed[key], raw[key], `${name}: parser changed ${key}`);
    assert.ok(raw[key].length > minimum, `${name}: too few ${key}: ${raw[key].length}`);
    assert.equal(new Set(raw[key].map(row => row.id ?? row.letter)).size, raw[key].length, `${name}: duplicate IDs`);
  }
  if (raw.cables) {
    const ids = new Set(raw.landings.map(row => row.id));
    for (const cable of raw.cables) {
      assert.ok(cable.landingIds.every(id => ids.has(id)), `${cable.id}: unknown landing`);
      for (const path of cable.paths) for (let i = 1; i < path.length; i++) assert.ok(Math.abs(path[i][0] - path[i - 1][0]) <= 180, `${cable.id}: antimeridian`);
    }
  }
  if (raw.servers) assert.deepEqual(raw.servers.map(row => row.letter).sort(), [...'abcdefghijklm']);
  return parsed;
}

export function validateBundle(bundle, { restricted = false } = {}) {
  assert.deepEqual(Object.keys(bundle).sort(), [...Object.keys(contracts), ...(restricted ? ['root-servers.json'] : [])].sort(), 'Unexpected or missing datasets');
  for (const name of Object.keys(contracts)) validate(name, bundle[name]);
  if (restricted) validate('root-servers.json', bundle['root-servers.json']);
  const facilityIds = new Set(bundle['facilities.json'].facilities.map(row => row.id));
  for (const ix of bundle['ixps.json'].ixps) assert.ok(ix.facilityIds.every(id => facilityIds.has(id)), `${ix.id}: missing facility`);
}
