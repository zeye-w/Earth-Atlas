import assert from "node:assert/strict";
import { test } from "node:test";
import { STAR_BRIGHTNESS, STAR_RECORD_FLOATS, STAR_SIGMA, STAR_VERTEX_FLOATS, parseStars, starColor, starLight, starSprite, starVertices } from "../src/stars/starCatalog.ts";

function file(records) {
  const buffer = new ArrayBuffer(records.length * STAR_RECORD_FLOATS * 4);
  const view = new DataView(buffer);
  records.flat().forEach((v, i) => view.setFloat32(i * 4, v, true));
  return buffer;
}

test("the catalogue file is read as little-endian records of direction, V and B-V", () => {
  const catalog = parseStars(file([[1, 0, 0, -1.46, 0.0], [0, 0, 1, 1.97, 0.6]]));
  assert.equal(catalog.count, 2);
  assert.ok(Math.abs(catalog.records[3] - -1.46) < 1e-6);
  assert.throws(() => parseStars(new ArrayBuffer(7)));
  assert.throws(() => parseStars(new ArrayBuffer(0)));
});

test("vertices carry direction, colour and light relative to V = 0", () => {
  const v = starVertices(parseStars(file([[0, 1, 0, 5, 0.6]])));
  assert.equal(v.length, STAR_VERTEX_FLOATS);
  assert.deepEqual([...v.slice(0, 3)], [0, 1, 0]);
  assert.ok(Math.abs(v[6] - 0.01) < 1e-6);
  assert.ok(Math.abs(starLight(0) - 1) < 1e-12 && Math.abs(starLight(2.5) - 0.1) < 1e-12);
});

test("star colours: blue for hot stars, orange for cool ones, never far from white", () => {
  const [rb, , bb] = starColor(-0.3);   // a B star
  const [rm, , bm] = starColor(1.85);   // an M star
  assert.ok(bb > rb && rm > bm);
  for (const bv of [-0.4, 0, 0.6, 1.2, 2]) {
    const c = starColor(bv);
    assert.ok(Math.max(...c) === 1 && Math.min(...c) >= 0.5, `${bv}: ${c}`);
  }
  assert.deepEqual(starColor(Number.NaN), starColor(0.6));
});

test("sprites: faint stars keep their width and dim, bright ones widen with a peak of 1", () => {
  const sprite = (v, pr = 1) => starSprite(starLight(v), STAR_BRIGHTNESS, STAR_SIGMA, pr);
  // V 7 (the faintest drawn) is still visible; V 6 is clearly so.
  assert.ok(sprite(7).peak > 0.1 && sprite(7).peak < 0.35, String(sprite(7).peak));
  assert.ok(sprite(6).peak > 0.3);
  assert.equal(sprite(6).sigma, STAR_SIGMA);
  // Sirius and Vega: saturated, a few pixels wide, not a blob.
  for (const v of [-1.46, 0.03]) {
    const s = sprite(v);
    assert.equal(s.peak, 1);
    assert.ok(s.sigma > 1.5 && s.sigma < 4, `${v}: ${s.sigma}`);
  }
  // Brighter means wider, never narrower.
  assert.ok(sprite(0).sigma >= sprite(2).sigma && sprite(2).sigma >= sprite(4).sigma);
  // On a 2x screen a star covers the same css area and looks as bright.
  assert.ok(Math.abs(sprite(5, 2).sigma - 2 * sprite(5).sigma) < 1e-9);
  assert.ok(Math.abs(sprite(5, 2).peak - sprite(5).peak) < 1e-9);
});
