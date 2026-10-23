import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parseCableDataset, parseDnsFlowSnapshot, parseFacilityDataset, parseIxpDataset, parseRootServerDataset } from "../src/internet/data.ts";
import { readScene, sceneHash } from "../src/sceneState.ts";

// Synthetic fixtures shared with the browser tests (not real infrastructure data).
const fixture = (name) => JSON.parse(readFileSync(new URL("./e2e/fixtures/internet/" + name + ".json", import.meta.url), "utf8"));

test("the fixtures satisfy the contract", () => {
  const cables = parseCableDataset(fixture("cables"));
  assert.equal(cables.cables.length, 3);
  assert.equal(cables.landings.length, 4);
  assert.equal(parseIxpDataset(fixture("ixps")).ixps.length, 2);
  assert.equal(parseFacilityDataset(fixture("facilities")).facilities.length, 2);
  const root = parseRootServerDataset(fixture("root-servers"));
  assert.equal(root.instances.length, 2);
  assert.equal(root.servers[0].letter, "k");
  const dns = parseDnsFlowSnapshot(fixture("dns-flows"));
  assert.equal(dns.flows.length, 2);
  assert.ok(dns.matched <= dns.examined);
});

test("malformed items are dropped, malformed files rejected", () => {
  const raw = fixture("cables");
  raw.cables.push({ id: "bad-coords", name: "x", paths: [[[200, 0], [0, 0]]] }, { id: "one-point", name: "x", paths: [[[0, 0]]] }, { name: "no id", paths: [[[0, 0], [1, 1]]] });
  raw.landings.push({ id: "bad", name: "x", position: [0, 95] });
  const parsed = parseCableDataset(raw);
  assert.equal(parsed.cables.length, 3);
  assert.equal(parsed.landings.length, 4);
  assert.throws(() => parseCableDataset({ ...raw, version: 2 }), /version/);
  assert.throws(() => parseIxpDataset({ version: 1 }), /missing ixps/);
  const flows = fixture("dns-flows");
  flows.flows.push({ ...flows.flows[0], rttMs: -1 }, { ...flows.flows[0], letter: "z" });
  assert.equal(parseDnsFlowSnapshot(flows).flows.length, 2);
  assert.throws(() => parseDnsFlowSnapshot({ ...flows, source: null }), /source/);
});

test("internet layers survive a shared link; older links stay valid", () => {
  const base = { v: 1, camera: [0, 0, 2e7, 0, -1.5, 0], layers: { clouds: false, geology: false, dayNight: true, cities: true, atmosphere: true, aurora: false, lights: true, quakes: false, plates: false, volcanoes: false, satellites: false, paths: false }, options: { cloudOpacity: 65, opacity: 90, mapMode: "raster", ageFilter: "all", rockFilter: "all", quakeRange: "week" } };
  assert.ok(readScene(sceneHash(base)));
  const withInternet = { ...base, layers: { ...base.layers, cables: true, ixps: false, dataCenters: true, rootServers: true, dnsFlows: true } };
  assert.equal(readScene(sceneHash(withInternet)).layers.cables, true);
  assert.equal(readScene("#scene=" + encodeURIComponent(JSON.stringify({ ...base, layers: { ...base.layers, cables: "yes" } }))), null);
});
