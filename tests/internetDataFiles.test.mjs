import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { contracts, validateBundle } from '../scripts/internet/validate.mjs';
import { centroid, simplify, splitAntimeridian, position } from '../scripts/internet/geometry.mjs';
import { publicationAllowed } from '../scripts/internet/build.mjs';

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
