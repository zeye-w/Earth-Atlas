import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  buildGeologyUrl,
  parseGeologicalUnit,
  parseGeologicalUnits,
  queryGeology,
} from "../src/geology.ts";

// Fixture fields based on the published rmacrostrat Hell Creek example:
// https://rmacrostrat.palaeoverse.org/articles/geologic-map.html
// Fixtures are documented examples, NOT a fresh live API fetch.
const hellCreek = {
  map_id: 2092425,
  source_id: 25,
  name: "Hell Creek Formation",
  strat_name: "Hell Creek Formation",
  lith: "Major:: {sandstone, mudstone}",
  liths: [7, 10],
  t_int_name: "Late Cretaceous",
  b_int_name: "Late Cretaceous",
  best_int_name: "Maastrichtian",
  t_age: 66,
  b_age: 72.1,
};

test("representative interval takes precedence and age spans are shown in Ma", () => {
  const u = parseGeologicalUnit({ success: { v: 2 }, data: [hellCreek] });
  assert.ok(u);
  assert.equal(u.name, "Hell Creek Formation");
  assert.equal(u.age, "Maastrichtian");
  assert.equal(u.lithology, "Major:: {sandstone, mudstone}");
  assert.equal(u.ageRangeMa, "66–72.1 Ma");
  assert.deepEqual(u.lithIds, [7, 10]);
  assert.equal(u.youngAgeMa, 66);
  assert.equal(u.oldAgeMa, 72.1);
  assert.equal(u.sourceId, 25);
  assert.equal(u.mapId, 2092425);
});

test("real Macrostrat v2 success.data envelope is correctly unwrapped", () => {
  const envelope = { success: { v: 2, license: "CC-BY 4.0", data: [hellCreek], refs: {} } };
  assert.equal(parseGeologicalUnits(envelope).length, 1);
  assert.equal(parseGeologicalUnit(envelope)?.name, "Hell Creek Formation");
  assert.deepEqual(parseGeologicalUnits({ success: { v: 2, license: "CC-BY 4.0", data: [] } }), []);
  const asGeoJSON = { success: { v: 2, data: { type: "FeatureCollection", features: [
    { type: "Feature", geometry: null, properties: hellCreek },
  ] } } };
  assert.equal(parseGeologicalUnits(asGeoJSON)[0]?.mapId, 2092425);
});

test("multiple overlapping map units are returned in source order, never arbitrarily collapsed", () => {
  const u = parseGeologicalUnits({ data: [hellCreek, { ...hellCreek, map_id: 2092426, lith: "limestone" }] });
  assert.equal(u.length, 2);
  assert.equal(u[1].lithology, "limestone");
});

test("repeat of same polygon/source pair is deduplicated", () => {
  const u = parseGeologicalUnits({ data: [hellCreek, hellCreek] });
  assert.equal(u.length, 1);
});

test("different map sources with equal map id stay distinguishable", () => {
  const u = parseGeologicalUnits({ data: [hellCreek, { ...hellCreek, source_id: 32 }] });
  assert.equal(u.length, 2);
});

test("GeoJSON FeatureCollection geometry is separated from map unit properties", () => {
  const u = parseGeologicalUnits({ type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [-105, 44] }, properties: hellCreek },
  ] });
  assert.equal(u[0]?.age, "Maastrichtian");
});

test("lithology arrays are preserved as multiple rock types and numeric lith IDs not mislabelled", () => {
  const u = parseGeologicalUnit({ data: [{ map_id: 3, lith: [{ name: "sandstone" }, { name: "mudstone" }], liths: [7, 10] }] });
  assert.equal(u?.lithology, "sandstone, mudstone");
  const idsOnly = parseGeologicalUnit({ data: [{ map_id: 4, liths: [7, 10] }] });
  assert.equal(idsOnly?.lithology, null);
});

test("missing geological ages and source fields remain unknown rather than invented", () => {
  const u = parseGeologicalUnit({ data: [{ map_id: 11, name: "Unknown unit", lith: null, age: null }] });
  assert.equal(u?.age, null);
  assert.equal(u?.ageRangeMa, null);
  assert.equal(u?.sourceId, null);
});

test("one numerical boundary is not shown as a full age range", () => {
  const u = parseGeologicalUnit({ data: [{ map_id: 12, t_age: 32 }] });
  assert.equal(u?.ageRangeMa, null);
  assert.match(u?.ageNote ?? "", /仅有一侧/);
});

test("reversed age boundaries do not silently become a valid-looking range", () => {
  const u = parseGeologicalUnit({ data: [{ map_id: 12, t_age: 90, b_age: 65 }] });
  assert.equal(u?.ageRangeMa, null);
  assert.match(u?.ageNote ?? "", /不一致/);
});

test("interval ages can fill missing numerical ages only with an explicit qualifier", () => {
  const u = parseGeologicalUnit({ data: [{ map_id: 20, t_int_age: 145, b_int_age: 201.4 }] });
  assert.equal(u?.ageRangeMa, "145–201.4 Ma");
  assert.match(u?.ageNote ?? "", /年代地层单元边界/);
});

test("source reference and geographic IDs remain traceable", () => {
  const u = parseGeologicalUnit({ data: [{ map_id: "17", lith: "shale", source: { source_id: 5, title: "Geological Map A" } }] });
  assert.equal(u?.sourceId, 5);
  assert.equal(u?.sourceName, "Geological Map A");
});

test("empty data is no-coverage; a wrapper without unit data is not success", () => {
  assert.deepEqual(parseGeologicalUnits({ success: { v: 2 }, data: [] }), []);
  assert.deepEqual(parseGeologicalUnits({ data: [{}] }), []);
  assert.throws(() => parseGeologicalUnits({ success: { v: 2 } }), /Unexpected/);
  assert.throws(() => parseGeologicalUnits({ success: false, data: [] }), /API error/);
});

test("coordinates are validated and no artificial scale bucket is used with blended carto", () => {
  const url = new URL(buildGeologyUrl(43, -89.3));
  assert.equal(url.searchParams.get("lat"), "43.000000");
  assert.equal(url.searchParams.get("lng"), "-89.300000");
  assert.equal(url.searchParams.get("format"), "json");
  assert.equal(url.searchParams.has("scale"), false);
  assert.throws(() => buildGeologyUrl(120, 0), RangeError);
  assert.throws(() => buildGeologyUrl(NaN, 1), RangeError);
});

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("HTTP JSON response is parsed through queryGeology", async () => {
  globalThis.fetch = async (url, init) => {
    assert.match(url, /format=json/);
    assert.equal(init.headers.Accept, "application/json");
    return new Response(JSON.stringify({ success: { v: 2, data: [hellCreek] } }), {
      status: 200, headers: { "content-type": "application/json; charset=utf-8" },
    });
  };
  const units = await queryGeology(43, -89.3);
  assert.equal(units.length, 1);
  assert.equal(units[0].age, "Maastrichtian");
});

test("HTML fallback, bad HTTP status and malformed payload are errors", async () => {
  globalThis.fetch = async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } });
  await assert.rejects(queryGeology(43, -89.3), /instead of JSON/);
  globalThis.fetch = async () => new Response("bad", { status: 502 });
  await assert.rejects(queryGeology(43, -89.3), /HTTP 502/);
  globalThis.fetch = async () => new Response(JSON.stringify({ success: { v: 2 } }), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(queryGeology(43, -89.3), /Unexpected/);
});

test("external abort signal is forwarded to the request", async () => {
  const controller = new AbortController();
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.signal, controller.signal);
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  assert.deepEqual(await queryGeology(0, 0, controller.signal), []);
});
