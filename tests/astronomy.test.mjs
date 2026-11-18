import assert from "node:assert/strict";
import { test } from "node:test";
import { discOverlap, distanceKm, listEclipses, obscurationAt, shadowAt, solarEclipseTrack } from "../src/astronomy/eclipses.ts";
import { moonRiseSet, moonState, nextQuarters, phaseKey } from "../src/astronomy/moon.ts";
import { isActive, METEOR_SHOWERS, nextPeak, showerOutlook, visibilityGrid } from "../src/astronomy/meteors.ts";
import { nextLocalEclipse, tonight } from "../src/astronomy/tonight.ts";

const HOUR = 3_600_000;
const near = (actual, expected, tolerance, what) => assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} not within ${tolerance} of ${expected}`);

test("eclipses of 2027 match NASA's catalogue", () => {
  const list = listEclipses(Date.UTC(2027, 0, 1), Date.UTC(2028, 0, 1));
  assert.deepEqual(list.map((e) => e.id + " " + e.kind), [
    "solar:2027-02-06 annular", "lunar:2027-02-20 penumbral", "lunar:2027-07-18 penumbral",
    "solar:2027-08-02 total", "lunar:2027-08-17 penumbral",
  ]);
  const total = list.find((e) => e.id === "solar:2027-08-02");
  // NASA: greatest eclipse 10:06:41 UT at 25.5°N 33.2°E (near Luxor).
  near(total.peak, Date.UTC(2027, 7, 2, 10, 6, 41), 60_000, "peak");
  near(total.latitude, 25.5, 0.2, "latitude");
  near(total.longitude, 33.2, 0.2, "longitude");
});

test("the 2027-08-02 shadow: central line, path width and partial phase", () => {
  const eclipse = listEclipses(Date.UTC(2027, 7, 1), Date.UTC(2027, 7, 3)).find((e) => e.type === "solar");
  const shadow = shadowAt(eclipse.peak);
  assert.equal(shadow.centralKind, "total");
  near(shadow.center.latitude, 25.5, 0.2, "centre latitude");
  near(shadow.center.longitude, 33.2, 0.2, "centre longitude");
  const track = solarEclipseTrack(eclipse);
  // The central line runs from the Atlantic to the Indian Ocean; NASA gives a 258 km path at greatest eclipse.
  assert.ok(track.center[0].longitude < -20 && track.center.at(-1).longitude > 60);
  const i = track.center.findIndex((p) => Math.abs(p.longitude - 33.2) < 1.5);
  near(distanceKm(track.northLimit[i], track.southLimit[i]), 258, 15, "path width");
  assert.ok(track.northLimit[i].latitude > track.southLimit[i].latitude);
  // About 5 h 12 min from first to last contact anywhere on the Earth.
  near(track.partialEnd - track.partialStart, 5.2 * HOUR, 0.2 * HOUR, "partial phase");
  // Totality at Luxor, a deep partial eclipse in Cairo, none in Beijing.
  near(obscurationAt(eclipse.peak, 25.7, 32.65), 1, 0.001, "Luxor");
  assert.ok(obscurationAt(eclipse.peak, 30.04, 31.24) > 0.8);
  assert.equal(obscurationAt(eclipse.peak, 39.9, 116.4), 0);
});

test("disc overlap covers the edge cases", () => {
  assert.equal(discOverlap(1, 1, 3), 0);
  assert.equal(discOverlap(1, 1.1, 0), 1);
  near(discOverlap(1, 0.5, 0), 0.25, 1e-9, "annular");
  near(discOverlap(1, 1, 1), 0.391, 0.001, "half offset");
});

test("Moon phase, distance and rise/set", () => {
  // Full Moon of 2026-11-24 14:54 UT.
  const full = moonState(Date.UTC(2026, 10, 24, 14, 54));
  assert.equal(full.phase, "full");
  assert.ok(full.illuminated > 0.99);
  assert.ok(full.distanceKm > 356_000 && full.distanceKm < 407_000);
  assert.equal(phaseKey(45), "waxingCrescent");
  assert.equal(phaseKey(268), "lastQuarter");
  assert.equal(phaseKey(300), "waningCrescent");
  const quarters = nextQuarters(Date.UTC(2026, 10, 18));
  assert.deepEqual(quarters.map((q) => q.quarter), [2, 3, 0, 1]);
  near(quarters[0].time, Date.UTC(2026, 10, 24, 14, 54), 5 * 60_000, "full Moon");
  const { rise, set } = moonRiseSet(Date.UTC(2026, 10, 18), 39.9, 116.4);
  assert.ok(rise && set && Math.abs(rise - set) < 24 * HOUR);
});

test("meteor shower peaks follow the IMO calendar", () => {
  const peak = (code, from) => nextPeak(METEOR_SHOWERS.find((s) => s.code === code), from);
  // IMO 2026: Quadrantids Jan 3 ~21h UT, Perseids Aug 13 ~2h, Geminids Dec 14 ~13h.
  near(peak("QUA", Date.UTC(2026, 0, 1)), Date.UTC(2026, 0, 3, 21), 3 * HOUR, "Quadrantids");
  near(peak("PER", Date.UTC(2026, 0, 1)), Date.UTC(2026, 7, 13, 2), 4 * HOUR, "Perseids");
  near(peak("GEM", Date.UTC(2026, 0, 1)), Date.UTC(2026, 11, 14, 13), 3 * HOUR, "Geminids");
  // A peak just ahead is found, not next year's.
  near(peak("LEO", Date.UTC(2026, 10, 15)), Date.UTC(2026, 10, 17, 23), 3 * HOUR, "Leonids");
  const quadrantids = METEOR_SHOWERS.find((s) => s.code === "QUA");
  assert.equal(isActive(quadrantids, Date.UTC(2026, 11, 30)), true);
  assert.equal(isActive(quadrantids, Date.UTC(2027, 0, 5)), true);
  assert.equal(isActive(quadrantids, Date.UTC(2027, 1, 5)), false);
  const outlook = showerOutlook(Date.UTC(2026, 11, 1));
  assert.equal(outlook[0].shower.code, "GEM");
  assert.ok(outlook.every((o, i) => i === 0 || o.peak >= outlook[i - 1].peak));
});

test("a shower is visible only where the radiant is up in a dark sky", () => {
  const geminids = METEOR_SHOWERS.find((s) => s.code === "GEM");
  const grid = visibilityGrid(geminids, Date.UTC(2026, 11, 14, 18));
  const at = (lat, lon) => grid.values[Math.floor((90 - lat) / 2) * grid.width + Math.floor((lon + 180) / 2)];
  // 18 UT: night over China with Gemini high; daytime over the Americas.
  assert.ok(at(40, 116) > 0.7);
  assert.equal(at(40, -100), 0);
});

test("tonight from Beijing", () => {
  const r = tonight(Date.UTC(2026, 10, 18, 8), 39.9, 116.4);
  assert.ok(r.night && r.dark && r.dark.from > r.night.from && r.dark.to < r.night.to);
  assert.ok(r.planets.some((p) => p.planet === "Jupiter"));
  assert.ok(r.planets.every((p) => p.altitude >= 10));
  assert.deepEqual(r.showers.map((s) => s.shower.code), ["LEO"]);
  // The 2027-08-02 total eclipse is not seen from Beijing, and lunar eclipses only where the Moon is up.
  const local = nextLocalEclipse(Date.UTC(2027, 6, 20), 39.9, 116.4);
  assert.notEqual(local?.eclipse.id, "solar:2027-08-02");
  assert.equal(nextLocalEclipse(Date.UTC(2027, 6, 20), 30.04, 31.24).eclipse.id, "solar:2027-08-02");
});
