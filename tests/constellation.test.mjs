import assert from "node:assert/strict";
import { test } from "node:test";
import { epochOf, parseOmmCsv, shellCounts } from "../src/constellationData.ts";
import { initSatellites, propagateAll } from "../src/constellationWorker.ts";

const HEADER = "OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT";
// Synthetic Starlink-like rows (test fixtures, not real elements): ~550 km circular orbits.
function rows(count, epoch = "2026-10-20T00:00:00.000000", inclination = 53) {
  const lines = [HEADER];
  for (let i = 0; i < count; i++) {
    lines.push(["STARLINK-T" + i, "2026-001A", epoch, 15.06, 0.0001, inclination, (i * 7) % 360, 90, (i * 13) % 360, 0, "U", 90000 + i, 999, 100, 0.0002, 0.00001, 0].join(","));
  }
  return lines.join("\n") + "\n";
}

test("parses CelesTrak OMM CSV and skips malformed rows", () => {
  const text = rows(3) + "BROKEN,2026-001A,2026-10-20T00:00:00,not-a-number,0,53,0,0,0,0,U,1,1,1,0,0,0\n";
  const records = parseOmmCsv(text);
  assert.equal(records.length, 3);
  assert.equal(records[0].OBJECT_NAME, "STARLINK-T0");
  assert.equal(records[0].INCLINATION, 53);
  assert.equal(epochOf(records[0]).toISOString(), "2026-10-20T00:00:00.000Z");
  assert.throws(() => parseOmmCsv("OBJECT_NAME\nX"));
  assert.throws(() => parseOmmCsv(""));
});

test("groups orbit shells by inclination", () => {
  const records = [...parseOmmCsv(rows(5, undefined, 53)), ...parseOmmCsv(rows(2, undefined, 97.6))];
  assert.deepEqual(shellCounts(records), [{ inclination: 53, count: 5 }, { inclination: 98, count: 2 }]);
});

test("propagates every satellite to Earth-fixed metres with shadow flags, and skips stale elements", () => {
  const fresh = parseOmmCsv(rows(50));
  const stale = parseOmmCsv(rows(1, "2026-09-01T00:00:00.000000"));
  const records = [...fresh, ...stale];
  initSatellites(records);
  const positions = new Float64Array(records.length * 3);
  const flags = new Uint8Array(records.length);
  propagateAll(Date.parse("2026-10-20T06:00:00Z"), positions, flags);
  for (let i = 0; i < fresh.length; i++) {
    assert.ok(flags[i] === 1 || flags[i] === 2, "satellite " + i + " placed");
    const altitudeKm = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]) / 1000 - 6371;
    assert.ok(altitudeKm > 450 && altitudeKm < 650, "altitude " + altitudeKm);
  }
  assert.ok(flags.slice(0, fresh.length).includes(1) && flags.slice(0, fresh.length).includes(2), "some in shadow, some sunlit");
  assert.equal(flags[fresh.length], 0, "elements 49 days old are not drawn");
});

test("propagating a full-size constellation stays well under the 1 s update interval", () => {
  const records = parseOmmCsv(rows(11_000));
  initSatellites(records);
  const positions = new Float64Array(records.length * 3);
  const flags = new Uint8Array(records.length);
  const started = performance.now();
  propagateAll(Date.parse("2026-10-20T06:00:00Z"), positions, flags);
  const elapsed = performance.now() - started;
  console.log("  11,000 satellites propagated in", elapsed.toFixed(0), "ms");
  assert.ok(elapsed < 1000);
});
