import assert from "node:assert/strict";
import { test } from "node:test";
import { boundaryRadius, bowShock, dynamicPressure, parseSolarWind, sampleAt, shueMagnetopause, solarWindLevel } from "../src/solarWindData.ts";

const t = (minute) => new Date(Date.UTC(2026, 9, 21, 5, minute)).toISOString().slice(0, 19);
// Synthetic RTSW-shaped rows (not NOAA data): two spacecraft, newest first.
const wind = [
  { time_tag: t(2), active: false, source: "IMAP", proton_speed: 380, proton_density: 6 },
  { time_tag: t(2), active: true, source: "SOLAR1", proton_speed: 400, proton_density: 5 },
  { time_tag: t(1), active: true, source: "SOLAR1", proton_speed: null, proton_density: 5 },
  { time_tag: t(1), active: false, source: "ACE", proton_speed: 390, proton_density: 4 },
  { time_tag: t(0), active: true, source: "SOLAR1", proton_speed: 99999, proton_density: 5 },
];
const mag = [
  { time_tag: t(2) + ".5", active: true, source: "SOLAR1", bz_gsm: -6, bt: 8 },
  { time_tag: t(1), active: false, source: "ACE", bz_gsm: 2, bt: 4 },
];

test("joins wind and field by minute, preferring the active spacecraft and dropping bad rows", () => {
  const samples = parseSolarWind(wind, mag);
  assert.equal(samples.length, 2, "unphysical speed dropped");
  assert.deepEqual(samples.map((s) => s.source), ["ACE", "SOLAR1"]);
  assert.equal(samples[1].speed, 400);
  assert.equal(samples[1].bz, -6);
  assert.equal(samples[0].bz, 2);
  assert.ok(samples[0].time < samples[1].time);
  assert.throws(() => parseSolarWind([], mag));
  assert.equal(parseSolarWind(wind, null)[1].bz, null, "field optional");
});

test("nearest sample within tolerance", () => {
  const samples = parseSolarWind(wind, mag);
  assert.equal(sampleAt(samples, Date.UTC(2026, 9, 21, 5, 2, 20))?.source, "SOLAR1");
  assert.equal(sampleAt(samples, Date.UTC(2026, 9, 21, 7, 0)), null);
});

test("dynamic pressure and the Shue 1998 magnetopause", () => {
  assert.ok(Math.abs(dynamicPressure(5, 400) - 1.338) < 0.01);
  const quiet = shueMagnetopause(2, 0);
  assert.ok(Math.abs(quiet.r0 - 10.25) < 0.05, "quiet standoff ~10 RE: " + quiet.r0);
  const storm = shueMagnetopause(20, -20);
  assert.ok(storm.r0 > 5 && storm.r0 < 6.5, "compressed during a storm: " + storm.r0);
  assert.ok(storm.alpha > quiet.alpha, "southward Bz flares the tail");
  assert.equal(boundaryRadius(quiet, 0), quiet.r0);
  assert.ok(boundaryRadius(quiet, Math.PI / 2) > quiet.r0);
  assert.ok(Math.abs(bowShock(quiet).r0 / quiet.r0 - 1.3) < 1e-9);
});

test("qualitative level", () => {
  assert.equal(solarWindLevel({ speed: 380, bz: 2 }).label, "平静");
  assert.equal(solarWindLevel({ speed: 520, bz: 0 }).label, "偏强");
  assert.equal(solarWindLevel({ speed: 750, bz: -3 }).label, "强扰动");
});
